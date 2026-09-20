import { describe, expect, it } from 'vitest';
import { deriveStages, stageMarker, stageProgress, stagesFor, type StageKey } from '../src/pipeline/stages';

const log = (...keys: StageKey[]) => keys.flatMap((k) => [`${stageMarker(k)}`, 'linha de detalhe qualquer']);
const status = (lines: string[], run: Parameters<typeof deriveStages>[1], kind: Parameters<typeof deriveStages>[2] = 'create') =>
  Object.fromEntries(deriveStages(lines, run, kind).map((s) => [s.key, s.status]));

describe('stageMarker e stagesFor', () => {
  it('um post novo tem 6 etapas em ordem; descoberta tem 1; update não tem etapas', () => {
    expect(stagesFor('create').map((s) => s.key)).toEqual(['pesquisa', 'redacao', 'revisao', 'imagens', 'embeds', 'publicacao']);
    expect(stagesFor('discover').map((s) => s.key)).toEqual(['descoberta']);
    expect(stagesFor('update')).toEqual([]);
  });

  it('o marcador é legível e único por etapa', () => {
    const all = [...stagesFor('create'), ...stagesFor('discover')].map((s) => s.marker);
    expect(new Set(all).size).toBe(all.length);
    for (const m of all) expect(m).toMatch(/^etapa: /);
  });

  it('só as etapas de polimento são opcionais', () => {
    const optional = stagesFor('create').filter((s) => s.optional).map((s) => s.key);
    expect(optional).toEqual(['revisao', 'imagens', 'embeds']);
  });
});

describe('deriveStages: execução em andamento', () => {
  it('sem nenhuma linha ainda: a primeira etapa está começando', () => {
    expect(status([], 'running')).toEqual({
      pesquisa: 'active', redacao: 'pending', revisao: 'pending', imagens: 'pending', embeds: 'pending', publicacao: 'pending',
    });
  });

  it('a etapa mais avançada está ativa e as anteriores concluídas', () => {
    expect(status(log('pesquisa', 'redacao', 'revisao'), 'running')).toEqual({
      pesquisa: 'done', redacao: 'done', revisao: 'active', imagens: 'pending', embeds: 'pending', publicacao: 'pending',
    });
  });

  it('etapa opcional que nunca apareceu é pulada quando uma posterior já começou', () => {
    // template sem revisão: vai de redação direto para imagens
    expect(status(log('pesquisa', 'redacao', 'imagens'), 'running')).toEqual({
      pesquisa: 'done', redacao: 'done', revisao: 'skipped', imagens: 'active', embeds: 'pending', publicacao: 'pending',
    });
  });

  it('etapa obrigatória nunca é marcada como pulada', () => {
    const s = status(log('redacao'), 'running');
    expect(s.pesquisa).toBe('done'); // obrigatória e anterior: concluída, nunca "skipped"
  });

  it('a ordem do log não importa, só a etapa mais avançada', () => {
    expect(status(['ruído', stageMarker('imagens'), stageMarker('pesquisa')], 'running').imagens).toBe('active');
  });
});

describe('deriveStages: execução terminada', () => {
  it('sucesso: tudo concluído, e o que o template desligou aparece como pulado', () => {
    expect(status(log('pesquisa', 'redacao', 'imagens', 'publicacao'), 'success')).toEqual({
      pesquisa: 'done', redacao: 'done', revisao: 'skipped', imagens: 'done', embeds: 'skipped', publicacao: 'done',
    });
  });

  it('parcial conta como concluída', () => {
    expect(status(log('pesquisa', 'redacao', 'publicacao'), 'partial').publicacao).toBe('done');
  });

  it('falha no meio: a etapa em que parou fica falhada e as seguintes pendentes', () => {
    expect(status(log('pesquisa', 'redacao', 'imagens'), 'failed')).toEqual({
      pesquisa: 'done', redacao: 'done', revisao: 'skipped', imagens: 'failed', embeds: 'pending', publicacao: 'pending',
    });
  });

  it('cancelada também marca onde parou', () => {
    expect(status(log('pesquisa', 'redacao'), 'cancelled').redacao).toBe('failed');
  });

  it('falha logo no começo, antes de qualquer marcador: a primeira etapa falhou', () => {
    expect(status(['falha: sem credencial'], 'failed')).toEqual({
      pesquisa: 'failed', redacao: 'pending', revisao: 'pending', imagens: 'pending', embeds: 'pending', publicacao: 'pending',
    });
  });

  it('run antigo, de antes dos marcadores, que terminou bem: tudo concluído em vez de tudo pendente', () => {
    const s = status(['geração da pauta "x" iniciada', 'post #1 criado'], 'success');
    expect(s.pesquisa).toBe('done');
    expect(s.redacao).toBe('done');
    expect(s.publicacao).toBe('done');
  });
});

describe('deriveStages: descoberta', () => {
  it('uma etapa só, ativa enquanto roda e concluída no fim', () => {
    expect(status(log('descoberta'), 'running', 'discover')).toEqual({ descoberta: 'active' });
    expect(status(log('descoberta'), 'success', 'discover')).toEqual({ descoberta: 'done' });
    expect(status(log('descoberta'), 'failed', 'discover')).toEqual({ descoberta: 'failed' });
  });

  it('update não tem etapas: a tela mostra só o log', () => {
    expect(deriveStages(['x'], 'running', 'update')).toEqual([]);
  });
});

describe('stageProgress', () => {
  it('vai de 0 a 100 conforme as etapas andam', () => {
    expect(stageProgress(deriveStages([], 'running', 'create'))).toBe(8); // 0.5 de 6
    expect(stageProgress(deriveStages(log('pesquisa', 'redacao', 'revisao'), 'running', 'create'))).toBe(42);
    expect(stageProgress(deriveStages(log('pesquisa', 'redacao', 'publicacao'), 'success', 'create'))).toBe(100);
  });

  it('sem etapas, zero', () => {
    expect(stageProgress([])).toBe(0);
  });

  it('só cresce: uma etapa a mais nunca diminui a barra', () => {
    const steps: StageKey[][] = [['pesquisa'], ['pesquisa', 'redacao'], ['pesquisa', 'redacao', 'revisao'], ['pesquisa', 'redacao', 'revisao', 'imagens']];
    const values = steps.map((s) => stageProgress(deriveStages(log(...s), 'running', 'create')));
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });
});
