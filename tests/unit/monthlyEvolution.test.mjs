import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMonthHeader, buildMonthlyLabelMap, buildDirectorMonthlyEvolution } from '../../src/services/dashboardService.js';

// Cabeçalhos REAIS da Planilha1 (exemplo-planilha.xlsx), em ordem cronológica.
const ROTULOS = [
  '2TRI/25', 'JULHO', 'AGOSTO', 'SET/3TRI', 'OUTUBRO', 'NOVEMBRO', 'DEZ/4TRI',
  'JAN DE 2026', 'FEV DE 2026', 'MAR/1TRI 2026', 'ABR DE 2026', 'MAI DE 2026',
  'JUN/2TRI 2026', 'JUL DE 2026', 'AGO DE 2026', 'SET/3TRI 2026'
];
// Interpretação exigida: JUN/2025 … SET/2026 (nada além de SET/2026).
const MESES_ESPERADOS = [
  'JUN/2025', 'JUL/2025', 'AGO/2025', 'SET/2025', 'OUT/2025', 'NOV/2025', 'DEZ/2025',
  'JAN/2026', 'FEV/2026', 'MAR/2026', 'ABR/2026', 'MAI/2026',
  'JUN/2026', 'JUL/2026', 'AGO/2026', 'SET/2026'
];
const JANELA = [2024, 2028];
const AVALIACOES = [{ id: 'a1', ano: 2026, trimestre: 3 }];
const NA = 'Não informado';

/** Registro de um diretor com os 16 períodos; nível/status vazio viram NA. */
function registro(id, niveis, { avaliacaoId = 'a1', estagios } = {}){
  return {
    id,
    avaliacaoId,
    periodos: ROTULOS.map((rotulo, i) => ({
      rotulo,
      ordem: i,
      estagio: estagios ? estagios[i] : (niveis[i] === NA ? NA : 'Delegação II'),
      nivel: niveis[i]
    }))
  };
}
const cheio = v => ROTULOS.map(() => v);

test('parseMonthHeader: os 16 cabeçalhos reais viram mês/ano, sem datas inventadas', () => {
  const casos = [
    // [rótulo, mês, ano EXPLÍCITO no cabeçalho, trimestre?, nº do trimestre]
    ['2TRI/25', 6, 2025, true, 2],
    ['JULHO', 7, null, false, null],
    ['AGOSTO', 8, null, false, null],
    ['SET/3TRI', 9, null, true, 3],
    ['OUTUBRO', 10, null, false, null],
    ['NOVEMBRO', 11, null, false, null],
    ['DEZ/4TRI', 12, null, true, 4],
    ['JAN DE 2026', 1, 2026, false, null],
    ['FEV DE 2026', 2, 2026, false, null],
    ['MAR/1TRI 2026', 3, 2026, true, 1],
    ['ABR DE 2026', 4, 2026, false, null],
    ['MAI DE 2026', 5, 2026, false, null],
    ['JUN/2TRI 2026', 6, 2026, true, 2],
    ['JUL DE 2026', 7, 2026, false, null],
    ['AGO DE 2026', 8, 2026, false, null],
    ['SET/3TRI 2026', 9, 2026, true, 3]
  ];
  for(const [rotulo, mes, ano, trimestre, numero] of casos){
    const h = parseMonthHeader(rotulo, JANELA);
    assert.equal(h.isMonth, true, `${rotulo} deve ser reconhecido como mês`);
    assert.equal(h.month, mes, `${rotulo} mês`);
    assert.equal(h.year, ano, `${rotulo} ano explícito`);
    assert.equal(h.isQuarter, trimestre, `${rotulo} trimestre?`);
    assert.equal(h.quarter ?? null, numero, `${rotulo} nº do trimestre`);
  }
});

