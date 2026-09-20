import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ImageUploadError, MAX_UPLOAD_BYTES } from '@content-pilot/core';
import { requireSession } from '@/lib/auth';
import { consumeRateLimit } from '@/lib/rate-limit';
import { UserFacingError } from '@/lib/errors';
import { downloadRemoteImage, replaceBriefImage, SEO_LIMITS } from '@/lib/brief-edit';

/**
 * Troca uma imagem do artigo por outra enviada pelo usuário: arquivo escolhido, colado (Ctrl+V),
 * arrastado do computador ou arrastado de outra página (`sourceUrl`). A imagem é convertida para
 * WebP no tamanho do template e o post é atualizado no WordPress.
 *
 * O middleware NÃO cobre /api, então a autenticação é feita aqui. O workspace vem da sessão
 * verificada, nunca do corpo: o artigo de outro cliente responde 404, como se não existisse.
 * Multipart em vez de server action: o corpo de uma action tem limite de 1 MB.
 */
export const dynamic = 'force-dynamic';

const fields = z.object({
  target: z.enum(['cover', 'inline']),
  mediaId: z.coerce.number().int().positive().optional(),
  alt: z.string().max(SEO_LIMITS.alt * 2).default(''),
  title: z.string().max(SEO_LIMITS.title * 2).default(''),
  caption: z.string().max(SEO_LIMITS.caption * 2).default(''),
  filename: z.string().max(SEO_LIMITS.filename * 3).optional(),
  sourceUrl: z.string().max(2000).optional(),
});

const fail = (status: number, error: string, code?: string) =>
  Response.json({ ok: false, error, code }, { status, headers: { 'Cache-Control': 'no-store' } });

const STATUS_BY_CODE: Record<string, number> = { not_found: 404, busy: 409, gone: 409, conflict: 409, too_large: 413 };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession();
  } catch {
    return fail(401, 'Sessão expirada. Entre de novo.', 'unauthorized');
  }
  if (session.workspaceStatus !== 'active') return fail(403, 'Workspace suspenso. Apenas leitura disponível.');
  if (!(await consumeRateLimit('tenant:actor', session.userId))) return fail(429, 'Muitas ações. Aguarde um minuto.');

  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return fail(404, 'Artigo não encontrado.', 'not_found');

  // corta antes de ler o corpo inteiro: um arquivo enorme não chega a ser carregado na memória
  if (Number(req.headers.get('content-length')) > MAX_UPLOAD_BYTES + 1_000_000) {
    return fail(413, `A imagem é grande demais (limite de ${MAX_UPLOAD_BYTES / 1_000_000} MB).`, 'too_large');
  }

  try {
    const form = await req.formData();
    const parsed = fields.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')));
    if (!parsed.success) return fail(400, 'Dados inválidos.');
    const f = parsed.data;
    if (f.target === 'inline' && !f.mediaId) return fail(400, 'Faltou indicar qual imagem trocar.');

    const file = form.get('file');
    let image: Uint8Array;
    let filename = f.filename;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_UPLOAD_BYTES) return fail(413, `A imagem é grande demais (limite de ${MAX_UPLOAD_BYTES / 1_000_000} MB).`, 'too_large');
      image = new Uint8Array(await file.arrayBuffer());
      filename ??= file.name;
    } else if (f.sourceUrl) {
      image = await downloadRemoteImage(f.sourceUrl);
    } else {
      return fail(400, 'Envie uma imagem (arquivo, colagem ou endereço).');
    }

    const result = await replaceBriefImage(session.workspaceId, id.data, {
      target: f.target === 'cover' ? { kind: 'cover' } : { kind: 'inline', mediaId: f.mediaId! },
      image,
      seo: { alt: f.alt, title: f.title, caption: f.caption },
      filename,
    });
    revalidatePath(`/briefs/${id.data}`);
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof ImageUploadError) return fail(err.code === 'too_large' ? 413 : 400, err.message, err.code);
    if (err instanceof UserFacingError) return fail(STATUS_BY_CODE[err.code ?? ''] ?? 400, err.message, err.code);
    const ref = randomUUID();
    console.error('[brief-image]', ref, err instanceof Error ? err.name : 'UnknownError');
    return fail(500, `Não foi possível trocar a imagem (ref. ${ref}).`);
  }
}
