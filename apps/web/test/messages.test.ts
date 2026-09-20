import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { REVIEW_STATUSES } from '@content-pilot/core';

/**
 * Textos da interface. next-intl não quebra quando falta uma chave: mostra o nome
 * da chave na tela, e isso só aparece para o usuário. Estes testes pegam o furo antes.
 */

const root = resolve(import.meta.dirname, '..');
const load = (locale: string) => JSON.parse(readFileSync(join(root, 'messages', `${locale}.json`), 'utf8')) as Record<string, unknown>;
const pt = load('pt-BR');
const en = load('en');

const flat = (o: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flat(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

const get = (o: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), o);

test('pt-BR e en têm exatamente as mesmas chaves', () => {
  const a = new Set(flat(pt));
  const b = new Set(flat(en));
  assert.deepEqual([...a].filter((k) => !b.has(k)), [], 'faltam em en');
  assert.deepEqual([...b].filter((k) => !a.has(k)), [], 'faltam em pt-BR');
});

/** Todo arquivo .tsx sob src. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

test('toda chave literal usada nas telas de preview e de acompanhamento existe nos dois idiomas', () => {
  const missing: string[] = [];
  for (const file of tsxFiles(join(root, 'src'))) {
    const src = readFileSync(file, 'utf8');
    const ns = /(?:useTranslations|getTranslations)\('(preview|tracker|editor)'\)/.exec(src)?.[1];
    if (!ns) continue;
    for (const m of src.matchAll(/\bt\(\s*'([\w.]+)'/g)) {
      const key = `${ns}.${m[1]}`;
      for (const [locale, messages] of [['pt-BR', pt], ['en', en]] as const) {
        if (get(messages, key) === undefined) missing.push(`${locale}: ${key} (${file.slice(root.length + 1)})`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('as chaves dinâmicas do preview cobrem todos os valores possíveis', () => {
  for (const messages of [pt, en]) {
    for (const status of REVIEW_STATUSES) assert.ok(get(messages, `preview.reviewStatus.${status}`), `reviewStatus.${status}`);
    for (const kind of ['dull', 'thin', 'ai_tone', 'other']) assert.ok(get(messages, `preview.changeKind.${kind}`), `changeKind.${kind}`);
    for (const origin of ['generated', 'source', 'search', 'upload']) assert.ok(get(messages, `preview.origin.${origin}`), `origin.${origin}`);
    for (const reason of ['unauthorized', 'not_found', 'network']) assert.ok(get(messages, `tracker.error.${reason}`), `error.${reason}`);
  }
});
