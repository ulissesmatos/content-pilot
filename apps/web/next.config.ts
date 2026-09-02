import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// O .env fica na raiz do monorepo; o Next só carrega o do diretório do app.
config({ path: resolve(process.cwd(), '../../.env') });

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@content-pilot/db', '@content-pilot/core'],
  output: 'standalone',
};

export default withNextIntl(nextConfig);
