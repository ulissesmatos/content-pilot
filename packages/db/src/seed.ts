import { config } from 'dotenv';
import { resolve } from 'node:path';
import { hash } from 'bcryptjs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { gameCodesTemplate, genericArticleTemplate, parseTemplateConfig } from '@content-pilot/core';
import { createDb } from './client';
import {
  contentTemplates,
  modelProfileEntries,
  modelProfiles,
  users,
  workspaces,
} from './schema';

config({ path: resolve(import.meta.dirname, '../../../.env') });

/**
 * Seed idempotente: workspace default, usuário admin (ADMIN_EMAIL/ADMIN_PASSWORD
 * do .env), templates builtin (workspace NULL, read-only no painel) e os
 * perfis de modelo usados pelo pipeline.
 */

/**
 * Perfis iniciais.
 *
 * Estes perfis pertencem SOMENTE às chaves do sistema, que o super admin pode
 * usar. Clientes BYOK escolhem o próprio provedor/modelo em /credentials e
 * não são roteados por estes valores. OpenAI é o padrão de texto e visão;
 * Anthropic é a alternativa nativa e OpenRouter permanece uma opção explícita.
 */
const MODEL_PROFILES = [
  {
    slug: 'openai',
    name: 'OpenAI',
    description: 'Perfil principal do sistema: OpenAI nativo para texto e visão.',
    isDefault: true,
    entries: {
      generate: { provider: 'openai' as const, modelId: 'gpt-4.1-mini' },
      review: { provider: 'openai' as const, modelId: 'gpt-4.1-mini' },
      verify: { provider: 'openai' as const, modelId: 'gpt-4.1-mini' },
      discover: { provider: 'openai' as const, modelId: 'gpt-4.1-mini' },
      dedupe: { provider: 'openai' as const, modelId: 'gpt-4.1-mini' },
      illustrate: { provider: 'openai' as const, modelId: 'gpt-4.1-mini' },
    },
  },
  {
    slug: 'anthropic',
    name: 'Anthropic',
    description: 'Alternativa nativa para texto e visão via Claude.',
    isDefault: false,
    entries: {
      generate: { provider: 'anthropic' as const, modelId: 'claude-sonnet-4-5' },
      review: { provider: 'anthropic' as const, modelId: 'claude-sonnet-4-5' },
      verify: { provider: 'anthropic' as const, modelId: 'claude-haiku-4-5' },
      discover: { provider: 'anthropic' as const, modelId: 'claude-haiku-4-5' },
      dedupe: { provider: 'anthropic' as const, modelId: 'claude-haiku-4-5' },
      illustrate: { provider: 'anthropic' as const, modelId: 'claude-haiku-4-5' },
    },
  },
  {
    slug: 'openrouter',
    name: 'OpenRouter',
    description: 'Opção explícita de roteamento por OpenRouter.',
    isDefault: false,
    entries: {
      generate: { provider: 'openrouter' as const, modelId: 'openai/gpt-4o-mini' },
      review: { provider: 'openrouter' as const, modelId: 'openai/gpt-4o-mini' },
      verify: { provider: 'openrouter' as const, modelId: 'openai/gpt-4o-mini' },
      discover: { provider: 'openrouter' as const, modelId: 'openai/gpt-4o-mini' },
      dedupe: { provider: 'openrouter' as const, modelId: 'openai/gpt-4o-mini' },
      illustrate: { provider: 'openrouter' as const, modelId: 'openai/gpt-4o-mini' },
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

  const [existingUser] = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
  let adminWorkspaceId: string;
  if (!existingUser) {
    const [workspace] = await db.insert(workspaces).values({ name: 'Admin' }).returning();
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

  // Perfis de sistema. Eles são seed, não preferências do cliente: atualizá-
  // los de forma determinística evita que uma instalação antiga continue com
  // OpenRouter/ids prefixados depois do deploy da nova arquitetura.
  await db.update(modelProfiles).set({ isDefault: false, updatedAt: new Date() });
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
    } else {
      await db
        .update(modelProfiles)
        .set({ name: seed.name, description: seed.description, isDefault: seed.isDefault, updatedAt: new Date() })
        .where(eq(modelProfiles.id, profile.id));
    }

    await db.insert(modelProfileEntries).values(
      Object.entries(seed.entries).map(([purpose, entry]) => ({
          profileId: profile!.id,
          purpose: purpose as 'generate' | 'verify' | 'discover' | 'dedupe' | 'illustrate' | 'review',
          provider: entry.provider,
          modelId: entry.modelId,
      })),
    ).onConflictDoUpdate({
      target: [modelProfileEntries.profileId, modelProfileEntries.purpose],
      set: { provider: sql`excluded.provider`, modelId: sql`excluded.model_id`, updatedAt: new Date() },
    });
    console.log(`Perfil de sistema sincronizado: ${seed.slug}`);
  }

  console.log('Seed concluído.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
