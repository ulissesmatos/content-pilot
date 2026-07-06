import { config } from 'dotenv';
import { resolve } from 'node:path';
import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { createDb } from './client';
import { users, workspaces } from './schema';

config({ path: resolve(import.meta.dirname, '../../../.env') });

/**
 * Seed idempotente: garante 1 workspace default e 1 usuário admin
 * (ADMIN_EMAIL/ADMIN_PASSWORD do .env). Os templates builtin são semeados
 * pelo pacote core (seed-templates) a partir do M2.
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

  console.log('Seed concluído.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
