import { createHash } from 'node:crypto';
import { injectManagedBlock, stripManagedBlock, wrapManagedBlock } from '../html/managed-block';
import { monthYear, prevMonthYear, todayLong } from '../i18n/dates';
import { extractJson } from '../llm/parse';
import { LlmError } from '../llm/client';
import { managedBlockRenderers } from '../renderers';
import { buildSearchContext } from '../search/build-context';
import type { BuildContextResult } from '../search/build-context';
import { selectSources, type SearchBucket } from '../search/select-sources';
import { interpolate } from '../templates/interpolate';
import {
  buildUpdateResponseSchema,
  buildVerifyResponseSchema,
  deriveTopic,
  promptsForLanguage,
  resolveStylePolicy,
  type TemplateConfig,
} from '../templates/schema';
import { applyStyleGuard, buildLanguageInstruction, buildStyleInstructions } from '../text/style-guard';
import { buildTopicGuidance } from '../text/topic-guidance';
import { stageMarker } from './stages';
import { validateOutput } from './validate-output';
import { buildTrimmedContext, prePassCheck } from './pre-pass';
import {
  BudgetExceededError,
  type LlmCallRecord,
  type PipelineDeps,
  type PipelineResult,
  type PrePassInfo,
  type RejectedItem,
} from './types';

/**
 * Orquestrador do pipeline de conteúdo — a porta integral do fluxo do n8n v4:
 * strip do bloco gerenciado → queries por locale → busca → seleção de fontes →
 * skip por hash → extract → contexto → geração (structured output) →
 * verificação LLM → validação determinística → render/injeção do bloco.
 *
 * Perfis:
 * - `full`: fluxo completo (extract advanced + 2 chamadas LLM com contexto integral).
 * - `eco`: busca basic sem Extract, pré-checagem determinística compara as
 *   fontes com os dados já publicados; sem mudança → atualiza só o widget
 *   (zero IA); com mudança → 1 única chamada LLM com contexto reduzido a
 *   janelas ao redor dos códigos, sem a 2ª chamada de verificação (a checagem
 *   verbatim determinística continua ativa).
 */

export interface PipelineInput {
  mode: 'update' | 'generate';
  profile?: 'full' | 'eco';
  /** Sobrescreve a profundidade da busca Tavily (default: eco→basic, full→advanced). */
  searchDepth?: 'basic' | 'advanced';
  template: TemplateConfig;
  /** Idioma do conteúdo (prompts/datas). Cai no defaultLanguage do template. */
  language?: string;
  siteName?: string;
  /** URL base do site — links internos ao próprio domínio nunca são removidos. */
  siteBaseUrl?: string;
  /** Categorias reais do site (nomes) para o LLM escolher, quando seo.chooseCategory. */
  availableCategories?: string[];
  post: {
    id?: number;
    title: string;
    slug: string;
    /** HTML atual (mode update). */
    contentRaw?: string;
  };
  /** Dados extraídos publicados na última execução (pré-checagem do modo eco). */
  lastData?: Record<string, unknown> | null;
  /** Tópico explícito (pautas); no update é derivado do título pelo template. */
  topicOverride?: string;
  extraInstructions?: string;
  /**
   * Quem definiu o tema. 'suggested' (descoberta automática) é um norte que o redator pode
   * ajustar; 'requested' (pessoa) mantém o assunto. Só vale em `generate` de template de artigo.
   */
  topicOrigin?: 'suggested' | 'requested';
  /** Títulos já cobertos pelo blog: o redator não repete nenhum ao ajustar o enfoque. */
  avoidTitles?: string[];
  /** Contexto e rascunho de uma tentativa anterior, usados no retry sem refazer pesquisa. */
  retryContext?: {
    searchContext: string;
    sources: PipelineResult['sources'];
    sourcesHash: string | null;
    resultsCount: number;
    extractedResultsCount: number;
    draftText?: string | null;
  };
}

