import { LlmError } from '../llm/client';
import { extractJson } from '../llm/parse';
import type { JsonSchema, LlmProvider } from '../llm/types';
import { titleTokens } from '../autopilot/discover';
import { applyStyleGuard, buildStyleInstructions, type StylePolicy } from '../text/style-guard';
import { BudgetExceededError, type LlmCallRecord } from './types';

/**
 * Revisor editorial: relê o rascunho como um editor faria antes de publicar.
 *
 * Procura trecho maçante, seção curta demais e o que soa como IA, reescreve o que
 * precisa e aponta onde uma imagem ajudaria. É uma etapa separada do redator de
 * propósito: quem escreve e quem revisa têm objetivos diferentes, e misturar os
 * dois num prompt só é o que fazia o modelo ignorar as regras de estilo.
 *
 * REGRA DE OURO: a revisão nunca pode piorar o artigo. Um LLM que reescreve o
 * texto inteiro pode perder um link, inventar um número ou encolher o conteúdo,
 * e nada disso aparece na hora. Por isso a saída só é aceita se passar pelas
 * guardas determinísticas de `acceptRevision`; senão, fica o original.
 */

export interface ReviewChange {
  kind: 'dull' | 'thin' | 'ai_tone' | 'other';
  /** Seção afetada (título ou "abertura"). */
  section: string;
  note: string;
}

export interface ImageHint {
  /** Título depois do qual uma imagem ajudaria; null = logo no começo. */
  afterHeading: string | null;
  /** O que a imagem deve mostrar. */
  description: string;
}

/** O revisor achou um título que casa melhor com o texto final. */
export interface TitleChange {
  from: string;
  to: string;
  /** Uma frase do porquê. */
  reason: string;
}

export interface ReviewInput {
  topic: string;
  title: string;
  html: string;
  language: string;
  /** Texto das fontes: a única base factual além do próprio rascunho. */
  context: string;
  style: StylePolicy;
  maxTokens: number;
  temperature?: number;
  /** Limites de tamanho do título (os da validação do template). */
  titleMin?: number;
  titleMax?: number;
}

export interface ReviewResult {
  status: 'revised' | 'unchanged' | 'rejected' | 'failed' | 'budget_exceeded';
  /** HTML final: o revisado quando aceito, o original em qualquer outro caso. */
  html: string;
  /** Título final: o novo quando o revisor achou um que casa melhor e passou nas guardas; senão o de entrada. */
  title: string;
  titleChange: TitleChange | null;
  changes: ReviewChange[];
  imageHints: ImageHint[];
  /** Por que a revisão foi descartada, quando foi. */
  reason: string | null;
  /** Vícios de IA que sobraram no texto final (para o relatório, não bloqueiam). */
  remainingTells: string[];
  llmCalls: LlmCallRecord[];
}

export interface ReviewDeps {
  llm: LlmProvider;
  checkBudget?: () => Promise<void> | void;
  log?: (msg: string) => void;
}

/** Expressões que denunciam texto de IA. Vão no prompt e servem de detector depois. */
const AI_TELLS_PT = [
  'no mundo atual',
  'nos dias de hoje',
  'no cenário atual',
  'vale ressaltar',
  'vale destacar',
  'vale a pena destacar',
  'é importante destacar',
  'é importante ressaltar',
  'é fundamental',
  'em resumo',
  'em suma',
  'sem dúvida',
  'não há dúvidas',
  'um verdadeiro',
  'mergulhar',
  'desvendar',
  'navegar pelo',
  'cada vez mais',
  'não apenas',
];

const AI_TELLS_EN = [
  "in today's world",
  'in the ever-evolving',
  "it's worth noting",
  'it is important to note',
  'delve',
  'in conclusion',
  'in summary',
  'a testament to',
  'navigate the',
  'unlock the',
];

export function findAiTells(text: string, language: string): string[] {
  const list = language.toLowerCase().startsWith('pt') ? AI_TELLS_PT : AI_TELLS_EN;
  const t = text.toLowerCase();
  return list.filter((p) => t.includes(p));
}

// ---------- guardas determinísticas ----------

