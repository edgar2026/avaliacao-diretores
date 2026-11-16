import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classificarNinebox,
  classificarRiscoDano,
  obterUltimoPeriodoValido,
  periodosClassificacaoDoDiretor,
  montarMatrizesClassificadas,
  indiceNinebox,
  indiceRiscoDano,
  normalizarStatus,
  normalizarNivel,
  nomeDiretorValido,
  ROTULO_AGUARDANDO,
  ORIGEM_AUTOMATICA
} from '../../src/services/classificacaoMatrizService.ts';

// ---------------------------------------------------------------------------
// NINEBOX — 9 casos obrigatórios
// ---------------------------------------------------------------------------

const CASOS_NINEBOX = [
  ['Delegação II', 'V', 'Alto', 'Acima do esperado', 'Alto Potencial'],
  ['Delegação I', 'IV', 'Alto', 'Esperado', 'Forte Desempenho superior'],
  ['Delegação I', 'II', 'Médio', 'Acima do esperado', 'Forte Desempenho do meio, canto direito'],
  ['Supervisão II', 'III', 'Alto', 'Abaixo do esperado', 'Diamante Bruto'],
  ['Gestão I', 'I', 'Baixo', 'Abaixo do esperado', 'Insuficiente'],
  ['Gestão I', 'V', 'Médio', 'Abaixo do esperado', 'Questionável'],
  ['Gestão II', 'V', 'Baixo', 'Acima do esperado', 'Comprometido'],
  ['Gestão II', 'I', 'Baixo', 'Esperado', 'Eficaz'],
  ['Gestão II', 'III', 'Médio', 'Esperado', 'Mantenedor']
];

test('ninebox: regras aprovadas (9 casos obrigatórios)', () => {
  for (const [status, nivel, potencial, desempenho, quadrante] of CASOS_NINEBOX) {
    const r = classificarNinebox(status, nivel);
    assert.equal(r.aplicavel, true, `${status} + Nível ${nivel}`);
    assert.equal(r.potencial, potencial, `${status} + Nível ${nivel} → potencial`);
    assert.equal(r.desempenho, desempenho, `${status} + Nível ${nivel} → desempenho`);
    assert.equal(r.quadrante, quadrante, `${status} + Nível ${nivel} → quadrante`);
    assert.equal(r.origem, ORIGEM_AUTOMATICA);
    assert.equal(r.referencia, `${status} · Nível ${nivel}`);
    assert.ok(indiceNinebox(r) !== null && indiceNinebox(r) >= 0 && indiceNinebox(r) < 9);
  }
});

test('ninebox: cobertura das demais combinações aprovadas', () => {
  assert.equal(classificarNinebox('Supervisão I', 'I').quadrante, 'Diamante Bruto');
  assert.equal(classificarNinebox('Delegação II', 'I').quadrante, 'Alto Potencial');
  assert.equal(classificarNinebox('Delegação I', 'III').quadrante, 'Forte Desempenho superior');
  assert.equal(classificarNinebox('Delegação I', 'I').quadrante, 'Forte Desempenho do meio, canto direito');
  assert.equal(classificarNinebox('Gestão I', 'II').quadrante, 'Insuficiente');
  assert.equal(classificarNinebox('Gestão I', 'IV').quadrante, 'Questionável');
  assert.equal(classificarNinebox('Gestão II', 'II').quadrante, 'Mantenedor');
  assert.equal(classificarNinebox('Gestão II', 'IV').quadrante, 'Comprometido');
});

test('ninebox: sem regra aprovada => "Aguardando classificação"', () => {
  for (const [status, nivel] of [
    ['Reposicionamento', 'III'],
    ['Gestão III', 'II'],
    ['Não informado', 'II'],
    ['Gestão I', null],
    ['Gestão I', 'Não informado'],
    ['Gestão I', 'X'],
    ['', 'II'],
    [null, 'II']
  ]) {
    const r = classificarNinebox(status, nivel);
    assert.equal(r.aplicavel, false, `${status} + ${nivel}`);
    assert.equal(r.quadrante, ROTULO_AGUARDANDO, `${status} + ${nivel}`);
    assert.equal(r.potencial, null);
    assert.equal(r.desempenho, null);
    assert.equal(r.referencia, null);
    assert.equal(r.origem, ORIGEM_AUTOMATICA);
    assert.equal(indiceNinebox(r), null);
  }
});

