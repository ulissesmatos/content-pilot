import { config } from 'dotenv';
import { resolve } from 'node:path';
import { hash } from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { gameCodesTemplate, genericArticleTemplate, parseTemplateConfig } from '@content-pilot/core';
import { createDb } from './client';
import { contentTemplates, users, workspaces } from './schema';

config({ path: resolve(import.meta.dirname, '../../../.env') });

/**
 * Seed idempotente: workspace default, usuário admin (ADMIN_EMAIL/ADMIN_PASSWORD
 * do .env) e templates builtin (workspace NULL, read-only no painel).
 */
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

  console.log('Seed concluído.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
