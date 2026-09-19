import { sql } from 'drizzle-orm';
import { getDb } from '@content-pilot/db';

export async function GET() {
  try {
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`set local role content_pilot_tenant`);
      const result = await tx.execute(sql`select row_security_active('public.sites') as active`);
      if (result.rows[0]?.active !== true) throw new Error('Tenant isolation unavailable');
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