test('ninebox: Acompanhamento (não possui Nível) => "Insuficiente", nunca "Aguardando"', () => {
  for (const nivel of [null, 'Não informado', 'V', '(II)', undefined]) {
    const r = classificarNinebox('Acompanhamento', nivel);
    assert.equal(r.aplicavel, true, `Acompanhamento + ${nivel}`);
    assert.equal(r.potencial, 'Baixo', `Acompanhamento + ${nivel} → potencial`);
    assert.equal(r.desempenho, 'Abaixo do esperado', `Acompanhamento + ${nivel} → desempenho`);
    assert.equal(r.quadrante, 'Insuficiente', `Acompanhamento + ${nivel} → quadrante`);
    assert.equal(r.referencia, 'Acompanhamento', 'sem Nível na referência');
    assert.equal(indiceNinebox(r), 6, 'célula Insuficiente (índice 6)');
    assert.equal(r.origem, ORIGEM_AUTOMATICA);
    assert.notEqual(r.quadrante, ROTULO_AGUARDANDO);
  }
});

test('ninebox: normalização só para comparação (caixa, espaços, acentos, romanos)', () => {
  assert.equal(normalizarStatus('  Delegação   II '), 'delegacao ii');
  assert.equal(normalizarStatus('GESTAO II'), 'gestao ii');
  assert.equal(normalizarStatus('Não informado'), null);
  assert.equal(normalizarNivel('(iii)'), 3);
  assert.equal(normalizarNivel(' IV '), 4);
  assert.equal(normalizarNivel(5), 5);
  assert.equal(normalizarNivel('VII'), null);

  assert.equal(classificarNinebox('  gestão   ii ', 'v').quadrante, 'Comprometido');
  assert.equal(classificarNinebox('GESTAO II', 'IV').quadrante, 'Comprometido');
  assert.equal(classificarNinebox('Delegacao I', '(IV)').quadrante, 'Forte Desempenho superior');
  // Nunca confunde I × II nem IV × V
  assert.equal(classificarNinebox('Gestão I', 'IV').quadrante, 'Questionável');
  assert.equal(classificarNinebox('Gestão II', 'IV').quadrante, 'Comprometido');
  assert.equal(classificarNinebox('Delegação I', 'IV').quadrante, 'Forte Desempenho superior');
  assert.equal(classificarNinebox('Delegação I', 'V').quadrante, 'Forte Desempenho superior');
  assert.equal(classificarNinebox('Delegação II', 'IV').quadrante, 'Alto Potencial');
});

// ---------------------------------------------------------------------------
// RISCO × DANO — 16 células oficiais
// ---------------------------------------------------------------------------

const CASOS_RISCO = [
  ['Delegação II', 'IV', 'Baixo', 'Baixo'],
  ['Delegação II', 'III', 'Baixo', 'Médio'],
  ['Delegação II', 'I', 'Baixo', 'Alto'],
  ['Delegação II', 'II', 'Baixo', 'Alto'],
  ['Delegação I', 'IV', 'Baixo', 'Altíssimo'],
  ['Delegação I', 'V', 'Baixo', 'Altíssimo'],
  ['Delegação I', 'III', 'Médio', 'Baixo'],
  ['Delegação I', 'II', 'Médio', 'Médio'],
  ['Delegação I', 'I', 'Médio', 'Alto'],
  ['Gestão II', 'IV', 'Médio', 'Altíssimo'],
  ['Gestão II', 'V', 'Médio', 'Altíssimo'],
  ['Gestão II', 'III', 'Alto', 'Baixo'],
  ['Gestão II', 'II', 'Alto', 'Médio'],
  ['Gestão II', 'I', 'Alto', 'Alto'],
  ['Gestão I', 'IV', 'Alto', 'Altíssimo'],
  ['Gestão I', 'V', 'Alto', 'Altíssimo'],
  ['Gestão I', 'III', 'Altíssimo', 'Baixo'],
  ['Gestão I', 'II', 'Altíssimo', 'Médio'],
  ['Gestão I', 'I', 'Altíssimo', 'Alto'],
  ['Acompanhamento', 'III', 'Altíssimo', 'Altíssimo'],
  ['Acompanhamento', null, 'Altíssimo', 'Altíssimo']
];

