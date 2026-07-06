import { createHash } from 'node:crypto';
import { injectManagedBlock, stripManagedBlock, wrapManagedBlock } from '../html/managed-block';
import { monthYear, prevMonthYear, todayLong } from '../i18n/dates';
import { extractJson } from '../llm/parse';
import { LlmError } from '../llm/client';
import { managedBlockRenderers } from '../renderers';
import { buildSearchContext } from '../search/build-context';
import { selectSources, type SearchBucket } from '../search/select-sources';
import { interpolate } from '../templates/interpolate';
import {
  buildUpdateResponseSchema,
  buildVerifyResponseSchema,
  deriveTopic,
  promptsForLanguage,
  type TemplateConfig,
} from '../templates/schema';
import { validateOutput } from './validate-output';
import {
  BudgetExceededError,
  type LlmCallRecord,
  type PipelineDeps,
  type PipelineResult,
  type RejectedItem,
} from './types';

/**
 * Orquestrador do pipeline de conteúdo — a porta integral do fluxo do n8n v4:
 * strip do bloco gerenciado → queries por locale → busca → seleção de fontes →
 * skip por hash → extract → contexto → geração (structured output) →
 * verificação LLM → validação determinística → render/injeção do bloco.
 *
 * `mode: 'update'` recebe o HTML atual do post; `mode: 'generate'` (pautas)
 * parte só do tópico. Publicação e persistência ficam com o chamador.
 */

export interface PipelineInput {
  mode: 'update' | 'generate';
  template: TemplateConfig;
  /** Idioma do conteúdo (prompts/datas). Cai no defaultLanguage do template. */
  language?: string;
  siteName?: string;
  post: {
    id?: number;
    title: string;
    slug: string;
    /** HTML atual (mode update). */
    contentRaw?: string;
  };
  /** Tópico explícito (pautas); no update é derivado do título pelo template. */
  topicOverride?: string;
  extraInstructions?: string;
}

interface EnvelopeParsed {
  hasChanges: boolean;
  action: string;
  noDataFound: boolean;
  newTitle: string;
  updatedHtml: string | null;
  changesSummary: string;
  data: Record<string, unknown>;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function runPipeline(input: PipelineInput, deps: PipelineDeps): Promise<PipelineResult> {
  const cfg = input.template;
  const language = input.language ?? cfg.defaultLanguage;
  const now = deps.now?.() ?? new Date();
  const log = deps.log ?? (() => {});
  const llmCalls: LlmCallRecord[] = [];

  const base: PipelineResult = {
    status: 'no_change',
    hasChanges: false,
    action: null,
    newTitle: null,
    finalHtml: null,
    changesSummary: null,
    skipReason: null,
    noDataFound: false,
    data: {},
    rejected: [],
    dropped: [],
    validationErrors: [],
    verifyFailed: false,
    sources: [],
    sourcesHash: null,
    resultsCount: 0,
    extractedResultsCount: 0,
    llmCalls,
    inputTokens: 0,
    outputTokens: 0,
  };

  const finish = (patch: Partial<PipelineResult>): PipelineResult => {
    const r = { ...base, ...patch, llmCalls };
    r.inputTokens = llmCalls.reduce((acc, c) => acc + c.inputTokens, 0);
    r.outputTokens = llmCalls.reduce((acc, c) => acc + c.outputTokens, 0);
    return r;
  };

  // 1. Strip do bloco gerenciado (idempotência da re-injeção)
  const rawHtml =
    input.mode === 'update' && input.post.contentRaw
      ? cfg.managedBlock.enabled
        ? stripManagedBlock(input.post.contentRaw, cfg.managedBlock)
        : input.post.contentRaw
      : '';

  // 2. Tópico
  const topic = input.topicOverride?.trim() || deriveTopic(input.post.title, cfg.topic);

  // 3. Queries por locale do template
  const queries = cfg.queries.map((q) => ({
    name: q.name,
    query: interpolate(q.template, {
      topic,
      postTitle: input.post.title,
      monthYear: monthYear(q.locale, now),
      prevMonthYear: prevMonthYear(q.locale, now),
      year: now.getFullYear(),
    }),
  }));

  // 4. Busca (sequencial, tolerante a falha individual — como no n8n)
  const buckets: SearchBucket[] = [];
  for (const q of queries) {
    log(`busca [${q.name}]: ${q.query}`);
    const res = await deps.search.search(q.query);
    if (res.error) log(`busca [${q.name}] falhou: ${res.error}`);
    buckets.push({ name: q.name, query: q.query, results: res.results });
  }

  // 5. Seleção de fontes
  const selection = selectSources(buckets, cfg.sources);
  log(`fontes: ${selection.candidates.length} selecionadas de ${selection.totalMergedResultsCount} únicas`);

  // 6. Hash das fontes → skip antes de gastar Extract/LLM
  const sourcesHash = sha256(
    selection.candidates
      .map((c) => c.key + '\n' + c.searchText)
      .sort()
      .join('\n---\n'),
  );
  if (input.mode === 'update' && (await deps.shouldSkipSources?.(sourcesHash))) {
    return finish({
      status: 'skipped_sources_unchanged',
      sourcesHash,
      skipReason: 'fontes inalteradas desde a última execução',
    });
  }

  // 7. Extract + contexto
  const extractFn = deps.extract ?? (async (urls: string[]) => (await deps.search.extract(urls)).results);
  const extractResults = await extractFn(selection.candidates.map((c) => c.url));
  const context = buildSearchContext(selection.candidates, extractResults, cfg.sources);
  log(`contexto: ${context.searchContext.length} chars de ${context.resultsCount} fontes (${context.extractedResultsCount} extraídas)`);

  const sourcesPatch = {
    sources: context.sources,
    sourcesHash,
    resultsCount: context.resultsCount,
    extractedResultsCount: context.extractedResultsCount,
  };

  // 8. Prompt de geração/atualização
  const prompts = promptsForLanguage(cfg, language);
  const promptTemplate = input.mode === 'generate' ? prompts.generate : prompts.update;
  if (!promptTemplate) {
    return finish({
      ...sourcesPatch,
      status: 'llm_failed',
      skipReason: `template sem prompt de ${input.mode === 'generate' ? 'geração' : 'atualização'} para ${language}`,
    });
  }

  const promptVars = {
    today: todayLong(language, now),
    monthYear: monthYear(language, now),
    prevMonthYear: prevMonthYear(language, now),
    topic,
    postTitle: input.post.title,
    currentHtml: (rawHtml || '(post vazio)').slice(0, 8000),
    searchContext: context.searchContext || '(nenhum resultado)',
    siteName: input.siteName ?? '',
    extraInstructions: input.extraInstructions ?? '',
  };
  const prompt = interpolate(promptTemplate, promptVars);

  // 9. Chamada LLM de geração
  try {
    await deps.checkBudget?.();
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return finish({ ...sourcesPatch, status: 'budget_exceeded', skipReason: err.message });
    }
    throw err;
  }

