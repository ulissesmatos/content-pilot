export * from './client';
export * from './config-cache';
export * from './settings';
export * from './llm/price-table';
export * from './billing/model-resolver';
export * from './billing/byok';
export * from './billing/workspace-ai-settings';
export * from './auth/tokens';
export * as schema from './schema';
export * from './schema';

// Re-export dos operadores de query mais usados, para consumidores que não
// declaram drizzle-orm diretamente (ex.: apps/worker).
export { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
