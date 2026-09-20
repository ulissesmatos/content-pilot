import { assertWorkerWorkspace } from '../lib/tenant';
import { briefs, eq, runItems, runs, sites, type Db } from '@content-pilot/db';
import {
  buildRegenerationPrompt,
  parseImageReport,
  replaceImageBlock,
  slugify,
  splitArticle,
  withReplacedImage,
  type ImageReportItem,
} from '@content-pilot/core';
import { resolveImageGenProvider, resolveTemplateById, resolveWordPressAdapter } from '../lib/resolve';
import { maybeFinalizeRun } from '../lib/run-helpers';
import { imageFilename, processForUpload } from '../lib/image-processing';
import { createRunLogger } from '../lib/run-logger';
import type { ImageRegeneratePayload } from './names';

/**
 * image.regenerate: gera uma imagem de novo com o gerador de IA e a coloca no
 * lugar da anterior, no post que já existe no WordPress.
 *
 * Pedida na tela de preview quando uma imagem escolhida da web não encaixa, e
 * também para criar a capa que faltou. A imagem antiga continua na biblioteca de
 * mídia (nada é apagado); o que muda é qual imagem o post usa.
 */
export async function handleImageRegenerate(db: Db, payload: ImageRegeneratePayload) {
  const { briefId, runId, slotId, instruction } = payload;
  const startedAt = Date.now();

  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || run.status !== 'running') {
    console.log(`[image ${briefId}] run não está em execução — abortando`);
    return;
  }
  const [brief] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1);
  if (!brief) throw new Error(`brief ${briefId} não existe`);
  if (run.briefId !== briefId || run.workspaceId !== brief.workspaceId) throw new Error('Queue ownership mismatch');
  await assertWorkerWorkspace(db, run.workspaceId);
  const workspaceId = brief.workspaceId;
  const logger = createRunLogger(db, runId, `[image ${briefId}]`);
  const log = logger.log;

  const finish = async (status: 'updated' | 'failed', summary: string, wpPostId?: number | null) => {
    await db.insert(runItems).values({
      runId,
      workspaceId,
      wpPostId: wpPostId ?? brief.createdWpPostId,
      postTitle: brief.topic,
      status,
      action: 'regenerate_image',
      changesSummary: summary,
      durationMs: Date.now() - startedAt,
    });
    await db.update(runs).set({ expectedItems: 1 }).where(eq(runs.id, runId));
    await maybeFinalizeRun(db, runId);
  };

  try {
    const role = slotId === 'cover' ? 'cover' : 'inline';
    log(`nova imagem para "${brief.topic}" (${role === 'cover' ? 'capa' : slotId})`);

    if (!brief.createdWpPostId) throw new Error('Este artigo ainda não tem post no WordPress.');
    const imageGen = await resolveImageGenProvider(db, workspaceId);
    if (!imageGen) {
      throw new Error(
        'Não há gerador de imagem disponível: configure a chave OpenAI em Credenciais e o modelo de imagem em Configurações de IA.',
      );
    }

    const [site] = await db.select().from(sites).where(eq(sites.id, brief.siteId)).limit(1);
    if (!site) throw new Error('Site da pauta não existe mais.');
    const [wp, template] = await Promise.all([
      resolveWordPressAdapter(db, site),
      resolveTemplateById(db, brief.templateId, workspaceId),
    ]);

    const post = await wp.getPost(brief.createdWpPostId);
    const report = parseImageReport(brief.imageReport);
    const current = report.images.find((i) => i.slotId === slotId);
    if (role === 'inline' && !current) throw new Error(`A imagem "${slotId}" não faz parte deste artigo.`);
    // sem o HTML em bloco não dá para localizar a imagem certa: a versão renderizada não traz `wp-image-ID`
    if (role === 'inline' && post.usedRenderedFallback) {
      throw new Error('O WordPress não devolveu o conteúdo editável do post (falta permissão de edição); a imagem do corpo não pode ser trocada.');
    }

    // confere ANTES de gastar uma geração: a imagem pode ter sido tirada do post no WordPress
    if (role === 'inline') {
      const present = splitArticle(post.contentRaw).some((s) => s.kind === 'image' && s.mediaId === current!.mediaId);
      if (!present) throw new Error('Essa imagem não está mais no post (foi removida ou trocada no WordPress). Nada foi alterado.');
    }

    const cfg = template.config.images;
    const size = role === 'cover' ? cfg.cover : cfg.inline;
    const subject = current?.alt || post.title || brief.topic;
    const prompt = buildRegenerationPrompt({ role, topic: brief.topic, subject, instruction, size });

    log(`gerando com IA (${size.width}x${size.height})`);
    const generated = await imageGen.generate(prompt, { size });
    if (!generated) throw new Error('O gerador de imagem não devolveu nenhuma imagem.');

    const file = await processForUpload(generated, {
      size,
      role,
      format: cfg.format,
      quality: cfg.quality,
      generated: true,
    });
    const alt = instruction?.trim() ? instruction.trim().slice(0, 125) : subject;
    const base = slugify(brief.topic, { maxLength: 60, fallback: 'imagem' });
    // sufixo por tentativa: o WordPress renomearia um nome repetido, mas assim a biblioteca fica legível
    const suffix = `${role === 'cover' ? 'capa' : slotId.replace('inline-', '')}-${Date.now().toString(36)}`;
    const media = await wp.uploadMedia({
      data: file.data,
      filename: imageFilename(`${base}-${suffix}`, file.extension),
      mimeType: file.mimeType,
      alt,
    });
    log(
      `enviada ao WP: ${file.extension.toUpperCase()} ${file.width || '?'}x${file.height || '?'} ` +
        `(${(file.data.byteLength / 1024).toFixed(0)} KB, media #${media.id})`,
    );

    if (role === 'cover') {
      await wp.updatePost(brief.createdWpPostId, { featuredMediaId: media.id });
    } else {
      const swapped = replaceImageBlock(post.contentRaw, current!.mediaId, { url: media.sourceUrl, alt, mediaId: media.id });
      if (!swapped.replaced) {
        throw new Error('Essa imagem não está mais no post (foi removida ou trocada no WordPress). Nada foi alterado.');
      }
      await wp.updatePost(brief.createdWpPostId, { content: swapped.html });
    }

    const item: ImageReportItem = {
      slotId,
      role,
      origin: 'generated',
      mediaId: media.id,
      url: media.sourceUrl,
      alt,
      width: file.width || undefined,
      height: file.height || undefined,
    };
    await db
      .update(briefs)
      .set({ imageReport: withReplacedImage(report, item), updatedAt: new Date() })
      .where(eq(briefs.id, briefId));

    log(role === 'cover' ? 'capa trocada no post' : 'imagem trocada no post');
    await finish('updated', `${role === 'cover' ? 'Capa' : slotId} regenerada por IA (media #${media.id}).`, brief.createdWpPostId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`falha: ${message}`);
    await finish('failed', message);
  } finally {
    await logger.flush();
  }
}
