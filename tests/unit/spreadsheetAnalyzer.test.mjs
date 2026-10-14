import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { analyzeWorkbookBuffer, analyzeRows, parseRows } from '../../src/dataParser.js';

// Fixture movida para tests/fixtures: planilha de exemplo nunca fica na raiz
// nem em public/ (não vai para o build nem para a pasta pública da Vercel).
const exampleBuffer = () => readFileSync(new URL('../fixtures/exemplo-planilha.xlsx', import.meta.url));

function workbookFrom(sheets){
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  });
  return XLSX.write(wb, { type:'array', bookType:'xlsx' });
}

test('rejeita arquivo sem a aba Planilha1', () => {
  const buffer = workbookFrom({ OutraAba: [['a','b'],[1,2]] });
  assert.throws(() => analyzeWorkbookBuffer(buffer, 'sem-planilha1.xlsx'), /aba chamada Planilha1/);
});

test('detecta cabeçalhos por nome e pares período + NÍVEL dinamicamente', () => {
  const analysis = analyzeWorkbookBuffer(exampleBuffer(), 'exemplo-planilha.xlsx');

  assert.equal(analysis.ok, true);
  assert.equal(analysis.headerRow, 2);
  assert.ok(analysis.columnCount >= 40);
  assert.ok(analysis.dataRowCount >= 50);

  // 16 pares período+NÍVEL detectados (a planilha cresce na horizontal)
  assert.equal(analysis.periodLabels.length, 16);
  assert.ok(analysis.periodLabels.includes('2TRI/25'));
  assert.ok(analysis.periodLabels.includes('JUN/2TRI 2026'));

  assert.ok(analysis.regionals.length > 0);
  assert.ok(analysis.directors.length > 0);
  assert.ok(analysis.units.length > 0);
  assert.equal(analysis.missingRequired.length, 0);
  assert.equal(analysis.rowsWithoutDirector, 1); // o exemplo possui 1 linha sem diretor

  // indicadores dinâmicos (não fixos no schema)
  const names = analysis.indicatorColumns.map(i => i.name);
  assert.ok(names.includes('PRESENCIAL'));
  assert.ok(names.some(n => n.toUpperCase().includes('EBITDA')));
  assert.equal(names.filter(n => n.toUpperCase() === 'NÍVEL').length, 0);

  // registros completos para persistência
  const first = analysis.records[0];
  assert.ok(first.regional && first.director && first.unit);
  assert.equal(first.history.length, 16);
  assert.ok(first.indicators.length > 0);
  assert.ok(first.indicators.every(i => i.valor_numerico !== null || i.valor_texto !== null));
});

test('parseRows mantém o formato usado pelos gráficos', () => {
  const rows = XLSX.utils.sheet_to_json(XLSX.read(exampleBuffer(),{type:'buffer',cellDates:true}).Sheets['Planilha1'],{header:1,defval:null,raw:true});
  const dataset = parseRows(rows, 'exemplo.xlsx');
  assert.ok(Array.isArray(dataset.records) && dataset.records.length > 0);
  assert.equal(dataset.periods.length, 16);
  assert.equal(typeof dataset.records[0].metrics['Nota geral'], 'number');
});

test('campo obrigatório ausente aparece na prévia e impede a importação', () => {
  const rows = [
    ['REGIONALL','DIRETOR','UNIDADE','PERIODO A','NÍVEL','STATUS DE GESTÃO'],
    ['D','Fulano','Unidade X','Delegação I','(II)','Gestão II'],
    ['D','Fulano','Unidade Y','Delegação II','(I)','Gestão II']
  ];
  const analysis = analyzeRows(rows, 'sem-regional.xlsx');
  assert.equal(analysis.ok, false);
  assert.deepEqual(analysis.missingRequired.map(f => f.label), ['REGIONAL']);
  assert.equal(analysis.records.length, 0);
  assert.throws(() => parseRows(rows, 'sem-regional.xlsx'), /Nenhum registro válido/);
});

test('conta linhas sem diretor e duplicidades na prévia', () => {
  const rows = [
    ['REGIONAL','DIRETOR','UNIDADE','PERIODO A','NÍVEL'],
    ['Norte','Fulano','Unidade X','Delegação I','(II)'],
    ['Norte','Fulano','Unidade X','Delegação II','(I)'],
    ['Norte','','Unidade Y','Delegação I','(I)'],
    [null,null,null,null,null]
  ];
  const analysis = analyzeRows(rows, 'duplicados.xlsx');
  assert.equal(analysis.rowsWithoutDirector, 1);
  assert.equal(analysis.duplicates.length, 1);
  assert.equal(analysis.duplicates[0].count, 2);
  assert.equal(analysis.dataRowCount, 3);
});