test('parseMonthHeader: datas da planilha (01/01/2026 …) reconhecidas como mês/ano', () => {
  const datas = [['01/01/2026', 1], ['01/02/2026', 2], ['01/04/2026', 4], ['01/05/2026', 5], ['01/07/2026', 7], ['01/08/2026', 8]];
  for(const [rotulo, mes] of datas){
    const h = parseMonthHeader(rotulo, JANELA);
    assert.equal(h.isMonth, true, `${rotulo} deve ser mês`);
    assert.equal(h.month, mes, `${rotulo} mês`);
    assert.equal(h.year, 2026, `${rotulo} ano`);
    assert.equal(h.isQuarter, false, `${rotulo} não é trimestre`);
  }
  assert.equal(parseMonthHeader('01/13/2026', JANELA).isMonth, false, 'mês 13 não existe');
  assert.equal(parseMonthHeader('STATUS DE GESTÃO', JANELA).isMonth, false, 'não é período');
  assert.equal(parseMonthHeader('', JANELA).isMonth, false);
  assert.equal(parseMonthHeader(null, JANELA).isMonth, false);
});

test('buildMonthlyLabelMap: 16 cabeçalhos → exatamente JUN/2025 … SET/2026', () => {
  const registros = [registro('r1', cheio('(II)'))];
  const { columns } = buildMonthlyLabelMap(registros, AVALIACOES);
  assert.deepEqual(columns.map(c => c.label), MESES_ESPERADOS);
  // Só meses/anos no formato MES/AAAA — nenhum "3º TRI/85", "4º TRI/85" ou data fora da planilha
  for(const c of columns){
    assert.match(c.label, /^(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/20\d{2}$/, c.label);
    assert.ok(c.year >= 2024 && c.year <= 2028, `ano plausível: ${c.label}`);
  }
  assert.equal(columns[columns.length - 1].label, 'SET/2026', 'termina no último período real');
  assert.ok(columns.every((c, i) => i === 0 || (c.year * 100 + c.month) > (columns[i - 1].year * 100 + columns[i - 1].month)), 'ordem cronológica');
});

test('buildMonthlyLabelMap: ano implausível nunca vira "/85" (inferido do vizinho)', () => {
  const periodos = [
    { rotulo: '2TRI/25', ordem: 0, estagio: 'Delegação I', nivel: '(V)' },
    { rotulo: 'JULHO', ordem: 1, estagio: 'Delegação I', nivel: '(V)' },
    { rotulo: '3TRI/85', ordem: 2, estagio: 'Delegação II', nivel: '(I)' },
    { rotulo: 'SET/3TRI 85', ordem: 3, estagio: 'Delegação II', nivel: '(I)' }
  ];
  const { columns } = buildMonthlyLabelMap([{ id: 'r1', avaliacaoId: 'a1', periodos }], AVALIACOES);
  assert.deepEqual(columns.map(c => c.label), ['JUN/2025', 'JUL/2025', 'SET/2025']);
  assert.ok(columns.every(c => !/\/85$/.test(c.label)), 'nenhum rótulo /85');
});

test('início individual: diretor que começa em MAI/2026 mostra só MAI/2026 … SET/2026', () => {
  const niveis = cheio(NA);
  for(let i = 11; i < 16; i++) niveis[i] = '(II)';
  const evo = buildDirectorMonthlyEvolution([registro('r1', niveis)], AVALIACOES, 'Diretor Teste');
  assert.ok(evo, 'gráfico deve existir para diretor com dado válido');
  assert.deepEqual(evo.periods.map(p => p.label), ['MAI/2026', 'JUN/2026', 'JUL/2026', 'AGO/2026', 'SET/2026']);
  assert.equal(evo.periods[evo.periods.length - 1].label, 'SET/2026');
  assert.deepEqual(evo.series, [{ key: 'diretor', rotulo: 'Diretor Teste', classe: 'sel', valores: [2, 2, 2, 2, 2] }]);
  assert.equal(evo.series.length, 1, 'apenas uma série');
});

test('início individual: troca de diretor atualiza o primeiro mês da linha', () => {
  const tarde = cheio(NA);
  for(let i = 11; i < 16; i++) tarde[i] = '(III)';
  const cedo = cheio('(IV)');
  const a = buildDirectorMonthlyEvolution([registro('r1', tarde)], AVALIACOES, 'Tarde');
  const b = buildDirectorMonthlyEvolution([registro('r2', cedo)], AVALIACOES, 'Cedo');
  assert.equal(a.periods[0].label, 'MAI/2026');
  assert.equal(b.periods[0].label, 'JUN/2025');
  assert.equal(a.series[0].rotulo, 'Tarde');
  assert.equal(b.series[0].rotulo, 'Cedo');
});

test('início individual: status válido já abre o gráfico (mesmo sem nível)', () => {
  const estagios = cheio('Delegação I');
  const niveis = cheio(NA);
  const evo = buildDirectorMonthlyEvolution([registro('r1', niveis, { estagios })], AVALIACOES, 'Só status');
  assert.equal(evo.periods[0].label, 'JUN/2025');
  assert.equal(evo.periods[0].status, 'Delegação I');
  assert.equal(evo.series[0].valores[0], null, 'sem nível → sem valor (nunca 0)');
});

test('lacuna posterior: mês no eixo, null no ponto e valor anterior não repetido', () => {
  const niveis = cheio(NA);
  niveis[11] = '(II)'; // MAI/2026
  niveis[12] = '(II)'; // JUN/2026
  niveis[13] = NA;     // JUL/2026 — lacuna
  niveis[14] = '(III)';// AGO/2026
  niveis[15] = '(II)'; // SET/2026
  const evo = buildDirectorMonthlyEvolution([registro('r1', niveis)], AVALIACOES, 'Com lacuna');
  assert.deepEqual(evo.periods.map(p => p.label), ['MAI/2026', 'JUN/2026', 'JUL/2026', 'AGO/2026', 'SET/2026']);
  assert.deepEqual(evo.series[0].valores, [2, 2, null, 3, 2]);
  const i = evo.series[0].valores.indexOf(null);
  assert.ok(i > 0, 'a lacuna vem depois do início');
  assert.equal(typeof evo.series[0].valores[i - 1], 'number', 'não repete o valor anterior');
  assert.notEqual(evo.series[0].valores[i], 0, 'lacuna nunca vira zero');
});

test('fechamentos trimestrais identificados com rótulo de trimestre', () => {
  const evo = buildDirectorMonthlyEvolution([registro('r1', cheio('(V)'))], AVALIACOES, 'Trimestres');
  const tri = evo.periods.filter(p => p.isQuarter);
  assert.deepEqual(tri.map(p => p.label), ['JUN/2025', 'SET/2025', 'DEZ/2025', 'MAR/2026', 'JUN/2026', 'SET/2026']);
  assert.deepEqual(tri.map(p => p.quarterLabel), [
    '2º trimestre de 2025', '3º trimestre de 2025', '4º trimestre de 2025',
    '1º trimestre de 2026', '2º trimestre de 2026', '3º trimestre de 2026'
  ]);
  assert.ok(evo.periods.filter(p => !p.isQuarter).every(p => p.quarterLabel == null), 'mês comum sem rótulo de trimestre');
  assert.equal(evo.periods.filter(p => p.label === 'SET/2026').length, 1, 'um único ponto para o fechamento');
});

test('níveis I–V convertem por correspondência exata; vazio/inválido → null', () => {
  const niveis = ['(I)', '(II)', '(III)', '(IV)', '(V)', NA, 'sem nível', 'VI', '(II)'];
  const rotulos = ['2TRI/25', 'JULHO', 'AGOSTO', 'SET/3TRI', 'OUTUBRO', 'NOVEMBRO', 'DEZ/4TRI', 'JAN DE 2026', 'FEV DE 2026'];
  const periodos = rotulos.map((rotulo, i) => ({ rotulo, ordem: i, estagio: 'Delegação II', nivel: niveis[i] }));
  const evo = buildDirectorMonthlyEvolution([{ id: 'r1', avaliacaoId: 'a1', periodos }], AVALIACOES, 'Níveis');
  assert.deepEqual(evo.series[0].valores, [1, 2, 3, 4, 5, null, null, null, 2]);
  assert.deepEqual(evo.periods.map(p => p.nivelRoman), [1, 2, 3, 4, 5, null, null, null, 2]);
});

test('diretor sem nenhum período válido → null (card fora do DOM, sem espaço vazio)', () => {
  assert.equal(buildDirectorMonthlyEvolution([registro('r1', cheio(NA))], AVALIACOES, 'Sem dado'), null);
  assert.equal(buildDirectorMonthlyEvolution([], AVALIACOES, 'Sem registros'), null);
});