const textOf = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const hrefsOf = (html: string) => new Set([...html.matchAll(/\bhref\s*=\s*"([^"]+)"/gi)].map((m) => m[1]!));

/** Números de 2+ dígitos, sem separador: "1.500" e "1500" contam como o mesmo. */
const numbersOf = (text: string) =>
  new Set([...text.matchAll(/\d[\d.,]*\d|\d/g)].map((m) => m[0].replace(/\D/g, '')).filter((n) => n.length >= 2));

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

export type Acceptance = { ok: true } | { ok: false; reason: string };

/**
 * A revisão pode entrar? Cada regra protege contra uma falha real de LLM:
 *
 *  - perdeu link ou título: reescrita descuidada apagou o que não devia;
 *  - número novo que não está no rascunho nem nas fontes: alucinação;
 *  - texto muito menor: "revisar" virou "resumir";
 *  - texto enorme: divagação;
 *  - blocos do Gutenberg desbalanceados, script, cerca de código: quebra o post.
 */
export function acceptRevision(original: string, revised: string, context: string): Acceptance {
  if (!revised || revised.length < 200) return { ok: false, reason: 'revisão vazia ou curta demais' };
  if (revised.includes('```')) return { ok: false, reason: 'revisão contém cerca de código markdown' };
  if (/<script\b|<style\b/i.test(revised)) return { ok: false, reason: 'revisão contém script ou style' };

  const opens = count(revised, /<!-- wp:/g);
  const closes = count(revised, /<!-- \/wp:/g);
  if (opens === 0) return { ok: false, reason: 'revisão perdeu os blocos do Gutenberg' };
  if (opens !== closes) return { ok: false, reason: 'blocos do Gutenberg desbalanceados na revisão' };

  const before = textOf(original).length;
  const ratio = before > 0 ? textOf(revised).length / before : 1;
  if (ratio < 0.8) return { ok: false, reason: `a revisão encolheu o texto para ${(ratio * 100).toFixed(0)}%` };
  if (ratio > 1.9) return { ok: false, reason: `a revisão inflou o texto para ${(ratio * 100).toFixed(0)}%` };

  if (count(revised, /<h[2-4]\b/gi) < count(original, /<h[2-4]\b/gi)) {
    return { ok: false, reason: 'a revisão removeu títulos de seção' };
  }
  if (count(revised, /<p\b/gi) < count(original, /<p\b/gi) * 0.7) {
    return { ok: false, reason: 'a revisão juntou parágrafos demais' };
  }

  const keptLinks = hrefsOf(revised);
  const lost = [...hrefsOf(original)].filter((h) => !keptLinks.has(h));
  if (lost.length > 0) return { ok: false, reason: `a revisão perdeu ${lost.length} link(s): ${lost[0]}` };

  const known = new Set([...numbersOf(textOf(original)), ...numbersOf(context)]);
  const invented = [...numbersOf(textOf(revised))].filter((n) => !known.has(n));
  if (invented.length > 0) {
    return { ok: false, reason: `a revisão introduziu número que não está no rascunho nem nas fontes: ${invented[0]}` };
  }
  return { ok: true };
}

/** Resultado da decisão sobre o título: mudou, ou por que não (motivo null = já casava, sem mudança). */
export type TitleVerdict = { ok: true; title: string } | { ok: false; reason: string | null };

const normTitle = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * O título proposto pelo revisor pode entrar? O revisor vê o texto inteiro e é quem melhor sabe
 * se o título ainda o descreve, mas nada garante que ele não vá trocar de assunto ou enfeitar o
 * título com um número que o texto não tem. As guardas:
 *
 *  - uma linha, sem marcação, dentro do tamanho que o template aceita;
 *  - continua no mesmo assunto (divide ao menos uma palavra significativa com o tema ou o título atual);
 *  - nenhum número novo que não esteja no título atual, no texto ou nas fontes;
 *  - passa pela guarda de estilo (travessão, data decorativa) como qualquer título.
 */
export function acceptTitle(
  current: string,
  candidate: string,
  ctx: { topic: string; html: string; context: string; style: StylePolicy; titleMin?: number; titleMax?: number },
): TitleVerdict {
  const raw = candidate.trim();
  if (!raw) return { ok: false, reason: null };
  if (/[\r\n]/.test(raw) || /[<>]|```/.test(raw) || /^[#*\-]/.test(raw)) {
    return { ok: false, reason: 'título com quebra de linha ou marcação' };
  }
  const unquoted = raw.replace(/\s+/g, ' ').replace(/^["“”']+|["“”']+$/g, '').trim();
  const styled = applyStyleGuard({ title: unquoted, html: '' }, ctx.style).title.trim();
  if (!styled || normTitle(styled) === normTitle(current)) return { ok: false, reason: null };

  const min = ctx.titleMin ?? 10;
  const max = ctx.titleMax ?? 120;
  if (styled.length < min || styled.length > max) {
    return { ok: false, reason: `título com ${styled.length} caracteres (o template aceita de ${min} a ${max})` };
  }

  const subject = new Set([...titleTokens(ctx.topic), ...titleTokens(current)]);
  if (subject.size > 0) {
    const shared = [...titleTokens(styled)].filter((t) => subject.has(t));
    if (shared.length === 0) return { ok: false, reason: 'o novo título mudou de assunto' };
  }

  const known = new Set([...numbersOf(current), ...numbersOf(ctx.topic), ...numbersOf(textOf(ctx.html)), ...numbersOf(ctx.context)]);
  const invented = [...numbersOf(styled)].filter((n) => !known.has(n));
  if (invented.length > 0) {
    return { ok: false, reason: `o novo título traz um número que não está no texto nem nas fontes: ${invented[0]}` };
  }
  return { ok: true, title: styled };
}

// ---------- prompt e schema ----------

function buildSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      revisedHtml: { type: 'string', description: 'O artigo INTEIRO revisado, em HTML Gutenberg. Nunca vazio.' },
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['dull', 'thin', 'ai_tone', 'other'] },
            section: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['kind', 'section', 'note'],
          additionalProperties: false,
        },
      },
      revisedTitle: {
        type: 'string',
        description: 'O título final do artigo. Igual ao atual se ele já descreve o texto; um novo se casa melhor.',
      },
      titleReason: { type: 'string', description: 'Uma frase do porquê da mudança de título. Vazio se o título não mudou.' },
      imageHints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            afterHeading: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            description: { type: 'string' },
          },
          required: ['afterHeading', 'description'],
          additionalProperties: false,
        },
      },
    },
    required: ['revisedHtml', 'revisedTitle', 'titleReason', 'changes', 'imageHints'],
    additionalProperties: false,
  };
}

const CONTEXT_CHARS = 30_000;

function buildPrompt(input: ReviewInput): string {
  const pt = input.language.toLowerCase().startsWith('pt');
  const tells = (pt ? AI_TELLS_PT : AI_TELLS_EN).map((t) => `"${t}"`).join(', ');
  const context = (input.context || '(sem fontes)').slice(0, CONTEXT_CHARS);
  const style = buildStyleInstructions(input.style, input.language);

  if (pt) {
    return `Você é o editor-chefe de um blog. Vai revisar o rascunho abaixo antes de publicar.

TEMA: ${input.topic}
TÍTULO: ${input.title}

RASCUNHO (HTML Gutenberg):
${input.html}

FONTES (a única base factual além do próprio rascunho; não invente nada fora daqui):
${context}

O QUE FAZER:
1. TRECHOS MAÇANTES: parágrafos que enrolam, repetem a ideia do anterior ou explicam o óbvio. Reescreva enxuto e com ritmo.
2. SEÇÕES CURTAS DEMAIS: as que só tocam no assunto. Aprofunde usando SOMENTE fatos que já estão no rascunho ou nas fontes.
3. CARA DE IA: reescreva aberturas genéricas, frases simétricas em trio, conclusões que só repetem o que foi dito, adjetivos inflados e perguntas retóricas de enchimento. Evite expressões como ${tells}. Escreva como um jornalista do nicho escreveria: direto, específico, com voz.
4. IMAGENS: diga depois de qual título uma imagem ajudaria o leitor e o que ela deve mostrar. Indique só onde realmente ajuda.
5. TÍTULO: depois de revisar, releia o título com o texto final na cabeça. Ele descreve exatamente o que o artigo entrega, sem prometer o que o texto não tem? Se sim, devolva-o IGUAL em revisedTitle. Se dá para casar melhor com o texto (mais fiel, mais específico, mais natural, sem sensacionalismo), devolva o novo em revisedTitle e explique em titleReason numa frase. O novo título mantém o assunto, tem entre ${input.titleMin ?? 10} e ${input.titleMax ?? 120} caracteres e não traz números, datas nem nomes que não estejam no texto ou nas fontes.

REGRAS DURAS (a revisão é descartada se alguma for quebrada):
- Preserve TODOS os blocos Gutenberg, todos os títulos e todos os links <a href> com as MESMAS URLs. Ao reescrever o texto DENTRO de um bloco, mantenha o par abertura+fechamento ao redor dele — ex.: <!-- wp:paragraph --><p>texto novo</p><!-- /wp:paragraph -->. NUNCA devolva uma abertura <!-- wp:X --> sem o <!-- /wp:X --> correspondente.
- NÃO invente números, datas, nomes, citações nem fatos. Se um dado não está no rascunho nem nas fontes, não o escreva.
- Não encurte o artigo: revisar não é resumir. Sem título dentro do HTML, sem <script>, sem <style>.
- O título novo é descartado se mudar de assunto ou trouxer número que não está no texto nem nas fontes.${style}

Devolva SEMPRE o artigo inteiro em revisedHtml (mesmo que mude pouco) e o título final em revisedTitle. Em changes, liste o que mudou e por quê, em frases curtas. Lista vazia é aceitável se o texto já estava bom.`;
  }

  return `You are the editor-in-chief of a blog. Review the draft below before it is published.

TOPIC: ${input.topic}
TITLE: ${input.title}

DRAFT (Gutenberg HTML):
${input.html}

SOURCES (the only factual base besides the draft itself; invent nothing outside it):
${context}

WHAT TO DO:
1. DULL PASSAGES: paragraphs that ramble, repeat the previous idea or explain the obvious. Rewrite tight and with rhythm.
2. THIN SECTIONS: ones that only touch the subject. Deepen them using ONLY facts already in the draft or the sources.
3. SOUNDS LIKE AI: rewrite generic openers, symmetrical triplets, conclusions that only repeat, inflated adjectives and filler rhetorical questions. Avoid phrases like ${tells}. Write like a niche journalist: direct, specific, with a voice.
4. IMAGES: say after which heading an image would help the reader and what it should show. Only where it really helps.
5. TITLE: after reviewing, reread the title with the final text in mind. Does it describe exactly what the article delivers, without promising what the text lacks? If so, return it UNCHANGED in revisedTitle. If it can match the text better (more faithful, more specific, more natural, not sensational), return the new one in revisedTitle and explain in titleReason in one sentence. The new title keeps the subject, is between ${input.titleMin ?? 10} and ${input.titleMax ?? 120} characters and has no numbers, dates or names that are not in the text or the sources.

HARD RULES (the review is discarded if any is broken):
- Preserve ALL Gutenberg blocks, headings and <a href> links with the SAME URLs. When rewriting the text INSIDE a block, keep the opening+closing pair around it — e.g., <!-- wp:paragraph --><p>new text</p><!-- /wp:paragraph -->. NEVER return an opening <!-- wp:X --> without its matching <!-- /wp:X -->.
- Do NOT invent numbers, dates, names, quotes or facts. If a datum is not in the draft or sources, do not write it.
- Do not shorten the article: reviewing is not summarizing. No title inside the HTML, no <script>, no <style>.
- The new title is discarded if it changes subject or has a number that is not in the text or the sources.${style}

ALWAYS return the whole article in revisedHtml (even if little changed) and the final title in revisedTitle. In changes, list what changed and why, in short sentences. An empty list is fine if the text was already good.`;
}

interface ReviewParsed {
  revisedHtml?: unknown;
  revisedTitle?: unknown;
  titleReason?: unknown;
  changes?: Array<{ kind?: unknown; section?: unknown; note?: unknown }>;
  imageHints?: Array<{ afterHeading?: unknown; description?: unknown }>;
}

const KINDS = new Set(['dull', 'thin', 'ai_tone', 'other']);

export async function reviewArticle(input: ReviewInput, deps: ReviewDeps): Promise<ReviewResult> {
  const log = deps.log ?? (() => {});
  const llmCalls: LlmCallRecord[] = [];
  const untouched = (patch: Partial<ReviewResult>): ReviewResult => ({
    status: 'unchanged',
    html: input.html,
    title: input.title,
    titleChange: null,
    changes: [],
    imageHints: [],
    reason: null,
    remainingTells: findAiTells(textOf(input.html), input.language),
    llmCalls,
    ...patch,
  });

  try {
    await deps.checkBudget?.();
  } catch (err) {
    if (err instanceof BudgetExceededError) return untouched({ status: 'budget_exceeded', reason: err.message });
    throw err;
  }

  let parsed: ReviewParsed | null;
  try {
    const res = await deps.llm.complete({
      prompt: buildPrompt(input),
      schema: buildSchema(),
      schemaName: 'content_pilot_review',
      maxTokens: input.maxTokens,
      temperature: input.temperature ?? 0.4,
    });
    llmCalls.push({
      purpose: 'review',
      provider: res.provider,
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: res.costUsd,
      durationMs: res.durationMs,
      status: res.truncated ? 'truncated' : 'ok',
    });
    if (res.truncated) {
      log('revisão: resposta truncada, mantendo o texto original');
      return untouched({ status: 'rejected', reason: 'resposta do revisor truncada (max_tokens)' });
    }
    parsed = extractJson(res.text) as ReviewParsed | null;
  } catch (err) {
    if (err instanceof BudgetExceededError) return untouched({ status: 'budget_exceeded', reason: err.message });
    if (err instanceof LlmError) {
      llmCalls.push({
        purpose: 'review',
        provider: deps.llm.provider,
        model: deps.llm.model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        durationMs: 0,
        status: 'error',
      });
      // Revisão é polimento: se falhar, o artigo original segue. Mas o motivo vai ao log.
      log(`revisão falhou, mantendo o texto original: ${err.message}`);
      return untouched({ status: 'failed', reason: err.message });
    }
    throw err;
  }

  const changes: ReviewChange[] = (parsed?.changes ?? [])
    .map((c) => ({
      kind: (KINDS.has(String(c.kind)) ? c.kind : 'other') as ReviewChange['kind'],
      section: String(c.section ?? '').trim(),
      note: String(c.note ?? '').trim(),
    }))
    .filter((c) => c.note);
  const imageHints: ImageHint[] = (parsed?.imageHints ?? [])
    .map((h) => ({
      afterHeading: typeof h.afterHeading === 'string' && h.afterHeading.trim() ? h.afterHeading.trim() : null,
      description: String(h.description ?? '').trim(),
    }))
    .filter((h) => h.description);

  const revisedRaw = typeof parsed?.revisedHtml === 'string' ? parsed.revisedHtml : '';
  // A guarda de estilo roda ANTES da aceitação: o revisor pode reintroduzir travessão,
  // e o que vai para a checagem é o que de fato seria publicado.
  const revised = applyStyleGuard({ title: input.title, html: revisedRaw }, input.style).html;

  const verdict = acceptRevision(input.html, revised, input.context);
  if (!verdict.ok) {
    log(`revisão descartada, mantendo o texto original: ${verdict.reason}`);
    // As dicas de imagem continuam úteis mesmo com a reescrita descartada. O título proposto
    // não: ele foi pensado para o texto revisado, e o texto que vale é o original.
    return untouched({ status: 'rejected', reason: verdict.reason, imageHints });
  }

  // O título é avaliado sobre o texto que de fato vai ao ar (revisado, ou o original se nada mudou).
  const proposedTitle = typeof parsed?.revisedTitle === 'string' ? parsed.revisedTitle : '';
  const titleVerdict = acceptTitle(input.title, proposedTitle, {
    topic: input.topic,
    html: revised,
    context: input.context,
    style: input.style,
    titleMin: input.titleMin,
    titleMax: input.titleMax,
  });
  let title = input.title;
  let titleChange: TitleChange | null = null;
  if (titleVerdict.ok) {
    title = titleVerdict.title;
    const reason = String(parsed?.titleReason ?? '').trim();
    titleChange = { from: input.title, to: title, reason };
    log(`revisão: título ajustado para casar com o texto: "${input.title}" → "${title}"`);
  } else if (titleVerdict.reason) {
    log(`revisão: título proposto descartado (${titleVerdict.reason}); fica "${input.title}"`);
  }

  if (revised === input.html && !titleChange) {
    log('revisão: o editor não achou o que mudar');
    return untouched({ status: 'unchanged', imageHints });
  }

  log(`revisão aceita: ${changes.length} ajuste(s), ${imageHints.length} sugestão(ões) de imagem`);
  return {
    status: 'revised',
    html: revised,
    title,
    titleChange,
    changes,
    imageHints,
    reason: null,
    remainingTells: findAiTells(textOf(revised), input.language),
    llmCalls,
  };
}
