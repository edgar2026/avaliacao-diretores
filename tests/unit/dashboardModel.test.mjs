import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDashboardModel, aggregateRegistros, regionalsOf, directorsOf,
  buildPeriodLabelMap, avgNumbers, avaliacaoLabel, recordMetric, buildRadarSeries,
  countDistinctNames, distinctNames, abbreviatePeriods, isPresentName
} from '../../src/services/dashboardService.js';
import { friendlyMetricName, romanLevel } from '../../src/dataParser.js';

const raw = () => ({
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
    { id:'i2', registro_id:'r1', nome_indicador:'% EBITDA', valor_numerico:'0.12', valor_texto:null, unidade_medida:'%', ordem:2 },
    { id:'i3', registro_id:'r3', nome_indicador:'PRESENCIAL', valor_numerico:'4.0', valor_texto:null, unidade_medida:null, ordem:1 },
    { id:'i4', registro_id:'r3', nome_indicador:'OBS. COMPLEMENTAR', valor_numerico:null, valor_texto:'texto livre', unidade_medida:null, ordem:3 }
  ]
});

test('modelo ordena avaliações por ano/trimestre e rotula tri/ano', () => {
  const model = buildDashboardModel(raw());
  assert.deepEqual(model.avaliacoes.map(a => a.id), ['a1', 'a2']);
  assert.equal(model.avaliacoes[0].label, '1º tri/2026');
  assert.equal(model.avaliacoes[1].label, '2º tri/2026');
  assert.equal(avaliacaoLabel({ trimestre:4, ano:2025 }), '4º tri/2025');
  // cada avaliação carrega a identificação exibida na tela
  assert.equal(model.avaliacoes[0].titulo, 'Primeiro tri');
  assert.equal(model.avaliacoes[0].arquivoNome, 'a.xlsx');
});

test('registros recebem métricas EAV amigáveis, nível romano e períodos aninhados', () => {
  const model = buildDashboardModel(raw());
  const r1 = model.registros.find(r => r.id === 'r1');
  assert.equal(r1.avaliacaoId, 'a1');
  assert.equal(r1.avaliacaoLabel, '1º tri/2026');
  assert.equal(r1.metricas.Presencial, 4.5);
  assert.equal(r1.metricas.EBITDA, 0.12);
  assert.equal(r1.nivelRoman, 3);
  assert.equal(r1.periodos.length, 2);
  assert.deepEqual(r1.periodos.map(p => p.rotulo), ['2TRI/25', 'JULHO'], 'períodos ordenados por ordem');
  const r3 = model.registros.find(r => r.id === 'r3');
  assert.equal(r3.metricas.Presencial, 4);
  assert.equal(r3.indicadores.find(i => i.nome === 'OBS. COMPLEMENTAR').valorTexto, 'texto livre');
});

// Regressão da tela branca: o RadarChart lia `r.metrics` (inglês), mas o modelo
// do Supabase expõe `r.metricas` (português) — `undefined` derrubava o React.
test('registros do modelo expõem `metricas` (contrato usado pelo RadarChart)', () => {
  const model = buildDashboardModel(raw());
  const r1 = model.registros.find(r => r.id === 'r1');
  assert.equal(r1.metricas.Presencial, 4.5);
  assert.equal(r1.metrics, undefined, 'não existe a propriedade inglesa `metrics`');
  // Padrão exato do RadarChart (com proteção `?.`) não pode lançar exceção.
  const notas = model.registros.map(r => r?.metricas?.['Nota geral']);
  assert.deepEqual(notas, [undefined, undefined, undefined, undefined]);
  const presenciais = model.registros.map(r => r?.metricas?.['Presencial']);
  assert.deepEqual(presenciais, [4.5, undefined, 4, undefined]);
});

test('agregados por avaliação: diretores, unidades, nível médio e médias', () => {
  const model = buildDashboardModel(raw());
  const a1 = model.avaliacoes[0];
  assert.equal(a1.agregados.diretores, 2);
  assert.equal(a1.agregados.unidades, 2);
  assert.equal(a1.agregados.nivelMedio, 2.5);
  assert.equal(a1.agregados.metricas.Presencial, 4.5);
  const a2 = model.avaliacoes[1];
  assert.equal(a2.agregados.diretores, 2);
  assert.equal(a2.agregados.nivelMedio, 3.5);
  assert.equal(a2.agregados.metricas.Presencial, 4);
});

