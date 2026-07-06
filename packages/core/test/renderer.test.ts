import { describe, expect, it } from 'vitest';
import { renderGameCodesWidget } from '../src/renderers/game-codes-widget';

const NOW = new Date('2026-07-05T12:00:00Z');

describe('renderGameCodesWidget', () => {
  it('escapa HTML malicioso vindo da web (reward/code)', () => {
    const html = renderGameCodesWidget({
      data: {
        activeCodes: [{ code: 'ABC<img onerror=alert(1)>', reward: '"><script>x</script>', isNew: true }],
        expiredCodes: [],
      },
      slug: 'meu-jogo',
      topicLabel: 'Meu Jogo',
      locale: 'pt-BR',
      now: NOW,
    });
    expect(html).not.toContain('<img onerror');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;img onerror');
  });

  it('estado sem códigos mostra card informativo', () => {
    const html = renderGameCodesWidget({
      data: { activeCodes: [], expiredCodes: [] },
      slug: 's',
      topicLabel: 'Jogo X',
      locale: 'pt-BR',
      now: NOW,
    });
    expect(html).toContain('Sem códigos ativos no momento');
    expect(html).toContain('Jogo X');
  });

  it('localiza strings por idioma', () => {
    const en = renderGameCodesWidget({
      data: { activeCodes: [{ code: 'A1', reward: null, isNew: false }], expiredCodes: [] },
      slug: 's',
      topicLabel: 'Game',
      locale: 'en-US',
      now: NOW,
    });
    expect(en).toContain('Active Codes');
    expect(en).toContain('>Copy<');
  });

  it('sanitiza o slug no id/localStorage namespace', () => {
    const html = renderGameCodesWidget({
      data: { activeCodes: [], expiredCodes: [] },
      slug: 'a b"c\'/<>',
      topicLabel: 't',
      locale: 'pt-BR',
      now: NOW,
    });
    expect(html).toContain('id="dg-codes-abc"');
    expect(html).toContain("'dg_used_abc'");
  });
});
