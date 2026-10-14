import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHashDuplicates } from '../../src/services/avaliacoesService.js';

const hashRow = (over = {}) => ({ id: 'x', titulo: 't', ano: 2026, trimestre: 3, status: 'publicada', arquivo_hash: 'h', importado_em: 'now', ...over });

test('bloqueia reenvio quando já existe publicada no mesmo período', () => {
  const result = classifyHashDuplicates([hashRow()], { ano: 2026, trimestre: 3 });
  assert.equal(result.blocked, true);
  assert.equal(result.samePeriod.length, 1);
});

test('permite reenvio quando a tentativa anterior falhou (status erro)', () => {
  const result = classifyHashDuplicates([hashRow({ status: 'erro' })], { ano: 2026, trimestre: 3 });
  assert.equal(result.blocked, false);
  assert.equal(result.otherPeriod.length, 1);
});

test('mesmo hash em outro período é reportado como otherPeriod sem bloquear', () => {
  const result = classifyHashDuplicates([hashRow({ trimestre: 2 })], { ano: 2026, trimestre: 3 });
  assert.equal(result.blocked, false);
  assert.equal(result.otherPeriod.length, 1);
});

test('processando no mesmo período bloqueia (importação em andamento)', () => {
  const result = classifyHashDuplicates([hashRow({ status: 'processando' })], { ano: 2026, trimestre: 3 });
  assert.equal(result.blocked, true);
});
