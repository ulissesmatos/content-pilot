import { paragraphEnds } from '../html/inline-images';
import { embedBlock, type EmbedItem } from './parse';

/**
 * Onde cada embed entra: o vídeo depois de cerca de um terço do texto (o leitor já
 * entendeu o assunto e o vídeo mostra), os tweets mais adiante, espaçados.
 *
 * Nunca no mesmo parágrafo de uma imagem: `avoid` recebe os parágrafos que já têm
 * imagem. Como blocos de imagem e de embed não contêm `<p>`, os índices de
 * parágrafo continuam valendo depois que as imagens foram injetadas.
 */

/** Fração do texto onde cada posição cai: vídeo primeiro, tweets depois. */
const VIDEO_AT = 0.35;
const TWEET_AT = [0.6, 0.85];

export function planEmbedParagraphs(
  total: number,
  embeds: Array<Pick<EmbedItem, 'kind'>>,
  avoid: number[] = [],
): number[] {
  if (total < 2 || embeds.length === 0) return [];
  const taken = new Set(avoid);
  let tweetSeen = 0;

  return embeds.map((e) => {
    const at = e.kind === 'youtube' ? VIDEO_AT : (TWEET_AT[tweetSeen++] ?? TWEET_AT[TWEET_AT.length - 1]!);
    let target = Math.max(0, Math.min(total - 1, Math.round(total * at) - 1));
    // procura o parágrafo livre mais próximo, alternando para trás e para frente
    for (let d = 0; d < total; d++) {
      const candidates = [target + d, target - d].filter((x) => x >= 0 && x < total && !taken.has(x));
      if (candidates.length > 0) {
        target = candidates[0]!;
        break;
      }
    }
    taken.add(target);
    return target;
  });
}

export function injectEmbeds(html: string, embeds: EmbedItem[], opts: { avoidParagraphs?: number[] } = {}): string {
  if (!html || embeds.length === 0) return html;
  const ends = paragraphEnds(html);
  const plan = planEmbedParagraphs(ends.length, embeds, opts.avoidParagraphs);
  if (plan.length === 0) return html;

  const insertions = embeds
    .map((e, i) => ({ pos: ends[plan[i]!]!, block: embedBlock(e) }))
    .sort((a, b) => b.pos - a.pos);
  let out = html;
  for (const ins of insertions) out = out.slice(0, ins.pos) + ins.block + out.slice(ins.pos);
  return out;
}