const EIXO_RISCO = ['Altíssimo', 'Alto', 'Médio', 'Baixo'];
const EIXO_DANO = ['Baixo', 'Médio', 'Alto', 'Altíssimo'];

test('risco × dano: 16 células oficiais (Risco nunca invertido com Dano)', () => {
  const celulas = new Set();
  for (const [status, nivel, risco, dano] of CASOS_RISCO) {
    const r = classificarRiscoDano(status, nivel);
    assert.equal(r.aplicavel, true, `${status} + Nível ${nivel}`);
    assert.equal(r.risco, risco, `${status} + Nível ${nivel} → risco`);
    assert.equal(r.dano, dano, `${status} + Nível ${nivel} → dano`);
    assert.equal(r.celula, `Risco ${risco} • Dano ${dano}`);
    assert.equal(r.origem, ORIGEM_AUTOMATICA);
    const esperado = EIXO_RISCO.indexOf(risco) * 4 + EIXO_DANO.indexOf(dano);
    assert.equal(r.indice, esperado, `${status} + Nível ${nivel} → índice da grade`);
    assert.equal(indiceRiscoDano(r), esperado);
    celulas.add(esperado);
  }
  assert.equal(celulas.size, 16, 'as 16 células oficiais são alcançadas');
});

test('risco × dano: sem regra aprovada => "Aguardando classificação"', () => {
  for (const [status, nivel] of [
    ['Reposicionamento', 'II'],
    ['Gestão III', 'II'],
    ['Não informado', 'II'],
    ['Delegação I', null],
    ['Delegação I', 'Não informado'],
    ['', 'II'],
    [null, null]
  ]) {
    const r = classificarRiscoDano(status, nivel);
    assert.equal(r.aplicavel, false, `${status} + ${nivel}`);
    assert.equal(r.celula, ROTULO_AGUARDANDO, `${status} + ${nivel}`);
    assert.equal(r.risco, null);
    assert.equal(r.dano, null);
    assert.equal(r.indice, null);
    assert.equal(r.referencia, null);
  }
});

// ---------------------------------------------------------------------------
// ÚLTIMO PERÍODO VÁLIDO
// ---------------------------------------------------------------------------

const periodo = (o) => ({ ajustado: false, origem: 'planilha', ordemAvaliacao: 0, ...o });

test('último período: Status e Nível vêm do MESMO período (nunca se mistura)', () => {
  const p = obterUltimoPeriodoValido([
    periodo({ id: 'p1', rotulo: 'JAN/2026', ordem: 1, tempo: { ano: 2026, mes: 1 }, status: 'Delegação I', nivel: '(III)', nivelRoman: 3 }),
    periodo({ id: 'p2', rotulo: 'FEV/2026', ordem: 2, tempo: { ano: 2026, mes: 2 }, status: 'Gestão I', nivel: '(I)', nivelRoman: 1 })
  ]);
  assert.equal(p.rotulo, 'FEV/2026');
  assert.equal(p.status, 'Gestão I');
  assert.equal(p.nivel, '(I)');
  assert.equal(p.nivelRoman, 1);
  assert.equal(p.origem, 'planilha');
  assert.equal(p.periodoId, 'p2');
});

test('último período: pula período sem Nível válido e usa o anterior inteiro', () => {
  const p = obterUltimoPeriodoValido([
    periodo({ id: 'p1', rotulo: 'JAN/2026', ordem: 1, tempo: { ano: 2026, mes: 1 }, status: 'Delegação I', nivel: '(V)', nivelRoman: 5 }),
    periodo({ id: 'p2', rotulo: 'FEV/2026', ordem: 2, tempo: { ano: 2026, mes: 2 }, status: 'Gestão II', nivel: null, nivelRoman: null })
  ]);
  assert.equal(p.periodoId, 'p1');
  assert.equal(p.status, 'Delegação I', 'status do MESMO período anterior');
  assert.equal(p.nivel, '(V)', 'nível do MESMO período anterior');
});

test('último período: pula período sem Status válido', () => {
  const p = obterUltimoPeriodoValido([
    periodo({ id: 'p1', rotulo: 'JAN/2026', ordem: 1, tempo: { ano: 2026, mes: 1 }, status: 'Gestão I', nivel: '(II)', nivelRoman: 2 }),
    periodo({ id: 'p2', rotulo: 'FEV/2026', ordem: 2, tempo: { ano: 2026, mes: 2 }, status: 'Não informado', nivel: '(IV)', nivelRoman: 4 })
  ]);
  assert.equal(p.periodoId, 'p1');
  assert.equal(p.status, 'Gestão I');
  assert.equal(p.nivel, '(II)');
});

