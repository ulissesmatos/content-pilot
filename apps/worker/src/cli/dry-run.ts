import { config } from 'dotenv';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createDb } from '@content-pilot/db';
import { estimateCostUsd, runPipeline, type LlmProviderName } from '@content-pilot/core';
import { resolveLlmProvider, resolveSearchClient, resolveSite, resolveTemplate, resolveWordPressAdapter } from '../lib/resolve';

config({ path: resolve(process.cwd(), '../../.env') });

/**
 * CLI de fumaça do pipeline — roda o fluxo completo contra um post REAL do
 * WordPress sem publicar nada (a menos que --publish seja passado).
 *
 * Uso:
 *   pnpm --filter worker dry-run -- --post-id 123 [--site nome] [--template game-codes]
 *     [--provider anthropic] [--model claude-haiku-4-5] [--language pt-BR] [--publish]
 */
async function main() {
  const { values } = parseArgs({
    options: {
      'post-id': { type: 'string' },
      site: { type: 'string' },
      template: { type: 'string', default: 'game-codes' },
      provider: { type: 'string', default: 'anthropic' },
      model: { type: 'string', default: 'claude-haiku-4-5' },
      language: { type: 'string' },
      profile: { type: 'string', default: 'full' },
      publish: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  });

  if (!values['post-id']) {
    console.error('Uso: pnpm --filter worker dry-run -- --post-id <id> [--site nome] [--template slug] [--publish]');
    process.exit(1);
  }

  const db = createDb();
  const site = await resolveSite(db, values.site);
  console.log(`site: ${site.name} (${site.baseUrl})`);

  const [wp, template, search] = await Promise.all([
    resolveWordPressAdapter(db, site),
    resolveTemplate(db, site.workspaceId, values.template!),
    resolveSearchClient(db, site.workspaceId),
  ]);
  const provider = values.provider as LlmProviderName;
  const llm = await resolveLlmProvider(db, site.workspaceId, { provider, model: values.model! });
  console.log(`template: ${template.slug} | llm: ${provider}/${values.model}`);

  const post = await wp.getPost(Number(values['post-id']));
  console.log(`post #${post.id}: "${post.title}" (${post.contentRaw.length} chars${post.usedRenderedFallback ? ', FALLBACK RENDERED!' : ''})`);

  const startedAt = Date.now();
  const result = await runPipeline(
    {
      mode: 'update',
      profile: values.profile === 'eco' ? 'eco' : 'full',
      template: template.config,
      language: values.language ?? site.defaultLanguage,
      siteName: site.name,
      post: { id: post.id, title: post.title, slug: post.slug, contentRaw: post.contentRaw },
    },
    {
      llmGenerate: llm,
      llmVerify: llm,
      search,
      log: (msg) => console.log(`  [pipeline] ${msg}`),
    },
  );

  console.log('\n===== RESULTADO =====');
  console.log(`status: ${result.status} | ação: ${result.action ?? '-'} | duração: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  if (result.skipReason) console.log(`motivo: ${result.skipReason}`);
  if (result.validationErrors.length) console.log(`validação: ${result.validationErrors.join('; ')}`);
  console.log(`título: ${result.newTitle ?? '-'}`);
  console.log(`resumo: ${result.changesSummary ?? '-'}`);
  console.log(`fontes: ${result.resultsCount} (${result.extractedResultsCount} extraídas) | hash: ${result.sourcesHash?.slice(0, 12)}`);

  for (const [list, items] of Object.entries(result.data)) {
    if (Array.isArray(items)) console.log(`data.${list}: ${items.length} itens`);
  }
  if (result.dropped.length) console.log(`dropados (camada 3): ${result.dropped.map((d) => `${d.value} [${d.reason}]`).join(', ')}`);
  if (result.rejected.length) console.log(`rejeitados (verificação): ${result.rejected.map((r) => r.value).join(', ')}`);
  if (result.verifyFailed) console.log('⚠ verificação LLM falhou — passthrough com filtro determinístico');

  const cost = result.llmCalls.reduce((acc, c) => acc + (estimateCostUsd(c.model, c.inputTokens, c.outputTokens) ?? 0), 0);
  console.log(`tokens: ${result.inputTokens} in / ${result.outputTokens} out | custo estimado: US$ ${cost.toFixed(4)}`);

  if (result.status === 'ready' && result.finalHtml) {
    const outPath = values.out ?? resolve(process.cwd(), `dry-run-post-${post.id}.html`);
    mkdirSync(resolve(outPath, '..'), { recursive: true });
    writeFileSync(outPath, result.finalHtml, 'utf8');
    console.log(`\nHTML final salvo em: ${outPath}`);

    if (values.publish) {
      console.log('publicando no WordPress...');
      await wp.updatePost(post.id, { title: result.newTitle ?? post.title, content: result.finalHtml, status: 'publish' });
      console.log('publicado.');
    } else {
      console.log('(dry-run: nada foi publicado — use --publish para aplicar)');
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('ERRO:', err instanceof Error ? err.message : err);
  process.exit(1);
});
