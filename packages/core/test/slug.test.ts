import { describe, expect, it } from 'vitest';
import { slugify, stripDiacritics } from '../src/i18n/slug';
import { nextRunAt } from '../src/jobs/cron';

describe('stripDiacritics', () => {
  it('remove acentos preservando o resto', () => {
    expect(stripDiacritics('ação São João')).toBe('acao Sao Joao');
    expect(stripDiacritics('já 100% ok')).toBe('ja 100% ok');
  });
});

describe('slugify', () => {
  it('gera slug de URL', () => {
    expect(slugify('Códigos de Blox Fruits (julho/2026)!')).toBe('codigos-de-blox-fruits-julho-2026');
  });

  it('respeita maxLength sem terminar em hífen', () => {
    expect(slugify('abc def ghi', { maxLength: 7 })).toBe('abc-def');
    expect(slugify('abc def ghi', { maxLength: 8 })).toBe('abc-def');
  });

  it('fallback quando o texto não gera slug', () => {
    expect(slugify('!!!', { fallback: 'imagem' })).toBe('imagem');
    expect(slugify('')).toBe('');
  });
});

describe('nextRunAt', () => {
  it('calcula a próxima execução no timezone dado', () => {
    const from = new Date('2026-07-16T12:00:00Z');
    const next = nextRunAt('0 9 * * *', 'America/Sao_Paulo', from);
    // 09:00 em São Paulo (UTC-3) = 12:00 UTC → próximo dia
    expect(next.toISOString()).toBe('2026-07-17T12:00:00.000Z');
  });

  it('cron inválido lança erro', () => {
    expect(() => nextRunAt('not a cron', 'America/Sao_Paulo')).toThrow();
  });
});