interface EnvelopeParsed {
  hasChanges: boolean;
  action: string;
  noDataFound: boolean;
  newTitle: string;
  updatedHtml: string | null;
  changesSummary: string;
  metaDescription: string;
  category: string | null;
  data: Record<string, unknown>;
}

const ECO = {
  searchDepth: 'basic' as const,
  maxResults: 10,
  trimmedContextMaxChars: 40_000,
  trimmedWindowChars: 350,
};

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Guardrail determinístico da categoria: só aceita um valor que exista de fato
 * na lista de categorias reais do site (casamento case-insensitive). Impede o
 * LLM de inventar uma categoria inexistente. null quando não bate ou não há lista.
 */
function resolveCategory(raw: unknown, available: string[]): string | null {
  const chosen = String(raw ?? '').trim();
  if (!chosen || available.length === 0) return null;
  const match = available.find((c) => c.toLowerCase() === chosen.toLowerCase());
  return match ?? null;
}

export async function runPipeline(input: PipelineInput, deps: PipelineDeps): Promise<PipelineResult> {
  const cfg = input.template;
  const profile = input.profile ?? 'full';
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
    searchContext: '',
    sourcesHash: null,
    resultsCount: 0,
    extractedResultsCount: 0,
    llmCalls,
    inputTokens: 0,
    outputTokens: 0,
    prePass: null,
    metaDescription: null,
    category: null,
    externalLinks: null,
    draftText: null,
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

  // 4-7. Busca e contexto. Um retry recebe o contexto persistido e não cobra
  // novamente pesquisa/extract; só a etapa de redação é refeita.
  let context: BuildContextResult;
  let sourcesHash: string;
  if (input.retryContext) {
    context = {
      searchContext: input.retryContext.searchContext,
      sources: input.retryContext.sources,
      resultsCount: input.retryContext.resultsCount,
      extractedResultsCount: input.retryContext.extractedResultsCount,
    };
    sourcesHash = input.retryContext.sourcesHash ?? sha256(input.retryContext.searchContext);
    log('retry: contexto de fontes reaproveitado; pesquisa não repetida');
  } else {
    const searchDepth = input.searchDepth ?? (profile === 'eco' ? ECO.searchDepth : 'advanced');
    const searchOpts = {
      depth: searchDepth,
      maxResults: profile === 'eco' ? ECO.maxResults : undefined,
    };
    const buckets: SearchBucket[] = await Promise.all(
      queries.map(async (q) => {
        log(`busca [${q.name}] (${searchDepth}): ${q.query}`);
        const res = await deps.search.search(q.query, searchOpts);
        if (res.error) log(`busca [${q.name}] falhou: ${res.error}`);
        return { name: q.name, query: q.query, results: res.results };
      }),
    );
    const selection = selectSources(buckets, cfg.sources);
    log(`fontes: ${selection.candidates.length} selecionadas de ${selection.totalMergedResultsCount} únicas`);
    sourcesHash = sha256(
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
    let extractResults: Awaited<ReturnType<NonNullable<PipelineDeps['extract']>>> = [];
    if (profile === 'full') {
      const extractFn = deps.extract ?? (async (urls: string[]) => (await deps.search.extract(urls)).results);
      extractResults = await extractFn(selection.candidates.map((c) => c.url));
    }
    context = buildSearchContext(selection.candidates, extractResults, cfg.sources);
  }
  log(
    `contexto: ${context.searchContext.length} chars de ${context.resultsCount} fontes` +
      (profile === 'full' ? ` (${context.extractedResultsCount} extraídas)` : ' (sem extract — modo eco)'),
  );

  const sourcesPatch = {
    sources: context.sources,
    searchContext: context.searchContext,
    sourcesHash,
    resultsCount: context.resultsCount,
    extractedResultsCount: context.extractedResultsCount,
  };

  // 8. Pré-checagem determinística (eco + update + extração + dados anteriores)
  let promptContext = context.searchContext;
  let prePassInfo: PrePassInfo | null = null;
  const lastData = input.lastData ?? null;

  if (
    profile === 'eco' &&
    input.mode === 'update' &&
    cfg.extraction.enabled &&
    cfg.extraction.verbatimLists.length > 0 &&
    lastData
  ) {
    const valuesOf = (listPath: string) =>
      (Array.isArray(lastData[listPath]) ? (lastData[listPath] as Array<Record<string, unknown>>) : []).map((item) =>
        String(item[cfg.extraction.verbatimLists.find((l) => l.path === listPath)!.valueField] ?? ''),
      );
    const lastValues = cfg.extraction.verbatimLists.flatMap((l) => valuesOf(l.path));
    // convenção: a primeira lista verbatim é a "principal" (ativos)
    const lastActiveValues = valuesOf(cfg.extraction.verbatimLists[0]!.path);

    if (lastValues.length > 0) {
      const pre = prePassCheck({
        searchContext: context.searchContext,
        lastValues,
        lastActiveValues,
        valuePattern: cfg.extraction.valuePattern,
      });
      prePassInfo = { ran: true, ...pre };
      log(
        `pré-checagem: ${pre.changed ? 'MUDANÇAS detectadas' : 'sem mudanças'} ` +
          `(sumiram: ${pre.missing.length}, novos candidatos: ${pre.newCandidates.length})`,
      );

      if (!pre.changed) {
        // Zero IA: re-renderiza o bloco gerenciado com os mesmos dados (data atualizada)
        const renderer = cfg.managedBlock.enabled ? managedBlockRenderers[cfg.managedBlock.rendererId] : undefined;
        if (renderer && rawHtml) {
          const inner = renderer({
            data: lastData,
            slug: input.post.slug,
            topicLabel: topic || input.post.title,
            locale: language,
            now,
          });
          const finalHtml = injectManagedBlock(rawHtml, wrapManagedBlock(inner, cfg.managedBlock.markerPrefix));
          return finish({
            ...sourcesPatch,
            status: 'ready',
            hasChanges: true,
            action: 'widget_refresh',
            newTitle: input.post.title,
            finalHtml,
            data: lastData,
            changesSummary: 'Pré-checagem sem IA: nenhum código novo ou expirado nas fontes — apenas a data do widget foi atualizada.',
            prePass: prePassInfo,
          });
        }
        return finish({
          ...sourcesPatch,
          status: 'no_change',
          changesSummary: 'Pré-checagem sem IA: nenhuma mudança detectada nas fontes.',
          prePass: prePassInfo,
        });
      }

      // Mudança detectada → contexto reduzido a janelas relevantes p/ a única chamada LLM
      promptContext = buildTrimmedContext(context.searchContext, [...pre.newCandidates, ...lastValues], {
        windowChars: ECO.trimmedWindowChars,
        maxChars: ECO.trimmedContextMaxChars,
      });
      log(`contexto reduzido: ${promptContext.length} chars (de ${context.searchContext.length})`);
    }
  }

  // 9. Prompt de geração/atualização
  const prompts = promptsForLanguage(cfg, language);
  const promptTemplate = input.mode === 'generate' ? prompts.generate : prompts.update;
  if (!promptTemplate) {
    return finish({
      ...sourcesPatch,
      status: 'llm_failed',
      skipReason: `template sem prompt de ${input.mode === 'generate' ? 'geração' : 'atualização'} para ${language}`,
      prePass: prePassInfo,
    });
  }

  const categoriesList = input.availableCategories?.filter(Boolean) ?? [];
  const promptVars = {
    today: todayLong(language, now),
    monthYear: monthYear(language, now),
    prevMonthYear: prevMonthYear(language, now),
    topic,
    postTitle: input.post.title,
    currentHtml: (rawHtml || '(post vazio)').slice(0, 8000),
    searchContext: promptContext || '(nenhum resultado)',
    siteName: input.siteName ?? '',
    extraInstructions: input.extraInstructions ?? '',
    categories: categoriesList.length ? categoriesList.join(', ') : '(nenhuma categoria disponível)',
    linkMin: cfg.externalLinks.min,
    linkMax: cfg.externalLinks.max,
  };
  // Regras de estilo entram em runtime, e não no texto do template: templates
  // clonados guardam o próprio prompt no banco e só assim recebem a regra.
  const stylePolicy = resolveStylePolicy(cfg);
  // O tema é um norte, não uma ordem: só em artigo novo. Template de dados estruturados (códigos,
  // cupons) tem o assunto amarrado ao que é extraído, e não pode mudar de enfoque.
  const topicGuidance =
    input.mode === 'generate' && !cfg.extraction.enabled
      ? buildTopicGuidance({ origin: input.topicOrigin ?? 'requested', language, avoidTitles: input.avoidTitles })
      : '';
  const retryDraftInstruction = input.retryContext?.draftText
    ? `\n\nRASCUNHO DA TENTATIVA ANTERIOR (reaproveite e corrija, sem perder conteúdo útil):\n${input.retryContext.draftText}`
    : '';
  const prompt =
    interpolate(promptTemplate, promptVars) +
    buildLanguageInstruction(language) +
    buildStyleInstructions(stylePolicy, language) +
    topicGuidance +
    retryDraftInstruction;

  // 10. Chamada LLM de geração
  if (input.mode === 'generate') log(stageMarker('redacao'));
  try {
    await deps.checkBudget?.();
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return finish({ ...sourcesPatch, status: 'budget_exceeded', skipReason: err.message, prePass: prePassInfo });
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
      costUsd: gen.costUsd,
      durationMs: gen.durationMs,
      status: gen.truncated ? 'truncated' : 'ok',
    });
    if (!gen.text)
      return finish({ ...sourcesPatch, status: 'llm_failed', skipReason: 'Resposta da API LLM vazia', prePass: prePassInfo });
    if (gen.truncated)
      return finish({
        ...sourcesPatch,
        status: 'llm_failed',
        skipReason: 'Resposta do LLM truncada (max_tokens)',
        prePass: prePassInfo,
      });
    genText = gen.text;
  } catch (err) {
    if (err instanceof LlmError) {
      llmCalls.push({
        purpose: 'generate',
        provider: deps.llmGenerate.provider,
        model: deps.llmGenerate.model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        durationMs: 0,
        status: 'error',
      });
      return finish({ ...sourcesPatch, status: 'llm_failed', skipReason: err.message, prePass: prePassInfo });
    }
    throw err;
  }

  const parsedRaw = extractJson(genText) as Partial<EnvelopeParsed> | null;
  if (!parsedRaw) {
    return finish({
      ...sourcesPatch,
      status: 'llm_failed',
      skipReason: 'JSON não encontrado na resposta do LLM',
      prePass: prePassInfo,
    });
  }

  const parsed: EnvelopeParsed = {
    hasChanges: input.mode === 'generate' ? true : parsedRaw.hasChanges === true,
    action: typeof parsedRaw.action === 'string' ? parsedRaw.action : 'update',
    noDataFound: parsedRaw.noDataFound === true,
    newTitle: typeof parsedRaw.newTitle === 'string' && parsedRaw.newTitle ? parsedRaw.newTitle : input.post.title,
    updatedHtml: typeof parsedRaw.updatedHtml === 'string' ? parsedRaw.updatedHtml : null,
    changesSummary: typeof parsedRaw.changesSummary === 'string' ? parsedRaw.changesSummary : 'Sem mudanças',
    metaDescription: typeof parsedRaw.metaDescription === 'string' ? parsedRaw.metaDescription.trim() : '',
    category: resolveCategory(parsedRaw.category, categoriesList),
    data:
      parsedRaw.data && typeof parsedRaw.data === 'object' ? (parsedRaw.data as Record<string, unknown>) : {},
  };

  // Guarda de estilo determinística (travessão, data decorativa no título).
  // Só em geração: num update o HTML é o post inteiro, e reescrever o que um
  // humano já escreveu seria mexer no que ninguém pediu para mexer.
  if (input.mode === 'generate' && parsed.updatedHtml) {
    const guarded = applyStyleGuard(
      { title: parsed.newTitle, html: parsed.updatedHtml, metaDescription: parsed.metaDescription },
      stylePolicy,
      { titleMinLength: cfg.validation.titleMin },
    );
    parsed.newTitle = guarded.title;
    parsed.updatedHtml = guarded.html;
    parsed.metaDescription = guarded.metaDescription;
    if (guarded.dashesRewritten > 0 || guarded.titleDateRemoved) {
      log(
        `estilo: ${guarded.dashesRewritten} travessão(ões) reescrito(s)` +
          (guarded.titleDateRemoved ? ', data removida do título' : ''),
      );
    }
  }

  if (!parsed.hasChanges) {
    return finish({
      ...sourcesPatch,
      status: 'no_change',
      changesSummary: parsed.changesSummary,
      noDataFound: parsed.noDataFound,
      prePass: prePassInfo,
    });
  }

  // 11. Verificação LLM (temp 0) dos itens verbatim — pulada no modo eco
  //     (a checagem verbatim determinística da etapa 12 continua ativa)
  let data = parsed.data;
  let rejected: RejectedItem[] = [];
  let verifyFailed = false;

  const verbatimItemCount = cfg.extraction.enabled
    ? cfg.extraction.verbatimLists.reduce(
        (acc, l) => acc + (Array.isArray(data[l.path]) ? (data[l.path] as unknown[]).length : 0),
        0,
      )
    : 0;

  if (profile === 'full' && cfg.extraction.enabled && verbatimItemCount > 0 && prompts.verify) {
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
        costUsd: ver.costUsd,
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
        return finish({ ...sourcesPatch, status: 'budget_exceeded', skipReason: err.message, prePass: prePassInfo });
      }
      if (err instanceof LlmError) {
        llmCalls.push({
          purpose: 'verify',
          provider: deps.llmVerify.provider,
          model: deps.llmVerify.model,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
          durationMs: 0,
          status: 'error',
        });
        verifyFailed = true; // passthrough marcado — camada 3 ainda filtra
      } else {
        throw err;
      }
    }
  }

  // 12. Validação determinística fail-safe (camada 3) — contra o mesmo contexto enviado ao LLM.
  //     Também sanitiza links externos alucinados contra as URLs das fontes.
  let validation = validateOutput(
    {
      hasChanges: true,
      noDataFound: parsed.noDataFound,
      newTitle: parsed.newTitle,
      updatedHtml: parsed.updatedHtml,
      data,
      searchContext: promptContext,
      resultsCount: context.resultsCount,
      allowedUrls: context.sources.map((s) => s.url),
      siteBaseUrl: input.siteBaseUrl,
      // só sanitiza em geração de conteúdo novo (ver nota no tipo)
      sanitizeLinks: cfg.externalLinks.enabled && input.mode === 'generate',
    },
    cfg,
  );
  const externalLinks = cfg.externalLinks.enabled && input.mode === 'generate' ? validation.externalLinks : null;
  if (externalLinks && externalLinks.stripped.length > 0) {
    log(`links externos removidos (não constam nas fontes): ${externalLinks.stripped.length}`);
  }

  if (!validation.ok) {
    const repairPrompt = [
      'O texto JSON abaixo falhou na validação determinística.',
      'Corrija SOMENTE os problemas listados e devolva exclusivamente um JSON válido com o mesmo schema.',
      'Preserve o título, dados, fatos, links permitidos e conteúdo útil já existente. Não invente informações.',
      `Problemas: ${validation.errors.join(' | ')}`,
      `Rascunho: ${JSON.stringify({
        hasChanges: parsed.hasChanges,
        action: parsed.action,
        noDataFound: parsed.noDataFound,
        newTitle: parsed.newTitle,
        updatedHtml: validation.html,
        changesSummary: parsed.changesSummary,
        metaDescription: parsed.metaDescription,
        category: parsed.category,
        data,
      })}`,
    ].join('\n\n');

    try {
      await deps.checkBudget?.();
      const repaired = await deps.llmGenerate.complete({
        prompt: repairPrompt,
        schema: buildUpdateResponseSchema(cfg.extraction.dataSchema),
        schemaName: 'content_pilot_repair',
        maxTokens: cfg.llmDefaults.generateMaxTokens,
        temperature: 0,
      });
      llmCalls.push({
        purpose: 'repair',
        provider: repaired.provider,
        model: repaired.model,
        inputTokens: repaired.inputTokens,
        outputTokens: repaired.outputTokens,
        costUsd: repaired.costUsd,
        durationMs: repaired.durationMs,
        status: repaired.truncated ? 'truncated' : 'ok',
      });
      const repairedRaw = extractJson(repaired.text) as Partial<EnvelopeParsed> | null;
      if (repairedRaw && !repaired.truncated) {
        parsed.newTitle = typeof repairedRaw.newTitle === 'string' && repairedRaw.newTitle ? repairedRaw.newTitle : parsed.newTitle;
        parsed.updatedHtml = typeof repairedRaw.updatedHtml === 'string' ? repairedRaw.updatedHtml : parsed.updatedHtml;
        parsed.metaDescription = typeof repairedRaw.metaDescription === 'string' ? repairedRaw.metaDescription.trim() : parsed.metaDescription;
        parsed.category = resolveCategory(repairedRaw.category, categoriesList);
        data = repairedRaw.data && typeof repairedRaw.data === 'object' ? (repairedRaw.data as Record<string, unknown>) : data;
        const repairedValidation = validateOutput(
          {
            hasChanges: true,
            noDataFound: repairedRaw.noDataFound === true,
            newTitle: parsed.newTitle,
            updatedHtml: parsed.updatedHtml,
            data,
            searchContext: promptContext,
            resultsCount: context.resultsCount,
            allowedUrls: context.sources.map((s) => s.url),
            siteBaseUrl: input.siteBaseUrl,
            sanitizeLinks: cfg.externalLinks.enabled && input.mode === 'generate',
          },
          cfg,
        );
        if (repairedValidation.ok) {
          validation = repairedValidation;
          parsed.noDataFound = repairedRaw.noDataFound === true;
          log('validação: reparo automático aprovado');
        }
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return finish({ ...sourcesPatch, status: 'budget_exceeded', skipReason: err.message, prePass: prePassInfo });
      }
      if (err instanceof LlmError) {
        llmCalls.push({
          purpose: 'repair',
          provider: deps.llmGenerate.provider,
          model: deps.llmGenerate.model,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
          durationMs: 0,
          status: 'error',
        });
        log(`validação: reparo automático falhou: ${err.message}`);
      } else {
        throw err;
      }
    }
  }

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
      metaDescription: parsed.metaDescription || null,
      category: parsed.category,
      externalLinks,
      draftText: JSON.stringify({
        hasChanges: parsed.hasChanges,
        action: parsed.action,
        noDataFound: parsed.noDataFound,
        newTitle: parsed.newTitle,
        updatedHtml: parsed.updatedHtml,
        changesSummary: parsed.changesSummary,
        metaDescription: parsed.metaDescription,
        category: parsed.category,
        data: validation.data,
      }),
      prePass: prePassInfo,
    });
  }

  // 13. Render + injeção do bloco gerenciado (usa o HTML já sanitizado)
  let finalHtml = validation.html;
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
    metaDescription: parsed.metaDescription || null,
    category: parsed.category,
    externalLinks,
    prePass: prePassInfo,
  });
}