test('último período: prioridade ajuste manual > cadastro manual > importado (mesmo mês)', () => {
  // Ajuste manual vigente decide o valor do mês (mesmo quando é "Não informado").
  const comAjuste = obterUltimoPeriodoValido([
    periodo({ id: 'p1', rotulo: 'JAN/2026', ordem: 1, tempo: { ano: 2026, mes: 1 }, status: 'Delegação II', nivel: '(V)', nivelRoman: 5 }),
    periodo({ id: 'p2', rotulo: 'JAN/2026', ordem: 1, tempo: { ano: 2026, mes: 1 }, status: 'Não informado', nivel: 'Não informado', nivelRoman: null, ajustado: true }),
    periodo({ id: 'p0', rotulo: 'DEZ/2025', ordem: 0, tempo: { ano: 2025, mes: 12 }, status: 'Gestão I', nivel: '(II)', nivelRoman: 2 })
  ]);
  assert.equal(comAjuste.periodoId, 'p0', 'mês ajustado para "Não informado" não vale o importado');
  assert.equal(comAjuste.status, 'Gestão I');

  const ajusteValido = obterUltimoPeriodoValido([
    periodo({ id: 'p1', rotulo: 'JAN/2026', ordem: 1, tempo: { ano: 2026, mes: 1 }, status: 'Delegação II', nivel: '(V)', nivelRoman: 5 }),
    periodo({ id: 'p2', rotulo: 'JAN/2026', ordem: 1, tempo: { ano: 2026, mes: 1 }, status: 'Gestão II', nivel: '(I)', nivelRoman: 1, ajustado: true }),
    periodo({ id: 'p3', rotulo: 'JAN/2026', ordem: 1, tempo: { ano: 2026, mes: 1 }, status: 'Delegação I', nivel: '(IV)', nivelRoman: 4, origem: 'cadastro_manual' })
  ]);
  assert.equal(ajusteValido.periodoId, 'p2', 'ajuste manual vence cadastro manual e importado');
  assert.equal(ajusteValido.origem, 'ajuste_manual');
  assert.equal(ajusteValido.status, 'Gestão II');

  const cadastro = obterUltimoPeriodoValido([
    periodo({ id: 'p1', rotulo: 'JAN/2026', ordem: 1, tempo: { ano: 2026, mes: 1 }, status: 'Delegação II', nivel: '(V)', nivelRoman: 5 }),
    periodo({ id: 'p3', rotulo: 'JAN/2026', ordem: 1, tempo: { ano: 2026, mes: 1 }, status: 'Delegação I', nivel: '(IV)', nivelRoman: 4, origem: 'cadastro_manual' })
  ]);
  assert.equal(cadastro.periodoId, 'p3', 'cadastro manual vence valor importado');
  assert.equal(cadastro.origem, 'cadastro_manual');
});

test('último período: cronologia real (mês/ano) ignora ordem gravada trocada', () => {
  const p = obterUltimoPeriodoValido([
    periodo({ id: 'novo', rotulo: 'DEZ/2025', ordem: 9, tempo: { ano: 2025, mes: 12 }, status: 'Gestão I', nivel: '(II)', nivelRoman: 2 }),
    periodo({ id: 'antigo', rotulo: 'JAN/2026', ordem: 1, tempo: { ano: 2026, mes: 1 }, status: 'Delegação II', nivel: '(V)', nivelRoman: 5 })
  ]);
  assert.equal(p.periodoId, 'antigo', 'JAN/2026 é mais recente que DEZ/2025');
});

test('último período: fallback por (avaliação, ordem) quando o rótulo não vira mês', () => {
  const p = obterUltimoPeriodoValido([
    periodo({ id: 'p1', rotulo: 'X', ordem: 1, ordemAvaliacao: 0, tempo: null, status: 'Gestão I', nivel: '(II)', nivelRoman: 2 }),
    periodo({ id: 'p2', rotulo: 'Y', ordem: 2, ordemAvaliacao: 0, tempo: null, status: 'Delegação II', nivel: '(V)', nivelRoman: 5 }),
    periodo({ id: 'p3', rotulo: 'Z', ordem: 1, ordemAvaliacao: 1, tempo: null, status: 'Gestão II', nivel: '(I)', nivelRoman: 1 })
  ]);
  assert.equal(p.periodoId, 'p3', 'avaliação mais recente primeiro');
});

