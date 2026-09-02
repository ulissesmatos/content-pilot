import 'server-only';
import { headers } from 'next/headers';

/**
 * Dados da requisição para auditoria e rate limit por IP.
 *
 * O IP vem do primeiro hop de `x-forwarded-for` (o Caddy do deploy preenche o
 * header; ver Caddyfile). É um valor que o cliente pode forjar quando não há
 * proxy na frente — serve para auditoria e para encarecer brute-force, nunca
 * como controle de acesso.
 */

function firstHop(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return firstHop(h.get('x-forwarded-for')) ?? h.get('x-real-ip') ?? null;
}

export async function userAgent(): Promise<string | null> {
  const h = await headers();
  return h.get('user-agent')?.slice(0, 500) ?? null;
}

export async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);
  return { ip, userAgent: ua };
}
