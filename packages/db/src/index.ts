export * from './client';
export * as schema from './schema';
export * from './schema';

// Re-export dos operadores de query mais usados, para consumidores que não
// declaram drizzle-orm diretamente (ex.: apps/worker).
export { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
