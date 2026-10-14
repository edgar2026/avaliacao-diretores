import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStoragePath, sanitizeFileName, contentTypeFor } from '../../src/services/storageService.js';

test('caminho segue a convenção avaliacoes/{ano}/{trimestre}/{avaliacao_id}/{timestamp}-{nome}.xlsx', () => {
  const path = buildStoragePath({ ano: 2026, trimestre: 3, avaliacaoId: 'abc-123', fileName: 'Status Diretores (Final).xlsx', timestamp: 1700000000000 });
  assert.equal(path, 'avaliacoes/2026/3/abc-123/1700000000000-status-diretores-final.xlsx');
});

test('nome do arquivo é sanitizado', () => {
  assert.equal(sanitizeFileName('3TRI 2026 — STATUS DIRETORES.xLsX'), '3tri-2026-status-diretores.xlsx');
  assert.equal(sanitizeFileName('###.xlsx'), 'planilha.xlsx');
});

test('content type apenas para xlsx/xls', () => {
  assert.equal(contentTypeFor('a.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(contentTypeFor('a.xls'), 'application/vnd.ms-excel');
});