test('último período: null quando não há período com Status E Nível válidos', () => {
  assert.equal(obterUltimoPeriodoValido([]), null);
  assert.equal(obterUltimoPeriodoValido(null), null);
  assert.equal(obterUltimoPeriodoValido([periodo({ status: null, nivel: null })]), null);
  assert.equal(
    obterUltimoPeriodoValido([
      periodo({ id: 'p1', tempo: { ano: 2026, mes: 1 }, status: null, nivel: '(V)', nivelRoman: 5 }),
      periodo({ id: 'p2', tempo: { ano: 2026, mes: 2 }, status: 'Gestão I', nivel: null, nivelRoman: null })
    ]),
    null
  );
});

// ---------------------------------------------------------------------------
// DISTRIBUIÇÃO AUTOMÁTICA NAS DUAS MATRIZES
// ---------------------------------------------------------------------------

const AVALIACOES = [{ id: 'a1', ano: 2026, trimestre: 1 }];

const REGISTROS = [
  {
    id: 'r1', avaliacaoId: 'a1', diretor: 'ANA SILVA', unidade: 'Recife', arquivado: false,
    periodos: [
      { id: 'p1', rotulo: 'JULHO', ordem: 1, estagio: 'Delegação I', nivel: '(III)', nivelRoman: 3, ajustado: false, origem: 'planilha' },
      { id: 'p2', rotulo: 'AGOSTO', ordem: 2, estagio: 'Delegação II', nivel: '(V)', nivelRoman: 5, ajustado: false, origem: 'planilha' }
    ]
  },
  {
    id: 'r2', avaliacaoId: 'a1', diretor: 'BIA LIMA', unidade: 'Olinda', arquivado: false,
    periodos: [
      { id: 'p3', rotulo: 'AGOSTO', ordem: 1, estagio: 'Acompanhamento', nivel: '(II)', nivelRoman: 2, ajustado: false, origem: 'planilha' }
    ]
  },
  {
    id: 'r3', avaliacaoId: 'a1', diretor: 'CAIO SOUZA', unidade: 'Paulista', arquivado: false,
    periodos: []
  }
];

const DIRETORES = [
  { id: 'r1', name: 'ANA SILVA', unit: 'Recife' },
  { id: 'r2', name: 'BIA LIMA', unit: 'Olinda' },
  { id: 'r3', name: 'CAIO SOUZA', unit: 'Paulista' }
];

test('distribuição: cada diretor aparece UMA única vez em cada matriz', () => {
  const r = montarMatrizesClassificadas(DIRETORES, REGISTROS, AVALIACOES);

  const nineboxTodos = r.ninebox.flat().concat(r.aguardandoNinebox);
  const riskTodos = r.risk.flat().concat(r.aguardandoRisco);
  assert.equal(nineboxTodos.length, DIRETORES.length);
  assert.equal(riskTodos.length, DIRETORES.length);
  assert.equal(new Set(nineboxTodos.map((d) => d.id)).size, DIRETORES.length);
  assert.equal(new Set(riskTodos.map((d) => d.id)).size, DIRETORES.length);
  assert.equal(nineboxTodos.length, new Set(nineboxTodos.map((d) => d.id)).size, 'ninebox sem duplicata');
  assert.equal(riskTodos.length, new Set(riskTodos.map((d) => d.id)).size, 'risco sem duplicata');
});

