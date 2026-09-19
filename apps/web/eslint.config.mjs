import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['src/app/(dashboard)/**/*.{ts,tsx}', 'src/actions/{sites,jobs,briefs,autopilot,runs,templates,credentials,billing}.ts', 'src/lib/{tenant,wp,billing}.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@content-pilot/db', importNames: ['getDb', 'createDb'], message: 'Use getTenantDb(workspaceId) from the authenticated session.' }],
        patterns: ['@content-pilot/db/src/*'],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
