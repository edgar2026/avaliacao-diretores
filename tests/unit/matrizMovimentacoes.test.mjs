// Testes da POSIÇÃO MANUAL das matrizes (Ninebox e Risco × Dano) com
// VIGÊNCIA POR PERÍODO — a Parte 2 implementa somente a camada manual; as
// regras AUTOMÁTICas aprovadas (classificacaoMatrizService) continuam intactas
// e são exercitadas aqui apenas como entrada/saída esperadas.
//
// Cenários cobertos (validação do texto da Parte 2):
//  1. diretor nasce na posição automática;
//  2. movimentação manual altera a posição vigente;
//  3. "atualizar a página" (reler tudo) mantém a manual;
//  4. trocar filtros mantém a manual;
//  5. reimportar/reler o MESMO período mantém a manual;
//  6. alterar Status/Nível do mesmo período recalcula SÓ a automática;
//  7. a manual continua vigente no mesmo período;
//  8. novo período por planilha encerra a vigência anterior;
//  9. novo período por cadastro manual também encerra;
// 10. a automática do novo período passa a valer;
// 11. o histórico anterior permanece (nada é apagado);
// 12. as duas matrizes permanecem independentes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  montarReferenciasPeriodo,
  movimentoVigente,
  mesmoPeriodo,
  motivoEncerramento,
  aplicarMovimentos,
  marcarOrigens,
  prepararMovimentacaoMatriz,
  posicaoAutomaticaDoDiretor,
  MOTIVO_NOVO_PERIODO,
  MOTIVO_SUBSTITUIDA
} from '../../src/services/matrizMovimentacoesService.ts';
import {
  montarMatrizesClassificadas,
  indiceNinebox,
  indiceRiscoDano,
  normalizarChave
} from '../../src/services/classificacaoMatrizService.ts';

// ---------------------------------------------------------------------------
// Fixtures (mesmo formato do modelo em memória)
// ---------------------------------------------------------------------------

const AVALIACOES = [{ id: 'a1' }, { id: 'a2' }];
const DIRETORES = [{ id: 'd1', name: 'ANA SILVA', unit: 'U1' }];

const ROTULOS_NINEBOX = [
  'DIAMANTE BRUTO', 'FORTE DESEMPENHO', 'ALTO POTENCIAL',
  'QUESTIONÁVEL', 'MANTENEDOR', 'FORTE DESEMPENHO',
  'INSUFICIENTE', 'EFICAZ', 'COMPROMETIDO'
];
const RISCO_Y = ['Altíssimo', 'Alto', 'Médio', 'Baixo'];
const DANO_X = ['Baixo', 'Médio', 'Alto', 'Altíssimo'];

// Rótulo de célula no MESMO formato aprovado usado pelo componente.
function rotuloCelula(matriz, index) {
  if (matriz === 'ninebox') return ROTULOS_NINEBOX[index] || '';
  return `Risco ${RISCO_Y[Math.floor(index / 4)]} • Dano ${DANO_X[index % 4]}`;
}

function periodo({ id, rotulo, ordem, estagio, nivel, origem = 'planilha', ajustado = false }) {
  const romano = { I: 1, II: 2, III: 3, IV: 4, V: 5 }[String(nivel || '').replace(/[()\s]/g, '')] || null;
  return {
    id,
    rotulo,
    ordem,
    estagio,
    nivel: nivel ? `(${String(nivel).replace(/[()\s]/g, '')})` : null,
    nivelRoman: romano,
    estagioOriginal: estagio,
    nivelOriginal: romano,
    ajustado,
    origem
  };
}

function registro({ id, diretor, avaliacaoId = 'a1', regional = 'R1', periodos = [], arquivado = false }) {
  return {
    id,
    avaliacaoId,
    avaliacaoLabel: `${avaliacaoId}`,
    codigoRegional: null,
    regional,
    diretor,
    unidade: 'U1',
    statusGestao: null,
    cicloVida: null,
    nivelAtual: null,
    nivelRoman: null,
    arquivado,
    metricas: {},
    metricasImportado: {},
    metricasInfo: {},
    indicadores: [],
    periodos
  };
}