test('filtros em cascata: regionais e diretores por regional', () => {
  const model = buildDashboardModel(raw());
  assert.deepEqual(regionalsOf(model.registros), ['Norte', 'Sul']);
  assert.deepEqual(directorsOf(model.registros, 'Norte'), ['Ana', 'Caio']);
  assert.deepEqual(directorsOf(model.registros, 'Sul'), ['Bia']);
  assert.deepEqual(directorsOf(model.registros, ''), ['Ana', 'Bia', 'Caio']);
});

test('rótulos compostos de períodos internos repetidos entre avaliações', () => {
  const model = buildDashboardModel(raw());
  const mapaAmbos = buildPeriodLabelMap(model.registros, model.avaliacoes);
  assert.equal(mapaAmbos.get('a1|JULHO'), 'JULHO · 1º tri/2026');
  assert.equal(mapaAmbos.get('a2|JULHO'), 'JULHO · 2º tri/2026');
  assert.equal(mapaAmbos.get('a1|2TRI/25'), '2TRI/25', 'rótulo único permanece simples');

  const soA1 = model.registros.filter(r => r.avaliacaoId === 'a1');
  const mapaSoA1 = buildPeriodLabelMap(soA1, model.avaliacoes);
  assert.equal(mapaSoA1.get('a1|JULHO'), 'JULHO', 'sem duplicidade entre avaliações, usa o rótulo original');
});

test('helpers de média e matchers de indicadores', () => {
  assert.equal(avgNumbers([1, 2, null, 'x']), 1.5);
  assert.equal(avgNumbers([]), null);
  assert.equal(friendlyMetricName('PRESENCIAL'), 'Presencial');
  assert.equal(friendlyMetricName('% RITMO (CAPTAÇÃO)'), 'Ritmo de captação');
  assert.equal(friendlyMetricName('% EBITDA'), 'EBITDA');
  assert.equal(friendlyMetricName('NÍVEL'), null);
  assert.equal(romanLevel('(IV)'), 4);
  assert.equal(romanLevel('sem nível'), null);
});

// Conversão única dos dois nomes históricos (`metricas` do modelo Supabase,
// `metrics` do parser da planilha). Ausência retorna null — NUNCA 0.
test('recordMetric converte metricas/metrics e ausência não vira zero', () => {
  assert.equal(recordMetric({ metricas: { Presencial: 4.2 } }, 'Presencial'), 4.2);
  assert.equal(recordMetric({ metrics: { Presencial: 3.1 } }, 'Presencial'), 3.1, 'registro do parser usa `metrics`');
  assert.equal(recordMetric({ metricas: { Presencial: null } }, 'Presencial'), null);
  assert.equal(recordMetric({ metricas: {} }, 'Presencial'), null);
  assert.equal(recordMetric({ metrics: {} }, 'Presencial'), null);
  assert.equal(recordMetric({}, 'Presencial'), null);
  assert.equal(recordMetric(null, 'Presencial'), null);
  assert.equal(recordMetric({ metricas: { Presencial: 'texto livre' } }, 'Presencial'), null, 'não numérico é descartado');
  assert.equal(recordMetric({ metricas: { Presencial: '4.5' } }, 'Presencial'), 4.5, 'numérico vindo como texto do banco é aceito');
});

// Regressão do RadarChart: registro sem indicadores não pode derrubar o
// render nem virar zero no radar; sem nenhum indicador, radar indisponível.
test('buildRadarSeries: sem indicadores → indisponível; ausência nunca vira zero', () => {
  const vazio = buildRadarSeries([], []);
  assert.equal(vazio.disponivel, false);
  assert.deepEqual(vazio.nomes, []);

  const semMetricas = buildRadarSeries([{}, { id:'x' }], [{}, { id:'x' }]);
  assert.equal(semMetricas.disponivel, false, 'registros sem metricas/metrics → “Indicadores não disponíveis”');

  const model = buildDashboardModel(raw());
  const radar = buildRadarSeries(model.registros, model.registros);
  assert.equal(radar.disponivel, true);
  assert.deepEqual(radar.nomes, ['Presencial', 'EBITDA'], 'só eixos com valor numérico entram no radar');
  assert.equal(radar.sel[0], 4.25, 'média de 4.5 (r1) e 4.0 (r3)');
  assert.equal(radar.sel[1], 0.12);

  const parcial = buildRadarSeries([{ metricas: { Presencial: 4 } }, {}], [{ metricas: { Presencial: 4 } }, {}]);
  assert.equal(parcial.sel[0], 4, 'registro sem indicador não puxa a média para baixo (não vira 0)');
});