  let genText: string;
  try {
    const gen = await deps.llmGenerate.complete({
      prompt,
      schema: buildUpdateResponseSchema(cfg.extraction.dataSchema),
      schemaName: 'content_pilot_update',
      maxTokens: cfg.llmDefaults.generateMaxTokens,
      temperature: cfg.llmDefaults.generateTemperature,
    });
    llmCalls.push({
      purpose: 'generate',
      provider: gen.provider,
      model: gen.model,
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
      durationMs: gen.durationMs,
      status: gen.truncated ? 'truncated' : 'ok',
    });
    if (!gen.text) return finish({ ...sourcesPatch, status: 'llm_failed', skipReason: 'Resposta da API LLM vazia' });
    if (gen.truncated) return finish({ ...sourcesPatch, status: 'llm_failed', skipReason: 'Resposta do LLM truncada (max_tokens)' });
    genText = gen.text;
  } catch (err) {
    if (err instanceof LlmError) {
      llmCalls.push({
        purpose: 'generate',
        provider: deps.llmGenerate.provider,
        model: deps.llmGenerate.model,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        status: 'error',
      });
      return finish({ ...sourcesPatch, status: 'llm_failed', skipReason: err.message });
    }
    throw err;
  }

  const parsedRaw = extractJson(genText) as Partial<EnvelopeParsed> | null;
  if (!parsedRaw) {
    return finish({ ...sourcesPatch, status: 'llm_failed', skipReason: 'JSON não encontrado na resposta do LLM' });
  }

  const parsed: EnvelopeParsed = {
    hasChanges: input.mode === 'generate' ? true : parsedRaw.hasChanges === true,
    action: typeof parsedRaw.action === 'string' ? parsedRaw.action : 'update',
    noDataFound: parsedRaw.noDataFound === true,
    newTitle: typeof parsedRaw.newTitle === 'string' && parsedRaw.newTitle ? parsedRaw.newTitle : input.post.title,
    updatedHtml: typeof parsedRaw.updatedHtml === 'string' ? parsedRaw.updatedHtml : null,
    changesSummary: typeof parsedRaw.changesSummary === 'string' ? parsedRaw.changesSummary : 'Sem mudanças',
    data:
      parsedRaw.data && typeof parsedRaw.data === 'object' ? (parsedRaw.data as Record<string, unknown>) : {},
  };

  if (!parsed.hasChanges) {
    return finish({
      ...sourcesPatch,
      status: 'no_change',
      changesSummary: parsed.changesSummary,
      noDataFound: parsed.noDataFound,
    });
  }

  // 10. Verificação LLM (temp 0) dos itens verbatim
  let data = parsed.data;
  let rejected: RejectedItem[] = [];
  let verifyFailed = false;

