import { config } from 'dotenv';
import { resolve } from 'node:path';
import { briefs, contentTemplates, createDb, eq, runs, sites } from '@content-pilot/db';
import { handleBriefGenerate } from '../queues/brief-generate';

config({ path: resolve(process.cwd(), '../../.env') });

/**
 * Cria um post de TESTE (rascunho) rodando o handler real de geração inline —
 * exercita SEO + links externos + imagem de capa (Fases 2/3) sem depender do
 * worker. Usa um modelo com visão para a imagem funcionar.
 */
async function main() {
  const db = createDb();

  const [site] = await db.select().from(sites).limit(1);
  if (!site) throw new Error('nenhum site cadastrado');
  const [tpl] = await db
    .select()
    .from(contentTemplates)
    .where(eq(contentTemplates.slug, 'generic-article'))
    .limit(1);
  if (!tpl) throw new Error('template generic-article não encontrado (rode o seed)');

  const topic = process.env.TEST_TOPIC ?? 'PlayStation 5: novidades e destaques';
  const model = process.env.TEST_MODEL ?? 'openai/gpt-4o-mini'; // visão via OpenRouter
  const provider = process.env.TEST_PROVIDER ?? 'openrouter';
  const llmTask = { provider, model };

  console.log(`site: ${site.name} (${site.baseUrl})`);
  console.log(`template: ${tpl.slug} | modelo: ${provider}/${model}`);
  console.log(`tópico: ${topic}\n`);

  const [brief] = await db
    .insert(briefs)
    .values({
      workspaceId: site.workspaceId,
      siteId: site.id,
      templateId: tpl.id,
      topic,
      keywords: ['playstation 5', 'ps5'],
      language: 'pt-BR',
      publishMode: 'draft', // TESTE: nunca publica direto
      status: 'queued',
      llmConfig: { generate: llmTask, verify: llmTask },
    })
    .returning({ id: briefs.id });

  const [run] = await db
    .insert(runs)
    .values({ workspaceId: site.workspaceId, briefId: brief!.id, trigger: 'manual', status: 'running' })
    .returning({ id: runs.id });

  console.log(`gerando (brief ${brief!.id}, run ${run!.id})…\n`);
  await handleBriefGenerate(db, { briefId: brief!.id, runId: run!.id });

  const [after] = await db.select().from(briefs).where(eq(briefs.id, brief!.id)).limit(1);
  console.log('\n=== RESULTADO ===');
  console.log('status da pauta:', after!.status);
  console.log('erro:', after!.error ?? '—');
  console.log('post WP:', after!.createdWpPostUrl ?? '(não criado)');
  console.log('post ID:', after!.createdWpPostId ?? '—');
  console.log(`\nVer no painel: /runs/${run!.id}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