test('distribuição: último período válido define a célula das duas matrizes', () => {
  const r = montarMatrizesClassificadas(DIRETORES, REGISTROS, AVALIACOES);

  // ANA: último período = AGOSTO (Delegação II / V) → Alto Potencial + Risco Baixo × Dano Baixo
  assert.equal(r.ninebox[2].map((d) => d.name).join(), 'ANA SILVA');
  assert.equal(indiceNinebox(r.detalhes.get('ana silva').ninebox), 2);
  assert.equal(r.risk[12].map((d) => d.name).join(), 'ANA SILVA');
  assert.equal(r.detalhes.get('ana silva').periodo.rotulo, 'AGOSTO');
  assert.equal(r.detalhes.get('ana silva').periodo.status, 'Delegação II');

  // BIA: Acompanhamento => ninebox Insuficiente (índice 6); risco = Altíssimo × Altíssimo (índice 3)
  assert.equal(r.ninebox[6].map((d) => d.name).join(), 'BIA LIMA');
  assert.equal(indiceNinebox(r.detalhes.get('bia lima').ninebox), 6);
  assert.equal(r.aguardandoNinebox.some((d) => d.name === 'BIA LIMA'), false, 'BIA não fica em "Aguardando"');
  assert.equal(r.risk[3].map((d) => d.name).join(), 'BIA LIMA');
  assert.equal(r.aguardandoRisco.some((d) => d.name === 'BIA LIMA'), false, 'BIA tem célula no risco');

  // CAIO: sem período → aguardando nas DUAS matrizes
  assert.equal(r.aguardandoNinebox.map((d) => d.name).includes('CAIO SOUZA'), true);
  assert.equal(r.aguardandoRisco.map((d) => d.name).includes('CAIO SOUZA'), true);
  assert.equal(r.detalhes.get('caio souza').periodo, null);
});

test('distribuição: Acompanhamento SEM Nível => UMA ocorrência por matriz (Insuficiente / Altíssimo × Altíssimo)', () => {
  const registros = [
    {
      id: 'r8', avaliacaoId: 'a1', diretor: 'DIOGO MATOS', unidade: 'Sede', arquivado: false,
      periodos: [
        { id: 'pa1', rotulo: 'JULHO', ordem: 1, estagio: 'Gestão I', nivel: '(III)', nivelRoman: 3, ajustado: false, origem: 'planilha' },
        // Forma real do banco: Acompanhamento sem Nível ("Não informado").
        { id: 'pa2', rotulo: 'AGOSTO', ordem: 2, estagio: 'Acompanhamento', nivel: 'Não informado', nivelRoman: null, ajustado: false, origem: 'planilha' }
      ]
    }
  ];
  const diretores = [{ id: 'r8', name: 'DIOGO MATOS', unit: 'Sede' }];
  const r = montarMatrizesClassificadas(diretores, registros, AVALIACOES);

  const det = r.detalhes.get('diogo matos');
  assert.equal(det.periodo.status, 'Acompanhamento', 'período sem Nível é válido');
  assert.equal(det.ninebox.quadrante, 'Insuficiente');
  assert.equal(indiceNinebox(det.ninebox), 6, 'ninebox: Insuficiente');
  assert.equal(det.risco.celula, 'Risco Altíssimo • Dano Altíssimo');
  assert.equal(indiceRiscoDano(det.risco), 3, 'risco × dano: Altíssimo × Altíssimo');

  // UMA única ocorrência em cada matriz, fora de "Aguardando classificação".
  const nineboxOcorrencias =
    r.ninebox.flat().filter((d) => d.name === 'DIOGO MATOS').length +
    r.aguardandoNinebox.filter((d) => d.name === 'DIOGO MATOS').length;
  const riscoOcorrencias =
    r.risk.flat().filter((d) => d.name === 'DIOGO MATOS').length +
    r.aguardandoRisco.filter((d) => d.name === 'DIOGO MATOS').length;
  assert.equal(nineboxOcorrencias, 1, 'ninebox: aparece uma única vez');
  assert.equal(riscoOcorrencias, 1, 'risco × dano: aparece uma única vez');
  assert.equal(r.ninebox[6].some((d) => d.name === 'DIOGO MATOS'), true);
  assert.equal(r.risk[3].some((d) => d.name === 'DIOGO MATOS'), true);
  assert.equal(r.aguardandoNinebox.length, 0, 'nada em "Aguardando classificação" (ninebox)');
  assert.equal(r.aguardandoRisco.length, 0, 'nada em "Aguardando classificação" (risco)');
});

test('distribuição: registros arquivados e diretor sem registros não geram classe', () => {
  const registros = [
    {
      id: 'r9', avaliacaoId: 'a1', diretor: 'DUDA REIS', unidade: 'Recife', arquivado: true,
      periodos: [{ id: 'p9', rotulo: 'AGOSTO', ordem: 1, estagio: 'Delegação II', nivel: '(V)', nivelRoman: 5, ajustado: false, origem: 'planilha' }]
    }
  ];
  const r = montarMatrizesClassificadas(
    [{ id: 'r9', name: 'DUDA REIS', unit: 'Recife' }, { id: 'x', name: 'FORA DA LISTA', unit: '—' }],
    registros,
    AVALIACOES
  );
  assert.equal(r.ninebox.flat().length, 0);
  assert.equal(r.risk.flat().length, 0);
  assert.equal(r.aguardandoNinebox.length, 2, 'arquivado sem período válido e diretor sem registros');
  assert.equal(r.aguardandoRisco.length, 2);
});