// ANA: JUL/2026 (Gestão I · III) e SET/3TRI 2026 (Gestão I · III).
// Último período válido = SET/2026 -> automática = Questionável (índice 3).
function anaComSetembro(extra = []) {
  return registro({
    id: 'r1',
    diretor: 'ANA SILVA',
    periodos: [
      periodo({ id: 'p-jul', rotulo: 'JUL/3TRI 2026', ordem: 1, estagio: 'Gestão I', nivel: 'III' }),
      periodo({ id: 'p-set', rotulo: 'SET/3TRI 2026', ordem: 2, estagio: 'Gestão I', nivel: 'III' }),
      ...extra
    ]
  });
}

// Linha de movimentação manual "vinda do banco" (ativa por padrão).
function mov(parcial = {}) {
  const diretor = parcial.diretor || 'ANA SILVA';
  return {
    id: parcial.id || 'm1',
    avaliacao_id: 'a1',
    registro_id: parcial.registro_id || 'r1',
    periodo_id: parcial.periodo_id ?? 'p-set',
    matriz: parcial.matriz || 'ninebox',
    diretor,
    diretor_chave: normalizarChave(diretor),
    referencia: parcial.referencia ?? 'SET/3TRI 2026 · Valor importado',
    periodo_ano: parcial.periodo_ano === undefined ? 2026 : parcial.periodo_ano,
    periodo_mes: parcial.periodo_mes === undefined ? 9 : parcial.periodo_mes,
    status_usado: parcial.status_usado ?? 'Gestão I',
    nivel_usado: parcial.nivel_usado ?? '(III)',
    posicao_automatica: parcial.posicao_automatica ?? 3,
    posicao_anterior: parcial.posicao_anterior ?? 3,
    posicao_manual: parcial.posicao_manual ?? 5,
    origem: 'manual',
    encerrado_motivo: parcial.encerrado_motivo ?? null,
    arquivada_em: parcial.arquivada_em ?? null,
    created_at: '2026-09-30T12:00:00Z',
    updated_at: '2026-09-30T12:00:00Z'
  };
}

const chaveAna = normalizarChave('ANA SILVA');

function classificar(registros) {
  return montarMatrizesClassificadas(DIRETORES, registros, AVALIACOES);
}

function celulaDe(celulas, nome) {
  const k = normalizarChave(nome);
  return celulas.findIndex((c) => c.some((p) => normalizarChave(p.name) === k));
}

function exibir(registros, movimentos, opts = {}) {
  const c = classificar(opts.filtrados || registros);
  // A vigência usa SEMPRE a base completa (filtro lateral nunca participa).
  const refs = montarReferenciasPeriodo(registros, AVALIACOES);
  const dados = aplicarMovimentos(c.ninebox, c.risk, movimentos, refs);
  const ninebox = marcarOrigens(dados.ninebox, 'ninebox', movimentos, refs, c.detalhes, opts.rotulo || rotuloCelula);
  const risk = marcarOrigens(dados.risk, 'risk', movimentos, refs, c.detalhes, opts.rotulo || rotuloCelula);
  return { classificada: c, refs, dados, ninebox, risk };
}

