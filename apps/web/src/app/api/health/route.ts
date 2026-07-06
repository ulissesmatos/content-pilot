import { sql } from 'drizzle-orm';
import { getDb } from '@content-pilot/db';

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