  const verbatimItemCount = cfg.extraction.enabled
    ? cfg.extraction.verbatimLists.reduce(
        (acc, l) => acc + (Array.isArray(data[l.path]) ? (data[l.path] as unknown[]).length : 0),
        0,
      )
    : 0;

  if (cfg.extraction.enabled && verbatimItemCount > 0 && prompts.verify) {
    const candidates = cfg.extraction.verbatimLists.flatMap((l) =>
      (Array.isArray(data[l.path]) ? (data[l.path] as Array<Record<string, unknown>>) : []).map((item) => ({
        list: l.path,
        value: String(item[l.valueField] ?? ''),
        source: String(item.source ?? ''),
      })),
    );
    const verifyPrompt = interpolate(prompts.verify, {
      ...promptVars,
      candidatesJson: JSON.stringify(candidates, null, 2),
    });

    try {
      await deps.checkBudget?.();
      const ver = await deps.llmVerify.complete({
        prompt: verifyPrompt,
        schema: buildVerifyResponseSchema(),
        schemaName: 'content_pilot_verify',
        maxTokens: cfg.llmDefaults.verifyMaxTokens,
        temperature: cfg.llmDefaults.verifyTemperature,
      });
      llmCalls.push({
        purpose: 'verify',
        provider: ver.provider,
        model: ver.model,
        inputTokens: ver.inputTokens,
        outputTokens: ver.outputTokens,
        durationMs: ver.durationMs,
        status: ver.truncated ? 'truncated' : 'ok',
      });
      const verParsed = extractJson(ver.text) as {
        approved?: Array<{ list?: string; value?: string }>;
        rejected?: Array<{ value?: string; reason?: string }>;
      } | null;
      if (!verParsed) {
        // Passthrough: a checagem verbatim determinística ainda protege (camada 3)
        verifyFailed = true;
      } else {
        const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
        const approvedByList = new Map<string, Set<string>>();
        for (const a of verParsed.approved ?? []) {
          const list = String(a.list ?? '');
          if (!approvedByList.has(list)) approvedByList.set(list, new Set());
          approvedByList.get(list)!.add(norm(a.value));
        }
        data = { ...data };
        for (const l of cfg.extraction.verbatimLists) {
          const approved = approvedByList.get(l.path) ?? new Set();
          data[l.path] = (Array.isArray(data[l.path]) ? (data[l.path] as Array<Record<string, unknown>>) : []).filter(
            (item) => approved.has(norm(item[l.valueField])),
          );
        }
        rejected = (verParsed.rejected ?? []).map((r) => ({
          value: String(r.value ?? ''),
          reason: String(r.reason ?? ''),
        }));
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return finish({ ...sourcesPatch, status: 'budget_exceeded', skipReason: err.message });
      }
      if (err instanceof LlmError) {
        llmCalls.push({
          purpose: 'verify',
          provider: deps.llmVerify.provider,
          model: deps.llmVerify.model,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
          status: 'error',
        });
        verifyFailed = true; // passthrough marcado — camada 3 ainda filtra
      } else {
        throw err;
      }
    }
  }

  // 11. Validação determinística fail-safe (camada 3)
  const validation = validateOutput(
    {
      hasChanges: true,
      noDataFound: parsed.noDataFound,
      newTitle: parsed.newTitle,
      updatedHtml: parsed.updatedHtml,
      data,
      searchContext: context.searchContext,
      resultsCount: context.resultsCount,
    },
    cfg,
  );

  if (!validation.ok) {
    return finish({
      ...sourcesPatch,
      status: 'validation_failed',
      action: parsed.action,
      newTitle: parsed.newTitle,
      noDataFound: parsed.noDataFound,
      data: validation.data,
      rejected,
      dropped: validation.dropped,
      validationErrors: validation.errors,
      verifyFailed,
      changesSummary: parsed.changesSummary,
    });
  }

  // 12. Render + injeção do bloco gerenciado
  let finalHtml = parsed.updatedHtml ?? '';
  if (cfg.managedBlock.enabled && cfg.managedBlock.rendererId) {
    const renderer = managedBlockRenderers[cfg.managedBlock.rendererId];
    if (renderer) {
      const inner = renderer({
        data: validation.data,
        slug: input.post.slug,
        topicLabel: topic || input.post.title,
        locale: language,
        now,
      });
      finalHtml = injectManagedBlock(finalHtml, wrapManagedBlock(inner, cfg.managedBlock.markerPrefix));
    } else {
      log(`renderer "${cfg.managedBlock.rendererId}" não registrado — bloco não injetado`);
    }
  }

  return finish({
    ...sourcesPatch,
    status: 'ready',
    hasChanges: true,
    action: parsed.action,
    newTitle: parsed.newTitle,
    finalHtml,
    changesSummary: parsed.changesSummary,
    noDataFound: parsed.noDataFound,
    data: validation.data,
    rejected,
    dropped: validation.dropped,
    verifyFailed,
  });
}
