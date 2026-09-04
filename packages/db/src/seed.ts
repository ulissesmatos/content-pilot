import { config } from 'dotenv';
import { resolve } from 'node:path';
import { hash } from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { gameCodesTemplate, genericArticleTemplate, parseTemplateConfig } from '@content-pilot/core';
import { createDb } from './client';
import { contentTemplates, modelProfileEntries, modelProfiles, users, workspaces } from './schema';

config({ path: resolve(import.meta.dirname, '../../../.env') });

/**
 * Seed idempotente: workspace default, usuário admin (ADMIN_EMAIL/ADMIN_PASSWORD
 * do .env), templates builtin (workspace NULL, read-only no painel) e os
 * perfis de modelo usados pelo pipeline.
 */

/**
 * Perfis iniciais.
 *
 * `standard` é o default e reproduz os modelos que já estavam em uso antes de
 * a escolha sair da mão do cliente — assim ligar o perfil não muda o
 * comportamento de nenhuma execução existente.
 *
 * `illustrate` tem entrada própria e precisa de um modelo COM VISÃO: se
 * apontasse para o mesmo da geração, trocar aquele por um modelo sem visão
 * faria todo post sair sem capa, em silêncio.
 *
 * Tudo via OpenRouter, inclusive os modelos da Anthropic: é a única chave que
 * a instalação precisa ter. Semear provider 'anthropic' criaria um perfil que
 * só falha na execução, porque não há credencial desse tipo.
 */
