import type { LlmProvider } from '../llm/types';
import type { SearchClient, TavilyExtractResult } from '../search/tavily';
import type { ContextSource } from '../search/build-context';
import type { DroppedItem } from './validate-output';

export class BudgetExceededError extends Error {
  constructor(message = 'Orçamento de tokens do run excedido') {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export interface LlmCallRecord {
  purpose: 'generate' | 'verify';
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Custo real informado pelo provedor (OpenRouter); null = usar estimativa por tabela. */
  costUsd: number | null;
  durationMs: number;
  status: 'ok' | 'error' | 'truncated';
}

export interface PipelineDeps {
  llmGenerate: LlmProvider;
  llmVerify: LlmProvider;
  search: SearchClient;
  /** Extract com cache (source_cache). Default: search.extract direto. */
  extract?: (urls: string[]) => Promise<TavilyExtractResult[]>;
  now?: () => Date;
  /** Lança BudgetExceededError se o orçamento do run estourou. Chamado antes de cada chamada LLM. */
  checkBudget?: () => Promise<void> | void;
  /** Retorna true para pular o post (fontes não mudaram desde a última execução). */
  shouldSkipSources?: (sourcesHash: string) => Promise<boolean> | boolean;
  log?: (msg: string) => void;
}

export type PipelineStatus =
  | 'ready' // conteúdo validado, pronto para publicar
  | 'no_change'
  | 'skipped_sources_unchanged'
  | 'validation_failed'
  | 'llm_failed'
  | 'budget_exceeded';

export interface RejectedItem {
  value: string;
  reason: string;
}

export interface PrePassInfo {
  ran: boolean;
  changed: boolean;
  missing: string[];
  newCandidates: string[];
}

export interface PipelineResult {
  status: PipelineStatus;
  hasChanges: boolean;
  action: string | null;
  newTitle: string | null;
  /** HTML final com bloco gerenciado injetado (quando aplicável). */
  finalHtml: string | null;
  changesSummary: string | null;
  skipReason: string | null;
  noDataFound: boolean;
  data: Record<string, unknown>;
  rejected: RejectedItem[];
  dropped: DroppedItem[];
  validationErrors: string[];
  verifyFailed: boolean;
  sources: ContextSource[];
  sourcesHash: string | null;
  resultsCount: number;
  extractedResultsCount: number;
  llmCalls: LlmCallRecord[];
  inputTokens: number;
  outputTokens: number;
  /** Diagnóstico da pré-checagem determinística (modo econômico). */
  prePass: PrePassInfo | null;
}