function origemDe(celulas, nome) {
  const k = normalizarChave(nome);
  for (const cel of celulas) {
    const p = cel.find((x) => normalizarChave(x.name) === k);
    if (p) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1) Diretor inicialmente aparece na posição automática
// ---------------------------------------------------------------------------

test('1) sem movimentação o diretor aparece na posição automática e como "Automática"', () => {
  const registros = [anaComSetembro()];
  const { classificada, dados, ninebox } = exibir(registros, []);
  const automatica = indiceNinebox(classificada.detalhes.get(chaveAna).ninebox);

  assert.equal(automatica, 3, 'Gestão I + Nível III => Questionável (índice 3)');
  assert.equal(celulaDe(dados.ninebox, 'ANA SILVA'), 3, 'nascemos na célula automática');

  const exibido = origemDe(ninebox, 'ANA SILVA');
  assert.equal(exibido.origem, 'automatica');
  assert.equal(exibido.origemDetalhe, 'Automática');
});

test('2) movimentação manual altera a posição vigente sem apagar a automática', () => {
  const registros = [anaComSetembro()];
  const movimentos = [mov({ posicao_manual: 5, posicao_anterior: 3 })];
  const { classificada, dados, ninebox } = exibir(registros, movimentos);

  assert.equal(celulaDe(dados.ninebox, 'ANA SILVA'), 5, 'vigente = posição manual');
  // A automática continua calculada no motor (nunca é sobrescrita)
  assert.equal(indiceNinebox(classificada.detalhes.get(chaveAna).ninebox), 3);
  assert.equal(posicaoAutomaticaDoDiretor(classificada.detalhes.get(chaveAna), 'ninebox'), 3);

  const exibido = origemDe(ninebox, 'ANA SILVA');
  assert.equal(exibido.origem, 'manual');
  assert.match(exibido.origemDetalhe, /^Alterada manualmente/);
  assert.match(exibido.origemDetalhe, /Automática: Questionável/);
  assert.match(exibido.origemDetalhe, /Manual: FORTE DESEMPENHO/);
  assert.match(exibido.origemDetalhe, /Período: SET\/3TRI 2026/);
});

test('3) "atualizar a página" (reler base + linhas do banco) mantém a manual', () => {
  const movimentos = [mov({ posicao_manual: 5 })];

  // 1ª leitura (página carregada)
  const antes = exibir([anaComSetembro()], movimentos);
  assert.equal(celulaDe(antes.dados.ninebox, 'ANA SILVA'), 5);

  // 2ª leitura: banco relido do zero (novas referências/objetos, mesmas linhas)
  const depois = exibir([anaComSetembro()], movimentos.map((m) => ({ ...m })));
  assert.equal(celulaDe(depois.dados.ninebox, 'ANA SILVA'), 5, 'a manual permanece após recarregar');
  assert.equal(movimentos.length, 1, 'a linha da movimentação permanece no histórico');
});

test('4) trocar filtros não remove a manual (vigência usa a base completa)', () => {
  // ANA tem um registro na R2 com período OUT/2026 — sob o filtro R1 a tela
  // classifica só com r1 (SET), mas a vigência continua apontando para OUT.
  const registros = [
    anaComSetembro(),
    registro({
      id: 'r2',
      diretor: 'ANA SILVA',
      regional: 'R2',
      avaliacaoId: 'a2',
      periodos: [periodo({ id: 'p-out', rotulo: 'OUT/4TRI 2026', ordem: 1, estagio: 'Delegação II', nivel: 'V' })]
    })
  ];
  const movimentos = [mov({ registro_id: 'r2', periodo_id: 'p-out', periodo_mes: 10, referencia: 'OUT/4TRI 2026 · Valor importado', posicao_manual: 1 })];

  const filtrado = registros.filter((r) => r.regional === 'R1');
  const { classificada, dados, refs } = exibir(registros, movimentos, { filtrados: filtrado });

  assert.equal(refs.get(chaveAna).mes, 10, 'vigência sempre do último período da base completa');
  assert.equal(indiceNinebox(classificada.detalhes.get(chaveAna).ninebox), 3, 'sob o filtro a AUTOMÁTICA é calculada com SET');
  assert.equal(celulaDe(dados.ninebox, 'ANA SILVA'), 1, 'a manual (vinculada a OUT) segue vigente mesmo filtrado');
});

test('5) repetir/reler a MESMA referência do período não encerra a manual', () => {
  const registros = [anaComSetembro()];
  const movimentos = [mov({ posicao_manual: 5 })];

  // Releitura da mesma referência: mesmos rótulos, período recriado com OUTRO
  // id (como numa nova gravação do mesmo mês) — cronologia manda.
  const relido = [anaComSetembro()].map((r) => ({
    ...r,
    periodos: r.periodos.map((p) => (p.id === 'p-set' ? { ...p, id: 'p-set-regravado' } : p))
  }));
  const movimentoReleitura = [{ ...movimentos[0], periodo_id: 'p-set-regravado' }];

  const antes = exibir(registros, movimentos);
  const depois = exibir(relido, movimentoReleitura);
  assert.equal(celulaDe(antes.dados.ninebox, 'ANA SILVA'), 5);
  assert.equal(celulaDe(depois.dados.ninebox, 'ANA SILVA'), 5, 'mesma referência => manual permanece vigente');
  assert.equal(movimentoVigente(movimentos[0], depois.refs.get(chaveAna)), true);
  assert.equal(mesmoPeriodo(movimentos[0], depois.refs.get(chaveAna)), true);
});

test('6+7) alterar Status/Nível do MESMO período recalcula só a automática; a manual segue vigente', () => {
  // Status do SET muda para Delegação II => automática passa a ser Alto Potencial
  // (índice 2); a manual (MANTENEDOR, 5) permanece exibida.
  const registros = [anaComSetembro()];
  registros[0].periodos = registros[0].periodos.map((p) =>
    p.id === 'p-set' ? { ...p, estagio: 'Delegação II', estagioOriginal: 'Delegação II' } : p
  );
  const movimentos = [mov({ posicao_manual: 5 })];

  const { classificada, dados, ninebox, refs } = exibir(registros, movimentos);
  const det = classificada.detalhes.get(chaveAna);

  assert.equal(det.periodo.periodoId, 'p-set', 'o último período continua sendo o de setembro');
  assert.equal(indiceNinebox(det.ninebox), 2, 'automática RECALCULADA (Delegação II => Alto Potencial)');
  assert.equal(posicaoAutomaticaDoDiretor(det, 'ninebox'), 2);
  assert.equal(celulaDe(dados.ninebox, 'ANA SILVA'), 5, 'manual continua vigente no mesmo período');
  assert.equal(movimentoVigente(movimentos[0], refs.get(chaveAna)), true);
  assert.equal(origemDe(ninebox, 'ANA SILVA').origem, 'manual');
});

test('8) novo período por planilha encerra a vigência manual anterior', () => {
  const movimentos = [mov({ posicao_manual: 5 })];

  // Entra OUT/2026 (upload): última referência muda de mês.
  const comOut = [anaComSetembro([
    periodo({ id: 'p-out', rotulo: 'OUT/4TRI 2026', ordem: 3, estagio: 'Gestão II', nivel: 'II' })
  ])];
  const { classificada, dados, refs } = exibir(comOut, movimentos);

  assert.equal(refs.get(chaveAna).mes, 10, 'novo último período = outubro');
  assert.equal(movimentoVigente(movimentos[0], refs.get(chaveAna)), false, 'vigência de setembro encerrada');
  assert.equal(indiceNinebox(classificada.detalhes.get(chaveAna).ninebox), 4, 'automática de OUTUBRO (Gestão II + II => Mantenedor)');
  assert.equal(celulaDe(dados.ninebox, 'ANA SILVA'), 4, 'a automática do novo período passa a valer');
});

test('9+10) novo período por CADASTRO MANUAL também encerra e a automática nova vale', () => {
  const movimentos = [mov({ posicao_manual: 5 })];
  const comNovo = [anaComSetembro([
    periodo({ id: 'p-nov', rotulo: 'NOV/4TRI 2026', ordem: 4, estagio: 'Delegação II', nivel: 'V', origem: 'cadastro_manual' })
  ])];
  const { classificada, dados, refs } = exibir(comNovo, movimentos);

  assert.equal(refs.get(chaveAna).mes, 11, 'cadastro manual cria período posterior');
  assert.equal(movimentoVigente(movimentos[0], refs.get(chaveAna)), false, 'vigência anterior encerrada');
  assert.equal(indiceNinebox(classificada.detalhes.get(chaveAna).ninebox), 2, 'automática nova = Alto Potencial');
  assert.equal(celulaDe(dados.ninebox, 'ANA SILVA'), 2, 'automática do novo período vigente');
});

test('11) histórico permanece: nada é apagado e o motivo do encerramento fica registrado', () => {
  const registros = [anaComSetembro([
    periodo({ id: 'p-out', rotulo: 'OUT/4TRI 2026', ordem: 3, estagio: 'Gestão II', nivel: 'II' })
  ])];

  const antiga = mov({ posicao_manual: 5 });
  const nova = mov({ id: 'm2', posicao_manual: 2, periodo_id: 'p-out', periodo_mes: 10, referencia: 'OUT/4TRI 2026 · Valor importado', posicao_anterior: 5, posicao_automatica: 4 });

  const refsComOut = montarReferenciasPeriodo(registros, AVALIACOES);
  const refsSemOut = montarReferenciasPeriodo([anaComSetembro()], AVALIACOES);

  // Mesmo período => substituída; período posterior => novo período.
  assert.equal(motivoEncerramento(antiga, refsSemOut.get(chaveAna)), MOTIVO_SUBSTITUIDA, 'mesmo período => substituída');
  assert.equal(motivoEncerramento(antiga, refsComOut.get(chaveAna)), MOTIVO_NOVO_PERIODO, 'setembro x outubro => novo_periodo');

  // Linha arquivada deixa de valer, mas NUNCA some (histórico por matriz/período).
  const arquivada = { ...antiga, arquivada_em: '2026-10-01T10:00:00Z', encerrado_motivo: MOTIVO_NOVO_PERIODO };
  const linhas = [arquivada, nova];
  assert.equal(movimentoVigente(arquivada, refsComOut.get(chaveAna)), false, 'arquivada não é vigente');
  assert.equal(linhas.length, 2, 'histórico preservado (nenhuma linha apagada)');
  assert.equal(linhas[0].posicao_manual, 5, 'posição manual antiga registrada');
  assert.equal(linhas[0].status_usado, 'Gestão I', 'Status usado daquele período preservado');
  assert.equal(linhas[0].nivel_usado, '(III)', 'Nível usado daquele período preservado');
  assert.equal(linhas[0].posicao_automatica, 3, 'posição automática daquele período preservada');
});

test('12) matrizes INDEPENDENTES: Ninebox e Risco × Dano não se contaminam', () => {
  const registros = [anaComSetembro()];
  const automatica = exibir(registros, []);
  const soNinebox = exibir(registros, [mov({ matriz: 'ninebox', posicao_manual: 5 })]);
  const soRisco = exibir(registros, [mov({ matriz: 'risk', posicao_manual: 12, posicao_automatica: 0, posicao_anterior: 0 })]);

  // Movimentação só na Ninebox: Risco × Dano permanece idêntica à automática.
  assert.equal(celulaDe(soNinebox.dados.ninebox, 'ANA SILVA'), 5);
  assert.equal(celulaDe(soNinebox.dados.risk, 'ANA SILVA'), celulaDe(automatica.dados.risk, 'ANA SILVA'));

  // Movimentação só no Risco × Dano: Ninebox permanece idêntica à automática.
  assert.equal(celulaDe(soRisco.dados.risk, 'ANA SILVA'), 12);
  assert.equal(celulaDe(soRisco.dados.ninebox, 'ANA SILVA'), celulaDe(automatica.dados.ninebox, 'ANA SILVA'));

  // Origens independentes por matriz (mesmo diretor).
  assert.equal(origemDe(soNinebox.ninebox, 'ANA SILVA').origem, 'manual');
  assert.equal(origemDe(soNinebox.risk, 'ANA SILVA').origem, 'automatica');
  assert.equal(origemDe(soRisco.ninebox, 'ANA SILVA').origem, 'automatica');
  assert.equal(origemDe(soRisco.risk, 'ANA SILVA').origem, 'manual');

  // Uma única vigência por matriz (duas matrizes => duas decisões possíveis).
  const duas = exibir(registros, [
    mov({ id: 'm-n', matriz: 'ninebox', posicao_manual: 5 }),
    mov({ id: 'm-r', matriz: 'risk', posicao_manual: 12, posicao_automatica: 0, posicao_anterior: 0 })
  ]);
  assert.equal(celulaDe(duas.dados.ninebox, 'ANA SILVA'), 5);
  assert.equal(celulaDe(duas.dados.risk, 'ANA SILVA'), 12);
  assert.equal(origemDe(duas.ninebox, 'ANA SILVA').origem, 'manual');
  assert.equal(origemDe(duas.risk, 'ANA SILVA').origem, 'manual');
});

// ---------------------------------------------------------------------------
// Preparação do registro da movimentação + proteções
// ---------------------------------------------------------------------------

test('prepararMovimentacaoMatriz usa o período de referência e a automática exibida', () => {
  const registros = [anaComSetembro()];
  const c = classificar(registros);
  const refs = montarReferenciasPeriodo(registros, AVALIACOES);

  const payload = prepararMovimentacaoMatriz(
    { type: 'ninebox', directorName: 'ANA SILVA', fromIndex: 3, toIndex: 5 },
    c.detalhes,
    refs,
    registros
  );

  assert.equal(payload.matriz, 'ninebox');
  assert.equal(payload.diretor, 'ANA SILVA');
  assert.equal(payload.registroId, 'r1');
  assert.equal(payload.avaliacaoId, 'a1');
  assert.equal(payload.periodoId, 'p-set');
  assert.equal(payload.referencia, 'SET/3TRI 2026 · Valor importado');
  assert.equal(payload.ano, 2026);
  assert.equal(payload.mes, 9);
  assert.equal(payload.status, 'Gestão I');
  assert.equal(payload.nivel, '(III)');
  assert.equal(payload.posicaoAutomatica, 3, 'posição automática calculada na tela');
  assert.equal(payload.posicaoAnterior, 3);
  assert.equal(payload.posicaoManual, 5);
});

test('prepararMovimentacaoMatriz: diretor aguardando classificação não pode ser movimentado', () => {
  // Reposicionamento não tem regra aprovada => aguardando nas duas matrizes.
  const registros = [registro({
    id: 'r1',
    diretor: 'ANA SILVA',
    periodos: [periodo({ id: 'p-set', rotulo: 'SET/3TRI 2026', ordem: 1, estagio: 'Reposicionamento', nivel: 'III' })]
  })];
  const c = classificar(registros);
  const refs = montarReferenciasPeriodo(registros, AVALIACOES);

  assert.equal(indiceNinebox(c.detalhes.get(chaveAna).ninebox), null);
  assert.throws(
    () => prepararMovimentacaoMatriz({ type: 'ninebox', directorName: 'ANA SILVA', fromIndex: 0, toIndex: 1 }, c.detalhes, refs, registros),
    /aguardando classificação/i
  );
});

test('prepararMovimentacaoMatriz: sem período válido não grava nada', () => {
  const registros = [registro({ id: 'r1', diretor: 'ANA SILVA', periodos: [] })];
  const c = classificar(registros);
  const refs = montarReferenciasPeriodo(registros, AVALIACOES);
  assert.throws(
    () => prepararMovimentacaoMatriz({ type: 'risk', directorName: 'ANA SILVA', fromIndex: 0, toIndex: 1 }, c.detalhes, refs, registros),
    /período válido/i
  );
});

test('aplicarMovimentos não altera a base de entrada (sem efeitos colaterais)', () => {
  const registros = [anaComSetembro()];
  const c = classificar(registros);
  const refs = montarReferenciasPeriodo(registros, AVALIACOES);
  const antesNine = c.ninebox.map((cel) => cel.map((p) => p.id));
  const antesRisk = c.risk.map((cel) => cel.map((p) => p.id));

  const saida = aplicarMovimentos(c.ninebox, c.risk, [mov({ posicao_manual: 5 })], refs);

  assert.notEqual(saida.ninebox, c.ninebox, 'novos arrays (não muta a distribuição automática)');
  assert.deepEqual(c.ninebox.map((cel) => cel.map((p) => p.id)), antesNine);
  assert.deepEqual(c.risk.map((cel) => cel.map((p) => p.id)), antesRisk);
});