const MODEL_PROFILES = [
  {
    slug: 'economy',
    name: 'Econômico',
    description: 'Modelos baratos. Menor custo por post, qualidade menor em textos longos.',
    isDefault: false,
    entries: {
      generate: { provider: 'openrouter' as const, modelId: 'deepseek/deepseek-v4-flash' },
      verify: { provider: 'openrouter' as const, modelId: 'deepseek/deepseek-v4-flash' },
      discover: { provider: 'openrouter' as const, modelId: 'deepseek/deepseek-v4-flash' },
      dedupe: { provider: 'openrouter' as const, modelId: 'deepseek/deepseek-v4-flash' },
      illustrate: { provider: 'openrouter' as const, modelId: 'openai/gpt-4o-mini' },
    },
  },
  {
    slug: 'standard',
    name: 'Padrão',
    description: 'Equilíbrio entre custo e qualidade. Usado por quem não tem perfil específico.',
    isDefault: true,
    entries: {
      generate: { provider: 'openrouter' as const, modelId: 'z-ai/glm-5.2' },
      verify: { provider: 'openrouter' as const, modelId: 'z-ai/glm-5.2' },
      discover: { provider: 'openrouter' as const, modelId: 'deepseek/deepseek-v4-flash' },
      dedupe: { provider: 'openrouter' as const, modelId: 'deepseek/deepseek-v4-flash' },
      illustrate: { provider: 'openrouter' as const, modelId: 'openai/gpt-4o-mini' },
    },
  },
  {
    slug: 'premium',
    name: 'Premium',
    description: 'Modelos melhores para os planos mais caros. Custo por post maior.',
    isDefault: false,
    entries: {
      generate: { provider: 'openrouter' as const, modelId: 'anthropic/claude-sonnet-4.5' },
      verify: { provider: 'openrouter' as const, modelId: 'z-ai/glm-5.2' },
      discover: { provider: 'openrouter' as const, modelId: 'deepseek/deepseek-v4-flash' },
      dedupe: { provider: 'openrouter' as const, modelId: 'deepseek/deepseek-v4-flash' },
      illustrate: { provider: 'openrouter' as const, modelId: 'anthropic/claude-haiku-4.5' },
    },
  },
];
async function main() {
  const db = createDb();

  // normalizado: o login sempre compara em minúsculas, então um ADMIN_EMAIL
  // com maiúscula criaria uma conta na qual ninguém consegue entrar.
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword || adminPassword === 'troque-me') {
    throw new Error('Defina ADMIN_EMAIL e ADMIN_PASSWORD no .env antes de rodar o seed.');
  }

  let [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) {
    [workspace] = await db.insert(workspaces).values({ name: 'Default' }).returning();
    console.log(`Workspace criado: ${workspace!.id}`);
  }

  const [existingUser] = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
  let adminWorkspaceId: string;
  if (!existingUser) {
    const passwordHash = await hash(adminPassword, 12);
    await db.insert(users).values({
      workspaceId: workspace!.id,
      email: adminEmail,
      passwordHash,
      name: 'Admin',
      role: 'admin', // operador da plataforma: gerencia credenciais globais
    });
    adminWorkspaceId = workspace!.id;
    console.log(`Usuário admin criado: ${adminEmail}`);
  } else {
    adminWorkspaceId = existingUser.workspaceId;
    // O seed é o caminho de recuperação do super admin: repõe cargo e destrava
    // a conta caso status/exclusão tenham sido mexidos à mão no banco.
    const needsFix =
      existingUser.role !== 'admin' || existingUser.status !== 'active' || existingUser.deletedAt !== null;
    if (needsFix) {
      await db
        .update(users)
        .set({ role: 'admin', status: 'active', deletedAt: null, deletedBy: null, updatedAt: new Date() })
        .where(eq(users.id, existingUser.id));
      console.log(`Super admin ${adminEmail} restaurado (cargo/status).`);
    } else {
      console.log(`Usuário admin já existe: ${adminEmail}`);
    }
  }

  // Isenção de cobrança do workspace do super admin. É explícita e não
  // derivada de cargo — admin comum NÃO ganha isenção por ser admin.
  await db
    .update(workspaces)
    .set({ billingBypass: true, status: 'active', updatedAt: new Date() })
    .where(eq(workspaces.id, adminWorkspaceId));

  // Templates builtin: valida com o zod do core e faz upsert por slug (workspace NULL)
  for (const seed of [gameCodesTemplate, genericArticleTemplate]) {
    const cfg = parseTemplateConfig(seed.config);
    const [existing] = await db
      .select({ id: contentTemplates.id, version: contentTemplates.version })
      .from(contentTemplates)
      .where(and(isNull(contentTemplates.workspaceId), eq(contentTemplates.slug, seed.slug)))
      .limit(1);
    if (existing) {
      await db
        .update(contentTemplates)
        .set({
          name: seed.name,
          description: seed.description,
          config: cfg,
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(contentTemplates.id, existing.id));
      console.log(`Template builtin atualizado: ${seed.slug} (v${existing.version + 1})`);
    } else {
      await db.insert(contentTemplates).values({
        workspaceId: null,
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        config: cfg,
        isBuiltin: true,
      });
      console.log(`Template builtin criado: ${seed.slug}`);
    }
  }

  // Perfis de modelo. Idempotente: cria o que falta e completa purposes
  // ausentes, mas NÃO sobrescreve escolha que o admin já fez no painel.
  for (const seed of MODEL_PROFILES) {
    let [profile] = await db
      .select({ id: modelProfiles.id })
      .from(modelProfiles)
      .where(eq(modelProfiles.slug, seed.slug))
      .limit(1);
    if (!profile) {
      [profile] = await db
        .insert(modelProfiles)
        .values({
          slug: seed.slug,
          name: seed.name,
          description: seed.description,
          isDefault: seed.isDefault,
        })
        .returning({ id: modelProfiles.id });
      console.log(`Perfil de modelo criado: ${seed.slug}`);
    }

    const existing = await db
      .select({ purpose: modelProfileEntries.purpose })
      .from(modelProfileEntries)
      .where(eq(modelProfileEntries.profileId, profile!.id));
    const have = new Set(existing.map((e) => e.purpose));

    const missing = Object.entries(seed.entries).filter(([purpose]) => !have.has(purpose as never));
    if (missing.length > 0) {
      await db.insert(modelProfileEntries).values(
        missing.map(([purpose, entry]) => ({
          profileId: profile!.id,
          purpose: purpose as 'generate' | 'verify' | 'discover' | 'dedupe' | 'illustrate',
          provider: entry.provider,
          modelId: entry.modelId,
        })),
      );
      console.log(`  ${seed.slug}: ${missing.map(([p]) => p).join(', ')}`);
    }
  }

  console.log('Seed concluído.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
