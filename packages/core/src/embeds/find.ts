import { keyTerms } from '../images/slots';
import { stripDiacritics } from '../i18n/slug';
import { LlmError } from '../llm/client';
import { extractJson } from '../llm/parse';
import type { JsonSchema, LlmProvider } from '../llm/types';
import { BudgetExceededError, type LlmCallRecord } from '../pipeline/types';
import type { SearchClient } from '../search/tavily';
import {
  canonicalTweetUrl,
  canonicalYoutubeUrl,
  parseTweet,
  parseYoutubeId,
  type EmbedItem,
} from './parse';

/**
 * Acha vídeo do YouTube e tweets para o artigo.
 *
 * O LLM NUNCA escreve URL. Cada candidato vem de uma busca real, tem a URL
 * parseada e canonizada e a existência confirmada pelo oEmbed público da própria
 * plataforma (vídeo apagado, privado ou sem embed, e tweet removido, não passam).
 * Só depois o modelo escolhe, e só entre os candidatos que sobreviveram: um
 * índice fora da lista é descartado.
 */

export interface FindEmbedsInput {
  topic: string;
  language: string;
  keywords?: string[];
  wantVideo: boolean;
  /** 0 desliga tweets. */
  maxTweets: number;
}

export interface FindEmbedsDeps {
  search: SearchClient;
  /** Modelo barato (o da etapa `verify`): é uma escolha simples entre poucos itens. */
  llm: LlmProvider;
  /** fetch para o oEmbed. Em produção, `publicFetch` (só HTTPS público, sem redirect). */
  fetchImpl: typeof fetch;
  checkBudget?: () => Promise<void> | void;
  log?: (msg: string) => void;
}

export interface FindEmbedsResult {
  embeds: EmbedItem[];
  llmCalls: LlmCallRecord[];
  /** O que foi buscado e por que algo não entrou. */
  notes: string[];
}

interface Candidate extends EmbedItem {
  /** Texto usado no gate de relevância (título, canal, texto do tweet). */
  haystack: string;
}

const VIDEO_DOMAINS = ['youtube.com', 'youtu.be'];
const TWEET_DOMAINS = ['x.com', 'twitter.com'];
const VERIFY_LIMIT = 6;
const OEMBED_TIMEOUT_MS = 8_000;

const norm = (s: string) => stripDiacritics(s.toLowerCase());
const stripTags = (h: string) =>
  h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&mdash;|&#8212;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function oembed(fetchImpl: typeof fetch, endpoint: string, url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchImpl(`${endpoint}?url=${encodeURIComponent(url)}&format=json`, {
      headers: { Accept: 'application/json', 'User-Agent': 'ContentPilotBot/1.0' },
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
    });
    if (!res.ok) return null; // 401/404: privado, apagado ou sem embed
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function verifyYoutube(fetchImpl: typeof fetch, id: string): Promise<Candidate | null> {
  const url = canonicalYoutubeUrl(id);
  const data = await oembed(fetchImpl, 'https://www.youtube.com/oembed', url);
  if (!data) return null;
  const title = String(data.title ?? '').trim();
  const author = String(data.author_name ?? '').trim();
  if (!title) return null;
  return { kind: 'youtube', id, url, title, author, haystack: norm(`${title} ${author}`) };
}

async function verifyTweet(fetchImpl: typeof fetch, t: { user: string; id: string }): Promise<Candidate | null> {
  const url = canonicalTweetUrl(t);
  const data = await oembed(fetchImpl, 'https://publish.twitter.com/oembed', url);
  if (!data) return null;
  const text = stripTags(String(data.html ?? '')).slice(0, 280);
  const author = String(data.author_name ?? t.user).trim();
  if (!text) return null;
  return { kind: 'tweet', id: t.id, url, title: text, author, haystack: norm(`${text} ${author} ${t.user}`) };
}

/** Só passa quem menciona pelo menos um termo do assunto: barra resultado aleatório da busca. */
function relevant(c: Candidate, terms: string[]): boolean {
  if (terms.length === 0) return true;
  return terms.some((t) => c.haystack.includes(norm(t)));
}

function buildSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      video: { type: 'integer', description: 'Índice do vídeo escolhido, ou -1 se nenhum serve.' },
      tweets: { type: 'array', items: { type: 'integer' }, description: 'Índices dos tweets escolhidos (pode ser vazio).' },
      reason: { type: 'string' },
    },
    required: ['video', 'tweets', 'reason'],
    additionalProperties: false,
  };
}

function buildPrompt(input: FindEmbedsInput, list: Candidate[]): string {
  const pt = input.language.toLowerCase().startsWith('pt');
  const rows = list
    .map((c, i) => `${i}: [${c.kind === 'youtube' ? (pt ? 'vídeo' : 'video') : 'tweet'}] ${c.author}: ${c.title}`)
    .join('\n');
  return pt
    ? `Você escolhe conteúdo incorporado (vídeo do YouTube e tweets) para um artigo sobre "${input.topic}".

CANDIDATOS (já verificados: existem e podem ser incorporados):
${rows}

REGRAS:
- Escolha até 1 vídeo${input.maxTweets > 0 ? ` e até ${input.maxTweets} tweet(s)` : ' e NENHUM tweet'}.
- Só o que trata DIRETAMENTE do assunto do artigo e vem de fonte oficial ou relevante (canal ou conta oficial do jogo, empresa ou veículo). Prefira o oficial ao reupload, à reação e ao comentário de terceiros.
- Vídeo clickbait, reação, reupload ou conteúdo de baixa qualidade não entra.
- Nenhum candidato serve? Devolva video = -1 e tweets vazio. Incorporar nada é melhor que incorporar algo fraco.

Responda exclusivamente com JSON: { "video": número ou -1, "tweets": [números], "reason": "1 frase" }`
    : `You pick embedded content (a YouTube video and tweets) for an article about "${input.topic}".

CANDIDATES (already verified: they exist and can be embedded):
${rows}

RULES:
- Pick up to 1 video${input.maxTweets > 0 ? ` and up to ${input.maxTweets} tweet(s)` : ' and NO tweets'}.
- Only what deals DIRECTLY with the article's subject and comes from an official or relevant source (the game's, company's or outlet's own channel or account). Prefer official over reuploads, reactions and third-party commentary.
- Clickbait, reaction, reupload or low-quality content does not qualify.
- Nothing fits? Return video = -1 and empty tweets. Embedding nothing beats embedding something weak.

Respond exclusively with JSON: { "video": number or -1, "tweets": [numbers], "reason": "one sentence" }`;
}

