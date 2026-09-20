import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP_TIME_ZONE, dateTimeFormat } from '../src/lib/datetime';

/** O banco guarda UTC; a tela mostra UTC-3, em qualquer fuso do servidor ou do navegador. */

test('o fuso do painel é o de São Paulo', () => {
  assert.equal(APP_TIME_ZONE, 'America/Sao_Paulo');
});

test('10:00 UTC aparece como 07:00 (a descoberta agendada para as 7h não some para as 10h)', () => {
  const out = dateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date('2026-09-21T10:00:00Z'));
  assert.match(out, /21\/09\/2026/);
  assert.match(out, /07:00/);
});

test('depois das 21h de Brasília o dia ainda é o de Brasília, não o do UTC', () => {
  const out = dateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date('2026-09-21T01:30:00Z'));
  assert.match(out, /20\/09\/2026/);
  assert.match(out, /22:30/);
});

test('as opções do chamador valem, e o fuso pode ser sobrescrito', () => {
  const utc = dateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: 'UTC' }).format(new Date('2026-09-21T10:00:00Z'));
  assert.match(utc, /10:00/);
});
