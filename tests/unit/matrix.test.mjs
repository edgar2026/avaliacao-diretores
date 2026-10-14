import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDashboardModel, buildPeriodLabelMap, matrixPeriodColumns,
  filterMatrixRows, formatMetricCell, MATRIX_INDICATORS
} from '../../src/services/dashboardService.js';

const rawBase = () => ({
  avaliacoes: [
    { id:'a2', titulo:'Segundo tri', ano:2026, trimestre:2, arquivo_nome_original:'b.xlsx', storage_path:'avaliacoes/2026/2/a2/x.xlsx', importado_em:'2026-07-01T00:00:00Z', publicado_em:'2026-07-01T00:01:00Z', total_registros:2, total_colunas:10 },
    { id:'a1', titulo:'Primeiro tri', ano:2026, trimestre:1, arquivo_nome_original:'a.xlsx', storage_path:'avaliacoes/2026/1/a1/x.xlsx', importado_em:'2026-04-01T00:00:00Z', publicado_em:'2026-04-01T00:01:00Z', total_registros:2, total_colunas:10 }
  ],
  registros: [
    { id:'r1', avaliacao_id:'a1', codigo_regional:'N', regional:'Norte', diretor:'Ana', unidade:'U1', status_gestao:'Gestão II', ciclo_vida:'Adulto', nivel_atual:'(III)', numero_linha_origem:3 },
    { id:'r2', avaliacao_id:'a1', codigo_regional:'S', regional:'Sul', diretor:'Bia', unidade:'U2', status_gestao:'Gestão I', ciclo_vida:'Jovem', nivel_atual:'(II)', numero_linha_origem:4 },
    { id:'r3', avaliacao_id:'a2', codigo_regional:'N', regional:'Norte', diretor:'Ana', unidade:'U1', status_gestao:'Gestão III', ciclo_vida:'Adulto', nivel_atual:'(IV)', numero_linha_origem:3 },
    { id:'r4', avaliacao_id:'a2', codigo_regional:'N', regional:'Norte', diretor:'Caio', unidade:'U3', status_gestao:'Gestão II', ciclo_vida:'Adulto', nivel_atual:'(III)', numero_linha_origem:4 }
  ],
  periodos: [
    { id:'p1', registro_id:'r1', rotulo_periodo:'JULHO', ordem:2, estagio:'Delegação I', nivel:'(II)' },
    { id:'p2', registro_id:'r1', rotulo_periodo:'2TRI/25', ordem:1, estagio:'Delegação I', nivel:'(I)' },
    { id:'p3', registro_id:'r3', rotulo_periodo:'JULHO', ordem:1, estagio:'Delegação II', nivel:'(IV)' }
  ],
  indicadores: [
    { id:'i1', registro_id:'r1', nome_indicador:'PRESENCIAL', valor_numerico:'4.5', valor_texto:null, unidade_medida:null, ordem:1 },
    { id:'i2', registro_id:'r1', nome_indicador:'% EBITDA', valor_numerico:'0.12', valor_texto:null, unidade_medida:'%', ordem:2 }
  ]
});

test('matriz: colunas de histórico em ordem (avaliação, ordem) com rótulo composto', () => {
  const model = buildDashboardModel(rawBase());
  const cols = matrixPeriodColumns(model.registros, model.avaliacoes);
  // a1 primeiro (1º tri), depois a2 (2º tri); JULHO compõe por repetir entre avaliações
  assert.deepEqual(cols, ['2TRI/25', 'JULHO · 1º tri/2026', 'JULHO · 2º tri/2026']);
});

test('matriz: bloco final lê statusGestao/nivelAtual; histórico lê periodo.estagio/nivel (nunca confunde)', () => {
  const model = buildDashboardModel(rawBase());
  const r1 = model.registros.find(r => r.id === 'r1');
  // Bloco final (registro)
  assert.equal(r1.statusGestao, 'Gestão II');
  assert.equal(r1.cicloVida, 'Adulto');
  assert.equal(r1.nivelAtual, '(III)');
  // Histórico (período) é outra leitura
  const labelMap = buildPeriodLabelMap(model.registros, model.avaliacoes);
  const pJulho = r1.periodos.find(p => labelMap.get(`${r1.avaliacaoId}|${p.rotulo}`) === 'JULHO · 1º tri/2026');
  assert.equal(pJulho.estagio, 'Delegação I');
  assert.equal(pJulho.nivel, '(II)');
  assert.notEqual(r1.statusGestao, pJulho.estagio, 'statusGestao ≠ estagio do período');
  assert.notEqual(r1.nivelAtual, pJulho.nivel, 'nivelAtual ≠ nivel do período');
});