// Regressão do Problema 1: o card de avaliação exibia nº de registros como
// nº de diretores, e "Diretor não informado" inflava a contagem geral.
test('countDistinctNames: contagem definitiva de diretores/unidades válidos', () => {
  const regs = [
    { diretor: 'Ana', unidade: 'U1' },
    { diretor: 'Ana', unidade: 'U1' },
    { diretor: 'ANA ', unidade: ' U1' },
    { diretor: 'Diretor não informado', unidade: 'Unidade não informada' },
    { diretor: 'Bia', unidade: 'U2' },
    { diretor: null, unidade: '' },
    { diretor: '  Paulo  Palmeira ', unidade: 'U3' },
    { diretor: 'Paulo Palmeira', unidade: 'U3' }
  ];
  assert.equal(countDistinctNames(regs, 'diretor'), 3, 'Ana, Bia e Paulo Palmeira; marcador/nulo descartados');
  assert.equal(countDistinctNames(regs, 'unidade'), 3, 'U1, U2 e U3');
  assert.equal(countDistinctNames([], 'diretor'), 0);
  assert.equal(countDistinctNames(null, 'diretor'), 0);
  // Casos reais da planilha: 61 registros → 60 diretores e 60 unidades
  // (1 marcador descartado; cada diretor tem exatamente 1 unidade).
  // Regional "Paulo Palmeira" tem 13 registros → 13 diretores distintos.
  const planilha = [
    ...Array.from({ length: 13 }, (_, i) => ({ diretor: `Diretor Palmeira ${i}`, unidade: `U${i}` })),
    { diretor: 'Diretor não informado', unidade: 'Unidade não informada' },
    ...Array.from({ length: 47 }, (_, i) => ({ diretor: `Diretor ${i}`, unidade: `Unidade ${i}` }))
  ];
  assert.equal(planilha.length, 61);
  assert.equal(countDistinctNames(planilha, 'diretor'), 60);
  assert.equal(countDistinctNames(planilha, 'unidade'), 60);
});

test('distinctNames e isPresentName: listas e marcadores técnicos', () => {
  assert.deepEqual(distinctNames(['Sul', 'Norte', 'norte ', null, 'SUL', '—']), ['Norte', 'Sul']);
  assert.equal(isPresentName('Diretor não informado'), false);
  assert.equal(isPresentName('sem diretor'), false);
  assert.equal(isPresentName('-'), false);
  assert.equal(isPresentName('   '), false);
  assert.equal(isPresentName('Rogério Xavier'), true);
  // regionalsOf/directorsOf herdam as mesmas regras
  assert.deepEqual(regionalsOf([{ regional: 'Norte' }, { regional: 'norte' }, { regional: '—' }]), ['Norte']);
  assert.deepEqual(directorsOf([{ diretor: 'Ana', regional: 'N' }, { diretor: 'ana', regional: 'N' }, { diretor: 'Diretor não informado', regional: 'N' }], 'N'), ['Ana']);
});

// Eixo X do gráfico de evolução: abreviações fixas dos 16 rótulos reais da
// Planilha1, com ano inferido dos vizinhos e sem sobreposição de períodos.
test('abbreviatePeriods: 16 rótulos reais → abreviações com ano correto', () => {
  const brutos = ['2TRI/25','JULHO','AGOSTO','SET/3TRI','OUTUBRO','NOVEMBRO','DEZ/4TRI',
    'JAN DE 2026','FEV DE 2026','MAR/1TRI 2026','ABR DE 2026','MAI DE 2026','JUN/2TRI 2026',
    'JUL DE 2026','AGO DE 2026','SET/3TRI 2026'];
  assert.deepEqual(abbreviatePeriods(brutos), [
    '2º TRI/25','JUL/25','AGO/25','3º TRI/25','OUT/25','NOV/25','4º TRI/25','JAN/26',
    'FEV/26','1º TRI/26','ABR/26','MAI/26','2º TRI/26','JUL/26','AGO/26','3º TRI/26'
  ]);
  // rótulo composto (mesmo mês em avaliações distintas) prefere o mês
  assert.deepEqual(abbreviatePeriods(['JULHO · 1º tri/2026', 'JULHO · 2º tri/2026']), ['JUL/26', 'JUL/26']);
  // sem ano em nenhum vizinho: mantém a abreviação sem sufixo
  assert.deepEqual(abbreviatePeriods(['JULHO']), ['JUL/']);
});
