import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuarterHeader, buildQuarterLabelMap } from '../../src/services/dashboardService.js';
import { romanLevel } from '../../src/dataParser.js';

test('parseQuarterHeader: reconhece variações reais de cabeçalho de trimestre', () => {
  const casos = [
    ['2TRI/25', 2, 2025],
    ['2TRI/2025', 2, 2025],
    ['1º TRI/26', 1, 2026],
    ['1 TRI 2026', 1, 2026],
    ['MAR/1TRI 2026', 1, 2026],
    ['JUN/2TRI 2026', 2, 2026],
    ['SET/3TRI 2026', 3, 2026],
    ['DEZ/4TRI 2026', 4, 2026],
    ['DEZ/4TRI', 4, null],
    ['SET/3TRI', 3, null]
  ];
  for(const [rotulo, q, y] of casos){
    const r = parseQuarterHeader(rotulo);
    assert.equal(r.isQuarter, true, `${rotulo} deve ser trimestre`);
    assert.equal(r.quarter, q, `${rotulo} quarter`);
    assert.equal(r.year, y, `${rotulo} year`);
  }
});

test('parseQuarterHeader: meses e rótulos não-trimestre retornam isQuarter=false', () => {
  const meses = ['JULHO','AGOSTO','OUTUBRO','NOVEMBRO','JAN DE 2026','FEV DE 2026','ABR DE 2026','MAI DE 2026','JUL DE 2026','AGO DE 2026'];
  for(const m of meses){
    const r = parseQuarterHeader(m);
    assert.equal(r.isQuarter, false, `${m} não deve ser trimestre`);
  }
  assert.equal(parseQuarterHeader('').isQuarter, false);
  assert.equal(parseQuarterHeader(null).isQuarter, false);
  assert.equal(parseQuarterHeader('5TRI/26').isQuarter, false, 'trimestre fora de 1–4');
});

test('buildQuarterLabelMap: 16 rótulos reais → exatamente 6 trimestres ordenados', () => {
  const registros = [{
    avaliacaoId:'a1',
    periodos:[
      { rotulo:'2TRI/25', ordem:0 }, { rotulo:'JULHO', ordem:1 }, { rotulo:'AGOSTO', ordem:2 },
      { rotulo:'SET/3TRI', ordem:3 }, { rotulo:'OUTUBRO', ordem:4 }, { rotulo:'NOVEMBRO', ordem:5 },
      { rotulo:'DEZ/4TRI', ordem:6 }, { rotulo:'JAN DE 2026', ordem:7 }, { rotulo:'FEV DE 2026', ordem:8 },
      { rotulo:'MAR/1TRI 2026', ordem:9 }, { rotulo:'ABR DE 2026', ordem:10 }, { rotulo:'MAI DE 2026', ordem:11 },
      { rotulo:'JUN/2TRI 2026', ordem:12 }, { rotulo:'JUL DE 2026', ordem:13 }, { rotulo:'AGO DE 2026', ordem:14 },
      { rotulo:'SET/3TRI 2026', ordem:15 }
    ]
  }];
  const avaliacoes = [{ id:'a1', ano:2026, trimestre:3 }];
  const { labelMap, columns } = buildQuarterLabelMap(registros, avaliacoes);
  assert.deepEqual(columns.map(c => c.label), [
    '2º TRI/2025','3º TRI/2025','4º TRI/2025','1º TRI/2026','2º TRI/2026','3º TRI/2026'
  ]);
  assert.equal(labelMap.get('a1|2TRI/25'), '2º TRI/2025');
  assert.equal(labelMap.get('a1|SET/3TRI'), '3º TRI/2025', 'ano inferido');
  assert.equal(labelMap.get('a1|DEZ/4TRI'), '4º TRI/2025', 'ano inferido');
  assert.equal(labelMap.get('a1|MAR/1TRI 2026'), '1º TRI/2026');
  assert.equal(labelMap.get('a1|JUN/2TRI 2026'), '2º TRI/2026');
  assert.equal(labelMap.get('a1|SET/3TRI 2026'), '3º TRI/2026');
  assert.equal(labelMap.has('a1|JULHO'), false, 'mês não entra no mapa');
  assert.equal(labelMap.has('a1|JAN DE 2026'), false, 'mês não entra no mapa');
});

test('buildQuarterLabelMap: ordena por ano e trimestre, não alfabeticamente', () => {
  const registros = [{
    avaliacaoId:'a1',
    periodos:[
      { rotulo:'4º TRI/2026', ordem:0 },
      { rotulo:'1º TRI/2025', ordem:1 },
      { rotulo:'2TRI/26', ordem:2 },
      { rotulo:'3TRI/25', ordem:3 }
    ]
  }];
  const { columns } = buildQuarterLabelMap(registros, [{ id:'a1', ano:2026, trimestre:4 }]);
  assert.deepEqual(columns.map(c => c.label), ['1º TRI/2025','3º TRI/2025','2º TRI/2026','4º TRI/2026']);
});

test('romanLevel: correspondência exata I–V, sem reconhecimento parcial', () => {
  assert.equal(romanLevel('(I)'), 1);
  assert.equal(romanLevel('(II)'), 2);
  assert.equal(romanLevel('(III)'), 3);
  assert.equal(romanLevel('(IV)'), 4, 'IV não pode virar I nem V');
  assert.equal(romanLevel('(V)'), 5);
  assert.equal(romanLevel('I'), 1);
  assert.equal(romanLevel('II'), 2);
  assert.equal(romanLevel('III'), 3);
  assert.equal(romanLevel('IV'), 4);
  assert.equal(romanLevel('V'), 5);
  assert.equal(romanLevel('Não informado'), null);
  assert.equal(romanLevel(null), null);
  assert.equal(romanLevel(''), null);
  assert.equal(romanLevel('VI'), null, 'fora de I–V');
  assert.equal(romanLevel('X'), null);
});

test('Gregorio Batista: níveis trimestrais reais convertem para 5,5,5,1,1,2', () => {
  const periodosGregorio = [
    { rotulo:'2TRI/25', nivel:'(V)' }, { rotulo:'SET/3TRI', nivel:'(V)' }, { rotulo:'DEZ/4TRI', nivel:'(V)' },
    { rotulo:'MAR/1TRI 2026', nivel:'(I)' }, { rotulo:'JUN/2TRI 2026', nivel:'(I)' }, { rotulo:'SET/3TRI 2026', nivel:'(II)' }
  ];
  const registros = [{ avaliacaoId:'a1', periodos: periodosGregorio.map((p,i) => ({ ...p, ordem:i*3 })) }];
  const { labelMap, columns } = buildQuarterLabelMap(registros, [{ id:'a1', ano:2026, trimestre:3 }]);
  const niveis = columns.map(c => {
    const p = periodosGregorio.find(x => labelMap.get(`a1|${x.rotulo}`) === c.label);
    return p ? romanLevel(p.nivel) : null;
  });
  assert.deepEqual(niveis, [5,5,5,1,1,2]);
});
