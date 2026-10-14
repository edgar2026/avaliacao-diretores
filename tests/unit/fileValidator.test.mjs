import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpreadsheetFile, MAX_FILE_BYTES, getExtension, formatBytes } from '../../src/services/fileValidator.js';

test('rejeita extensão inválida', () => {
  const result = validateSpreadsheetFile({ name: 'relatorio.pdf', size: 1000 });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Extensão/);
});

test('rejeita arquivo acima de 15 MB', () => {
  const result = validateSpreadsheetFile({ name: 'grande.xlsx', size: MAX_FILE_BYTES + 1 });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /excede o limite/);
});

test('rejeita arquivo vazio', () => {
  const result = validateSpreadsheetFile({ name: 'vazio.xlsx', size: 0 });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /vazio/);
});

test('aceita xlsx e xls dentro do limite', () => {
  const xlsx = validateSpreadsheetFile({ name: 'plano.xlsx', size: 1024 });
  const xls = validateSpreadsheetFile({ name: 'plano.xls', size: 2048 });
  assert.equal(xlsx.ok, true);
  assert.equal(xls.ok, true);
});

test('getExtension e formatBytes', () => {
  assert.equal(getExtension('A.B.XLSX'), '.xlsx');
  assert.equal(getExtension('semextensao'), '');
  assert.equal(formatBytes(MAX_FILE_BYTES), '15 MB');
});
