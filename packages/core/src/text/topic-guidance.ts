/**
 * Orientação sobre o TEMA, injetada em runtime no prompt de geração.
 *
 * Um tema vindo da descoberta automática é um palpite feito a partir de resultados
 * de busca: pode estar mal formulado, desatualizado ou nem fazer sentido depois que
 * o redator lê as fontes de verdade. Tratar o tema como ordem obriga o modelo a
 * escrever um artigo ruim sobre uma premissa ruim. Aqui ele é um norte: o redator
 * pode ajustar o enfoque e o título, desde que continue no mesmo assunto.
 *
 * Entra em runtime, e não no texto do template, pelo mesmo motivo do estilo:
 * template clonado guarda o próprio prompt no banco e só assim recebe a regra.
 */

/** Quem definiu o tema: a descoberta automática (um norte) ou uma pessoa (o assunto pedido). */
export type TopicOrigin = 'suggested' | 'requested';

/** Marca que o redator escreve no início de `changesSummary` quando muda o enfoque. */
export const ANGLE_MARKER_PT = 'Enfoque ajustado:';
export const ANGLE_MARKER_EN = 'Angle adjusted:';

/** Quantos títulos já publicados entram no prompt: o bastante para não repetir, sem inflar. */
const MAX_AVOID_TITLES = 25;

export function buildTopicGuidance(opts: {
  origin: TopicOrigin;
  language: string;
  /** Títulos já cobertos pelo blog, os mais parecidos com o tema primeiro. */
  avoidTitles?: string[];
}): string {
  const pt = opts.language.toLowerCase().startsWith('pt');
  const avoid = (opts.avoidTitles ?? []).map((t) => t.trim()).filter(Boolean).slice(0, MAX_AVOID_TITLES);

  if (opts.origin === 'requested') {
    return pt
      ? `\n\nTÍTULO E TEMA:\n- O assunto foi pedido por uma pessoa: mantenha-o. Escreva sobre o que foi pedido.\n- O título final (newTitle) deve descrever exatamente o que o texto entrega. Se ao escrever o foco ficou um pouco diferente do tema digitado, ajuste o título para refletir o texto.`
      : `\n\nTITLE AND TOPIC:\n- The subject was requested by a person: keep it. Write about what was asked.\n- The final title (newTitle) must describe exactly what the text delivers. If the focus ended up slightly different from the typed topic, adjust the title to reflect the text.`;
  }

  if (pt) {
    return (
      `\n\nO TEMA SUGERIDO É UM NORTE, NÃO UMA ORDEM:\n` +
      `- O tema, o ângulo e o título sugeridos (se houver) vieram de uma descoberta automática de tendências e podem estar mal formulados, desatualizados ou nem fazer sentido depois de lidas as fontes. Vale mais o que as fontes mostram do que a sugestão.\n` +
      `- Leia as fontes primeiro. Se a sugestão se sustenta, escreva sobre ela. Se não (a premissa está errada, o fato não aconteceu, o ângulo é fraco, ou as fontes mostram algo mais relevante sobre o mesmo assunto), AJUSTE o enfoque e o título para algo que faça sentido e que as fontes sustentem.\n` +
      `- Ajuste, não troque de assunto: continue no mesmo tema central (o mesmo jogo, produto, pessoa ou acontecimento). Não migre para outro assunto só porque as fontes falam dele.\n` +
      `- O título final (newTitle) deve descrever exatamente o que o texto entrega.\n` +
      `- Se você ajustou o enfoque em relação à sugestão, comece changesSummary com "${ANGLE_MARKER_PT}" e diga em uma frase o que mudou e por quê. Se manteve a sugestão, não use essa expressão.` +
      (avoid.length > 0
        ? `\n- O blog já cobriu estes assuntos: não repita nenhum deles, nem ao ajustar o enfoque:\n${avoid.map((t) => `  * ${t}`).join('\n')}`
        : '')
    );
  }
  return (
    `\n\nTHE SUGGESTED TOPIC IS A COMPASS, NOT AN ORDER:\n` +
    `- The suggested topic, angle and title (if any) came from an automatic trend discovery and may be badly phrased, outdated or make no sense once the sources are read. What the sources show matters more than the suggestion.\n` +
    `- Read the sources first. If the suggestion holds up, write about it. If not (the premise is wrong, the event did not happen, the angle is weak, or the sources show something more relevant about the same subject), ADJUST the focus and the title to something that makes sense and that the sources support.\n` +
    `- Adjust, do not change subject: stay on the same central topic (the same game, product, person or event). Do not drift to another subject just because the sources mention it.\n` +
    `- The final title (newTitle) must describe exactly what the text delivers.\n` +
    `- If you adjusted the focus relative to the suggestion, start changesSummary with "${ANGLE_MARKER_EN}" and say in one sentence what changed and why. If you kept the suggestion, do not use that phrase.` +
    (avoid.length > 0
      ? `\n- The blog has already covered these subjects: do not repeat any of them, even when adjusting the focus:\n${avoid.map((t) => `  * ${t}`).join('\n')}`
      : '')
  );
}

/** A nota do redator sobre o ajuste de enfoque, quando ele o fez; senão null. */
export function parseAngleNote(changesSummary: string | null | undefined): string | null {
  if (!changesSummary) return null;
  const m = /^\s*(?:enfoque ajustado|angle adjusted)\s*:\s*([\s\S]+)$/i.exec(changesSummary);
  const note = m?.[1]?.replace(/\s+/g, ' ').trim();
  return note ? note : null;
}
