import { describe, expect, it } from 'vitest';
import { APP_TIME_ZONE, monthYear, prevMonthYear, todayLong } from '../src/i18n/dates';

/**
 * O servidor roda em UTC e o leitor está em UTC-3. Entre 21h e meia-noite do horário dele, o
 * servidor já está no dia seguinte: sem o fuso explícito, o artigo sairia com o "hoje" errado
 * e a busca com o mês errado na virada do mês.
 */
describe('datas no fuso do sistema (UTC-3)', () => {
  it('o fuso é o de São Paulo', () => {
    expect(APP_TIME_ZONE).toBe('America/Sao_Paulo');
  });

  it('22h do dia 20 em São Paulo (01h UTC do dia 21) ainda é dia 20', () => {
    const now = new Date('2026-09-21T01:00:00Z');
    expect(todayLong('pt-BR', now)).toBe('20 de setembro de 2026');
  });

  it('na virada do mês, o mês é o do leitor e não o do servidor', () => {
    const now = new Date('2026-10-01T01:00:00Z'); // 30/09 22h em São Paulo
    expect(monthYear('pt-BR', now)).toBe('setembro de 2026');
    expect(prevMonthYear('pt-BR', now)).toBe('agosto de 2026');
  });

  it('a virada do ano também: janeiro em UTC ainda é dezembro para o leitor, e o anterior a janeiro é dezembro', () => {
    expect(monthYear('pt-BR', new Date('2026-01-01T01:00:00Z'))).toBe('dezembro de 2025');
    expect(prevMonthYear('pt-BR', new Date('2026-01-01T01:00:00Z'))).toBe('novembro de 2025');
    expect(prevMonthYear('pt-BR', new Date('2026-01-15T15:00:00Z'))).toBe('dezembro de 2025');
  });

  it('meio do dia não muda nada, e o inglês segue a mesma regra', () => {
    const now = new Date('2026-09-20T15:00:00Z');
    expect(todayLong('pt-BR', now)).toBe('20 de setembro de 2026');
    expect(monthYear('en-US', now)).toBe('September 2026');
    expect(prevMonthYear('en-US', now)).toBe('August 2026');
  });

  it('o fuso pode ser trocado quando um chamador precisa (UTC)', () => {
    const now = new Date('2026-09-21T01:00:00Z');
    expect(todayLong('pt-BR', now, 'UTC')).toBe('21 de setembro de 2026');
  });
});
