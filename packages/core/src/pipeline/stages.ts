/**
 * Etapas visíveis de uma execução, para a tela de acompanhamento ao vivo.
 *
 * O worker já escreve um log de texto livre. Deduzir a etapa dessas frases seria
 * frágil: reescrever uma mensagem quebraria a tela em silêncio. Por isso quem
 * escreve o log e quem o lê compartilham ESTA tabela: o worker emite
 * `stageMarker(chave)` e a tela interpreta com `deriveStages`. Trocar o texto de
 * um marcador aqui muda os dois lados juntos.
 */

export type StageKey =
  | 'descoberta'
  | 'pesquisa'
  | 'redacao'
  | 'revisao'
  | 'imagens'
  | 'embeds'
  | 'publicacao';

export type StageStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export type RunKind = 'create' | 'discover' | 'update';

export interface StageDef {
  key: StageKey;
  label: string;
  /** Não é problema a etapa nunca acontecer (o template a desliga, ou não há o que fazer). */
  optional: boolean;
  /** Texto exato do marcador no log. Legível de propósito: aparece na tela de logs. */
  marker: string;
}

const DEFS: Record<StageKey, StageDef> = {
  descoberta: { key: 'descoberta', label: 'Descobrindo temas', optional: false, marker: 'etapa: descobrindo temas' },
  pesquisa: { key: 'pesquisa', label: 'Pesquisando fontes', optional: false, marker: 'etapa: pesquisando fontes' },
  redacao: { key: 'redacao', label: 'Escrevendo o artigo', optional: false, marker: 'etapa: escrevendo o artigo' },
  revisao: { key: 'revisao', label: 'Revisão editorial', optional: true, marker: 'etapa: revisão editorial' },
  imagens: { key: 'imagens', label: 'Imagens', optional: true, marker: 'etapa: imagens' },
  embeds: { key: 'embeds', label: 'Vídeo e tweets', optional: true, marker: 'etapa: vídeo e tweets' },
  publicacao: { key: 'publicacao', label: 'Enviando ao WordPress', optional: false, marker: 'etapa: enviando ao WordPress' },
};

const ORDER: Record<RunKind, StageKey[]> = {
  create: ['pesquisa', 'redacao', 'revisao', 'imagens', 'embeds', 'publicacao'],
  discover: ['descoberta'],
  update: [],
};

/** A linha a escrever no log quando a etapa começa. */
export const stageMarker = (key: StageKey): string => DEFS[key].marker;

export function stagesFor(kind: RunKind): StageDef[] {
  return ORDER[kind].map((k) => DEFS[k]);
}

export interface StageState {
  key: StageKey;
  label: string;
  status: StageStatus;
}

export type RunStatus = 'running' | 'success' | 'partial' | 'failed' | 'cancelled';

/**
 * Estado de cada etapa a partir do log.
 *
 * A etapa alcançada é a mais avançada cujo marcador apareceu. As anteriores
 * estão concluídas (ou puladas, se opcionais e nunca marcadas). A alcançada está
 * ativa enquanto a execução roda; ao terminar, fica concluída, ou falhada quando
 * a execução falhou ou foi cancelada nela.
 */
export function deriveStages(lines: string[], status: RunStatus, kind: RunKind): StageState[] {
  const defs = stagesFor(kind);
  if (defs.length === 0) return [];

  const seen = new Set<StageKey>();
  for (const line of lines) {
    for (const d of defs) if (line.startsWith(d.marker)) seen.add(d.key);
  }

  let reached = -1;
  defs.forEach((d, i) => {
    if (seen.has(d.key)) reached = i;
  });

  const finished = status !== 'running';
  const ok = status === 'success' || status === 'partial';

  return defs.map((d, i): StageState => {
    let s: StageStatus;
    if (reached === -1) {
      // Nenhum marcador no log. Rodando: a primeira etapa está começando. Terminou
      // bem (um run antigo, de antes dos marcadores): tudo concluído. Terminou mal:
      // falhou logo no início.
      if (!finished) s = i === 0 ? 'active' : 'pending';
      else if (ok) s = d.optional ? 'skipped' : 'done';
      else s = i === 0 ? 'failed' : 'pending';
    } else if (i < reached) {
      s = seen.has(d.key) || !d.optional ? 'done' : 'skipped';
    } else if (i === reached) {
      s = !finished ? 'active' : ok ? 'done' : 'failed';
    } else {
      s = finished && ok ? (d.optional ? 'skipped' : 'done') : 'pending';
    }
    return { key: d.key, label: d.label, status: s };
  });
}

/** Passou de 0 a 100: quanto da execução já andou, para a barra de progresso. */
export function stageProgress(states: StageState[]): number {
  if (states.length === 0) return 0;
  const weight = (s: StageStatus) => (s === 'done' || s === 'skipped' ? 1 : s === 'active' ? 0.5 : 0);
  return Math.round((states.reduce((acc, s) => acc + weight(s.status), 0) / states.length) * 100);
}