export async function findEmbeds(input: FindEmbedsInput, deps: FindEmbedsDeps): Promise<FindEmbedsResult> {
  const log = deps.log ?? (() => {});
  const llmCalls: LlmCallRecord[] = [];
  const notes: string[] = [];
  const empty = (): FindEmbedsResult => ({ embeds: [], llmCalls, notes });

  if (!input.wantVideo && input.maxTweets <= 0) return empty();

  const pt = input.language.toLowerCase().startsWith('pt');
  const anchor = input.keywords?.length ? input.keywords.slice(0, 2).join(' ') : input.topic;
  const terms = keyTerms([input.topic, ...(input.keywords ?? [])].join(' '), 6);

  // 1. Busca. O texto das páginas não interessa aqui, só as URLs.
  const searches: Array<Promise<Candidate[]>> = [];
  if (input.wantVideo) {
    const q = pt ? `${anchor} trailer oficial vídeo` : `${anchor} official trailer video`;
    log(`embeds [vídeo] busca: ${q}`);
    searches.push(
      deps.search
        .search(q, { depth: 'basic', maxResults: 8, includeDomains: VIDEO_DOMAINS, rawContent: false })
        .then(async (res) => {
          const ids = [...new Set(res.results.map((r) => parseYoutubeId(r.url)).filter((x): x is string => Boolean(x)))];
          const verified = await Promise.all(ids.slice(0, VERIFY_LIMIT).map((id) => verifyYoutube(deps.fetchImpl, id)));
          if (res.error) notes.push(`vídeo: busca falhou (${res.error})`);
          return verified.filter((c): c is Candidate => c !== null);
        }),
    );
  }
  if (input.maxTweets > 0) {
    const q = pt ? `${anchor} anúncio oficial` : `${anchor} official announcement`;
    log(`embeds [tweet] busca: ${q}`);
    searches.push(
      deps.search
        .search(q, { depth: 'basic', maxResults: 8, includeDomains: TWEET_DOMAINS, rawContent: false })
        .then(async (res) => {
          const seen = new Set<string>();
          const parsed = res.results
            .map((r) => parseTweet(r.url))
            .filter((t): t is { user: string; id: string } => t !== null)
            .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
          const verified = await Promise.all(parsed.slice(0, VERIFY_LIMIT).map((t) => verifyTweet(deps.fetchImpl, t)));
          if (res.error) notes.push(`tweets: busca falhou (${res.error})`);
          return verified.filter((c): c is Candidate => c !== null);
        }),
    );
  }

  const found = (await Promise.all(searches.map((p) => p.catch(() => [] as Candidate[])))).flat();
  const candidates = found.filter((c) => relevant(c, terms));
  log(`embeds: ${candidates.length} candidato(s) verificados e relevantes (de ${found.length} que existem)`);
  if (candidates.length === 0) {
    notes.push('embeds: nenhum candidato verificado e relevante');
    return empty();
  }

  // 2. Escolha do modelo, só entre os verificados.
  try {
    await deps.checkBudget?.();
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      notes.push('embeds: orçamento de tokens esgotado');
      return empty();
    }
    throw err;
  }

  let parsed: { video?: unknown; tweets?: unknown } | null;
  try {
    const res = await deps.llm.complete({
      prompt: buildPrompt(input, candidates),
      schema: buildSchema(),
      schemaName: 'content_pilot_embeds',
      maxTokens: 1_500,
      temperature: 0,
    });
    llmCalls.push({
      purpose: 'verify',
      provider: res.provider,
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: res.costUsd,
      durationMs: res.durationMs,
      status: res.truncated ? 'truncated' : 'ok',
    });
    parsed = extractJson(res.text) as typeof parsed;
  } catch (err) {
    if (err instanceof BudgetExceededError) return empty();
    if (err instanceof LlmError) {
      log(`embeds: escolha falhou, seguindo sem embeds: ${err.message}`);
      notes.push(`embeds: a escolha do modelo falhou (${err.message})`);
      return empty();
    }
    throw err;
  }

  // 3. Aplica a escolha, validando cada índice contra a lista verificada.
  const embeds: EmbedItem[] = [];
  const videoIdx = Number(parsed?.video);
  if (input.wantVideo && Number.isInteger(videoIdx) && candidates[videoIdx]?.kind === 'youtube') {
    embeds.push(strip(candidates[videoIdx]!));
  }
  const tweetIdx = Array.isArray(parsed?.tweets) ? (parsed!.tweets as unknown[]).map(Number) : [];
  const usedTweets = new Set<number>();
  for (const i of tweetIdx) {
    if (usedTweets.size >= input.maxTweets) break;
    if (!Number.isInteger(i) || usedTweets.has(i) || candidates[i]?.kind !== 'tweet') continue;
    usedTweets.add(i);
    embeds.push(strip(candidates[i]!));
  }

  notes.push(
    embeds.length > 0
      ? `embeds: ${embeds.filter((e) => e.kind === 'youtube').length} vídeo(s), ${embeds.filter((e) => e.kind === 'tweet').length} tweet(s)`
      : 'embeds: o modelo não achou nenhum que valha a pena',
  );
  return { embeds, llmCalls, notes };
}

function strip(c: Candidate): EmbedItem {
  return { kind: c.kind, id: c.id, url: c.url, title: c.title, author: c.author };
}
