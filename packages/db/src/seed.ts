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

  const adminEmail = process.env.ADMIN_EMAIL;
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
  if (!existingUser) {
    const passwordHash = await hash(adminPassword, 12);
    await db.insert(users).values({
      workspaceId: workspace!.id,
      email: adminEmail,
      passwordHash,
      name: 'Admin',
    });
    console.log(`Usuário admin criado: ${adminEmail}`);
  } else {
    console.log(`Usuário admin já existe: ${adminEmail}`);
  }

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
