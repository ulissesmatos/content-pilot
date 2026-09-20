import { createServer } from 'node:http';
import { sql, type Db } from '@content-pilot/db';

/**
 * Endpoint de saúde do worker.
 *
 * Existe por dois motivos. O primeiro é que, sem ele, o container do worker
 * não declara healthcheck algum: o Docker o reporta sem estado de saúde e o
 * Coolify agrega isso como `unknown` no recurso inteiro, mesmo com web e
 * banco saudáveis. O segundo é mais importante — um worker que trava com o
 * processo vivo (pool de conexões esgotado, pg-boss preso) hoje não é
 * percebido por ninguém: o container segue "up" e as filas param em silêncio.
 *
 * Processo vivo não é o mesmo que worker funcionando, então a checagem é o
 * trabalho de verdade: o scheduler.tick roda a cada minuto, e a última
 * execução concluída precisa ser recente. É a mesma medida que o painel usa
 * para mostrar "Worker inativo".
 */

/** Folga de 3 min sobre o tick de 1 min: absorve uma execução longa sem alarme falso. */
const MAX_TICK_AGE_MS = 3 * 60 * 1000;

/** Enquanto nenhum tick concluiu, a idade não prova nada — ver `startedAt`. */
const BOOT_GRACE_MS = 3 * 60 * 1000;

export function startHealthServer(db: Db, port = Number(process.env.WORKER_HEALTH_PORT ?? 3001)): void {
  const startedAt = Date.now();

  const server = createServer((req, res) => {
    if (req.method !== 'GET' || !req.url?.startsWith('/health')) {
      res.writeHead(404).end();
      return;
    }
    void (async () => {
      try {
        const result = await db.execute(
          sql`select max(completed_on) as last from pgboss.job where name = 'scheduler.tick' and state = 'completed'`,
        );
        const last = (result.rows?.[0] as { last: string | Date | null } | undefined)?.last;
        const ageMs = last ? Date.now() - new Date(last).getTime() : null;
        // Recém-subido e ainda sem tick concluído: saudável por ora. Passada a
        // folga, a ausência de tick vira o próprio sintoma.
        const ok =
          ageMs === null ? Date.now() - startedAt < BOOT_GRACE_MS : ageMs < MAX_TICK_AGE_MS;
        res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok, lastTickAgeMs: ageMs }));
      } catch {
        // Sem banco o worker não processa nada — não é saudável.
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'db' }));
      }
    })();
  });

  server.listen(port, '0.0.0.0', () => console.log(`[worker] health em :${port}/health`));
  // A porta é interna; se estiver ocupada, não derruba o worker.
  server.on('error', (err) => console.error('[worker] health server falhou', err));
  server.unref();
}