test('distribuição: período criado por cadastro manual alimenta o motor', () => {
  const registros = [
    {
      id: 'r1', avaliacaoId: 'a1', diretor: 'ANA SILVA', unidade: 'Recife', arquivado: false,
      periodos: [
        { id: 'p1', rotulo: 'JULHO', ordem: 1, estagio: 'Delegação I', nivel: '(III)', nivelRoman: 3, ajustado: false, origem: 'planilha' },
        { id: 'p2', rotulo: 'OUT/2026', ordem: 2, estagio: 'Gestão II', nivel: '(I)', nivelRoman: 1, ajustado: false, origem: 'cadastro_manual' }
      ]
    }
  ];
  const r = montarMatrizesClassificadas([{ id: 'r1', name: 'ANA SILVA', unit: 'Recife' }], registros, AVALIACOES);
  const detalhe = r.detalhes.get('ana silva');
  assert.equal(detalhe.periodo.origem, 'cadastro_manual');
  assert.equal(detalhe.periodo.rotulo, 'OUT/2026');
  assert.equal(detalhe.ninebox.quadrante, 'Eficaz');
  assert.equal(indiceRiscoDano(detalhe.risco), 6, 'Gestão II Nível I → Risco Alto × Dano Alto');
});

test('períodos do diretor: monta entradas com mês/ano e valores vigentes', () => {
  const entradas = periodosClassificacaoDoDiretor(REGISTROS, AVALIACOES);
  assert.equal(entradas.length, 3);
  const ana = entradas.filter((e) => e.registroId === 'r1');
  assert.equal(ana.length, 2);
  assert.deepEqual(ana.map((e) => e.tempo), [{ ano: 2026, mes: 7 }, { ano: 2026, mes: 8 }]);
  assert.equal(ana[1].status, 'Delegação II');
  assert.equal(ana[1].nivelRoman, 5);
  assert.equal(ana[1].origem, 'planilha');
  assert.equal(ana[1].ordemAvaliacao, 0);
});

// ---------------------------------------------------------------------------
// SELEÇÃO DOS DIRETORES: última avaliação válida individual + nome válido
// ---------------------------------------------------------------------------

test('nomeDiretorValido: ignora "Diretor não informado", vazio e só espaços', () => {
  assert.equal(nomeDiretorValido('ANA SILVA'), true);
  assert.equal(nomeDiretorValido('  ANA   SILVA '), true);
  assert.equal(nomeDiretorValido('Diretor não informado'), false);
  assert.equal(nomeDiretorValido('  DIRETOR NAO INFORMADO  '), false, 'caixa/acentos/espaços normalizados');
  assert.equal(nomeDiretorValido('diretor  não informado'), false);
  assert.equal(nomeDiretorValido(''), false);
  assert.equal(nomeDiretorValido('   '), false);
  assert.equal(nomeDiretorValido(null), false);
  assert.equal(nomeDiretorValido(undefined), false);
  assert.equal(nomeDiretorValido('Diretor não informado Jr'), true, 'nome parecido mas diferente segue válido');
});

