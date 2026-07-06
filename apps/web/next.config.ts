import type { NextConfig } from 'next';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// O .env fica na raiz do monorepo; o Next só carrega o do diretório do app.
config({ path: resolve(process.cwd(), '../../.env') });

const nextConfig: NextConfig = {
  transpilePackages: ['@content-pilot/db', '@content-pilot/core'],
  output: 'standalone',
};

export default nextConfig;
