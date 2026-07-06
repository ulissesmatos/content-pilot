import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// Carrega o .env da raiz do monorepo (cwd = packages/db quando rodado via pnpm script)
config({ path: resolve(process.cwd(), '../../.env') });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://contentpilot:contentpilot@localhost:5433/contentpilot',
  },
});