test('seleção: diretor sem avaliação no período mais recente usa a última avaliação válida do PRÓPRIO diretor', () => {
  // Período geral mais recente: SET/2026 — RITA não tem avaliação em SET.
  const registros = [
    {
      id: 'r1', avaliacaoId: 'a1', diretor: 'RITA COSTA', unidade: 'Sede', arquivado: false,
      periodos: [
        { id: 'p1', rotulo: 'MAI/2TRI 2026', ordem: 1, estagio: 'Delegação II', nivel: '(V)', nivelRoman: 5, ajustado: false, origem: 'planilha' },
        { id: 'p2', rotulo: 'JUN/2TRI 2026', ordem: 2, estagio: 'Gestão II', nivel: '(III)', nivelRoman: 3, ajustado: false, origem: 'planilha' }
        // sem períodos em SET/2026 — não cria avaliação fictícia
      ]
    }
  ];
  const r = montarMatrizesClassificadas([{ id: 'r1', name: 'RITA COSTA', unit: 'Sede' }], registros, AVALIACOES);

  const det = r.detalhes.get('rita costa');
  assert.equal(det.periodo.rotulo, 'JUN/2TRI 2026', 'usa o último período anterior válido');
  assert.equal(det.periodo.status, 'Gestão II');
  assert.equal(det.periodo.nivel, '(III)', 'Status e Nível do MESMO período');
  assert.equal(indiceNinebox(det.ninebox), 4, 'Gestão II + III => Mantenedor');
  assert.equal(indiceRiscoDano(det.risco), 4, 'Gestão II + III => Risco Alto × Dano Baixo');
  assert.equal(r.ninebox[4].map((d) => d.name).join(), 'RITA COSTA', 'no quadrante, não em "Aguardando"');
  assert.equal(r.risk[4].map((d) => d.name).join(), 'RITA COSTA');
  assert.equal(r.aguardandoNinebox.length, 0);
  assert.equal(r.aguardandoRisco.length, 0);
});

test('seleção: "Diretor não informado" não entra em células, contagens nem "Aguardando"', () => {
  const registros = [
    {
      id: 'r1', avaliacaoId: 'a1', diretor: 'ANA SILVA', unidade: 'U1', arquivado: false,
      periodos: [{ id: 'p1', rotulo: 'AGOSTO', ordem: 1, estagio: 'Gestão I', nivel: '(III)', nivelRoman: 3, ajustado: false, origem: 'planilha' }]
    },
    {
      id: 'r2', avaliacaoId: 'a1', diretor: 'Diretor não informado', unidade: 'U1', arquivado: false,
      periodos: [{ id: 'p2', rotulo: 'AGOSTO', ordem: 1, estagio: 'Gestão II', nivel: '(I)', nivelRoman: 1, ajustado: false, origem: 'planilha' }]
    },
    { id: 'r3', avaliacaoId: 'a1', diretor: '   ', unidade: 'U1', arquivado: false, periodos: [] },
    {
      id: 'r4', avaliacaoId: 'a1', diretor: 'BRUNO LIMA', unidade: 'U2', arquivado: false,
      periodos: [{ id: 'p3', rotulo: 'AGOSTO', ordem: 1, estagio: 'Reposicionamento', nivel: '(II)', nivelRoman: 2, ajustado: false, origem: 'planilha' }]
    }
  ];
  const diretores = [
    { id: 'r1', name: 'ANA SILVA', unit: 'U1' },
    { id: 'r2', name: 'Diretor não informado', unit: 'U1' },
    { id: 'r3', name: '   ', unit: 'U1' },
    { id: 'r4', name: 'BRUNO LIMA', unit: 'U2' }
  ];
  const r = montarMatrizesClassificadas(diretores, registros, AVALIACOES);

  // Novebox: ANA classificada, BRUNO aguardando — inválidos fora de tudo.
  const nineTodos = [...r.ninebox.flat(), ...r.aguardandoNinebox];
  assert.equal(nineTodos.length, 2, 'apenas os dois diretores reais (sem inválidos, sem duplicatas)');
  assert.ok(nineTodos.every((d) => nomeDiretorValido(d.name)));
  assert.equal(r.aguardandoNinebox.map((d) => d.name).join(','), 'BRUNO LIMA', 'aguardando: só o diretor real sem regra');

  // Risco × Dano: mesma seleção (independência das duas matrizes).
  const riskTodos = [...r.risk.flat(), ...r.aguardandoRisco];
  assert.equal(riskTodos.length, 2, 'apenas os dois diretores reais');
  assert.ok(riskTodos.every((d) => nomeDiretorValido(d.name)));
  assert.equal(r.aguardandoRisco.map((d) => d.name).join(','), 'BRUNO LIMA');

  // Nenhum registro inválido vira foto/quadrante/contagem.
  assert.equal(r.ninebox.flat().filter((d) => !nomeDiretorValido(d.name)).length, 0);
  assert.equal(r.risk.flat().filter((d) => !nomeDiretorValido(d.name)).length, 0);
  assert.equal(r.detalhes.has('diretor nao informado'), false, 'sem detalhe para o registro inválido');
});