test('matriz: caso Hesdras — SET/3TRI 2026 (Gestão I/(III)) e bloco final (Delegação I/Reposicionamento/(IV))', () => {
  const raw = {
    avaliacoes: [{ id:'av1', titulo:'3TRI 2026', ano:2026, trimestre:3, arquivo_nome_original:'s.xlsx', storage_path:'avaliacoes/2026/3/av1/x.xlsx', importado_em:'2026-10-01T00:00:00Z', publicado_em:'2026-10-01T00:01:00Z', total_registros:1, total_colunas:10 }],
    registros: [
      { id:'h', avaliacao_id:'av1', codigo_regional:'PP', regional:'PAULO PALMEIRA', diretor:'HESDRAS VIANA', unidade:'UNINASSAU BOA VIAGEM', status_gestao:'Delegação I', ciclo_vida:'Reposicionamento', nivel_atual:'(IV)', numero_linha_origem:2 },
      { id:'x', avaliacao_id:'av1', codigo_regional:'XX', regional:'OUTRA', diretor:'OUTRO', unidade:'U X', status_gestao:'Gestão II', ciclo_vida:'Adulto', nivel_atual:'(III)', numero_linha_origem:3 }
    ],
    periodos: [
      { id:'ph', registro_id:'h', rotulo_periodo:'SET/3TRI 2026', ordem:15, estagio:'Gestão I', nivel:'(III)' },
      { id:'px', registro_id:'x', rotulo_periodo:'SET/3TRI 2026', ordem:15, estagio:'Gestão II', nivel:'(IV)' }
    ],
    indicadores: [
      { id:'i1', registro_id:'h', nome_indicador:'PRESENCIAL', valor_numerico:'4.8', valor_texto:null, unidade_medida:null, ordem:1 },
      { id:'i2', registro_id:'h', nome_indicador:'% EBITDA', valor_numerico:'0.13', valor_texto:null, unidade_medida:'%', ordem:2 }
    ]
  };
  const model = buildDashboardModel(raw);
  const labelMap = buildPeriodLabelMap(model.registros, model.avaliacoes);
  const labelOf = (r, p) => labelMap.get(`${r.avaliacaoId}|${p.rotulo}`);
  // O registro tem só 2 dos 9 indicadores; os demais ficam ausentes (→ "—", nunca 0)
  const h = model.registros.find(r => r.id === 'h');
  assert.equal(h.metricas.Presencial, 4.8);
  assert.equal(h.metricas['Nota geral'], undefined, 'indicador ausente não vira 0');
  // Filtro por período + status/nível do histórico acha Hesdras
  const rows = filterMatrixRows(model.registros, { periodo:'SET/3TRI 2026', statusTrimestral:'Gestão I', nivel:'(III)' }, labelOf);
  assert.deepEqual(rows.map(r => r.diretor), ['HESDRAS VIANA']);
  // Sem período escolhido, status/nível casam em qualquer período
  const rowsSemPeriodo = filterMatrixRows(model.registros, { statusTrimestral:'Gestão I' }, labelOf);
  assert.deepEqual(rowsSemPeriodo.map(r => r.diretor), ['HESDRAS VIANA']);
  // Status de gestão (bloco final) é leitura própria
  const rowsStatusGestao = filterMatrixRows(model.registros, { statusGestao:'Delegação I' }, labelOf);
  assert.deepEqual(rowsStatusGestao.map(r => r.diretor), ['HESDRAS VIANA']);
  // Período delimita: Gestão II existe só no registro x
  const rowsG2 = filterMatrixRows(model.registros, { periodo:'SET/3TRI 2026', statusTrimestral:'Gestão II' }, labelOf);
  assert.deepEqual(rowsG2.map(r => r.diretor), ['OUTRO']);
});

test('matriz: filtros combinam por AND; vazio = Todos; registro sem o período escolhido não casa', () => {
  const model = buildDashboardModel(rawBase());
  const labelMap = buildPeriodLabelMap(model.registros, model.avaliacoes);
  const labelOf = (r, p) => labelMap.get(`${r.avaliacaoId}|${p.rotulo}`);
  const all = () => filterMatrixRows(model.registros, {}, labelOf);
  assert.equal(all().length, 4, 'sem filtros retorna todos');
  assert.equal(filterMatrixRows(model.registros, { regional:'Norte' }, labelOf).length, 3);
  assert.equal(filterMatrixRows(model.registros, { regional:'Norte', diretor:'Ana' }, labelOf).length, 2);
  assert.equal(filterMatrixRows(model.registros, { regional:'Sul', diretor:'Ana' }, labelOf).length, 0, 'AND descarta');
  // Período só composto existe em r1/r3; r2 e r4 (sem período) não casam com filtro de status/nível
  assert.equal(filterMatrixRows(model.registros, { periodo:'JULHO · 1º tri/2026', statusTrimestral:'Delegação I' }, labelOf).length, 1);
  assert.equal(filterMatrixRows(model.registros, { statusTrimestral:'Delegação I' }, labelOf).length, 1, 'só r1 tem esse estagio');
});

test('matriz: formatMetricCell — % com 1 casa, demais 2 casas, null → —', () => {
  assert.equal(formatMetricCell(null, 'EBITDA'), '—');
  assert.equal(formatMetricCell(0.13, 'EBITDA'), '13,0%');
  assert.equal(formatMetricCell(0.1234, 'Ritmo de captação'), '12,3%');
  assert.equal(formatMetricCell(4.5, 'Presencial'), '4,50');
  assert.equal(formatMetricCell(4.8, 'Nota geral'), '4,80');
  assert.equal(formatMetricCell(NaN, 'Presencial'), '—');
});

test('matriz: MATRIX_INDICATORS cobre os 9 indicadores na ordem da planilha', () => {
  assert.equal(MATRIX_INDICATORS.length, 9);
  assert.deepEqual(MATRIX_INDICATORS.map(m => m.label), [
    'Presencial', 'Acadêmico', 'Pós-graduação', 'Nota geral', 'Captação',
    'Crescimento', 'Evasão', 'Avaliação institucional', 'EBITDA'
  ]);
  assert.equal(MATRIX_INDICATORS.find(m => m.label === 'Captação').key, 'Ritmo de captação');
  assert.equal(MATRIX_INDICATORS.find(m => m.label === 'Crescimento').key, 'Crescimento de matrículas');
});
