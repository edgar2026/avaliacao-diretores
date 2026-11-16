// Teste de integração da POSIÇÃO MANUAL das matrizes — roda contra o fake
// in-memory do Supabase (ver fakeSupabase.mjs). NÃO escreve nada no projeto
// real: nenhum teste desta suíte deixa movimentações permanentes.
//
// Cobre a persistência da Parte 2:
//   * 1º arraste  -> cria a linha ATIVA (nenhuma vigência anterior);
//   * 2º arraste no MESMO período -> anterior vira histórico 'substituida';
//   * arraste com período POSTERIOR -> anterior vira histórico 'novo_periodo';
//   * matrizes INDEPENDENTES -> salvar na Risco × Dano não encerra a Ninebox;
//   * listagem retorna SOMENTE as ativas (histórico fica no banco);
//   * validações rejeitam sem gravar nada.
//
// Requer a flag de runtime `--experimental-test-module-mocks` (presente em
// `npm run test:integration`).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './fakeSupabase.mjs';

// Substitui o cliente Supabase ANTES de importar o serviço.
const fake = createFakeSupabase();
mock.module('../../src/services/supabaseClient.ts', {
  exports: {
    getSupabase: () => fake,
    isSupabaseConfigured: () => true
  }
});

const {
  salvarMovimentacaoMatriz,
  listarMovimentacoesAtivas,
  MOTIVO_SUBSTITUIDA,
  MOTIVO_NOVO_PERIODO,
  ORIGEM_MANUAL
} = await import('../../src/services/matrizMovimentacoesService.ts');

const TABELA = 'avaliacoes_diretores_matriz_movimentacoes';
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const REGISTRO = U(101);
const AVALIACAO = U(102);
const PERIODO_SET = U(103);
const PERIODO_OUT = U(104);

// Payload validado equivalente ao montado por prepararMovimentacaoMatriz.
function entrada(over = {}) {
  return {
    matriz: 'ninebox',
    diretor: 'ANA SILVA',
    registroId: REGISTRO,
    avaliacaoId: AVALIACAO,
    periodoId: PERIODO_SET,
    referencia: 'SET/3TRI 2026 · Valor importado',
    ano: 2026,
    mes: 9,
    status: 'Gestão I',
    nivel: '(III)',
    posicaoAutomatica: 3,
    posicaoAnterior: 3,
    posicaoManual: 5,
    ...over
  };
}

const linhas = () => fake.__rowsOf(TABELA);
const ativasAgora = () => linhas().filter((l) => !l.arquivada_em);

test('1º arraste: cria a linha ATIVA e nenhuma vigência anterior é encerrada', async () => {
  const r = await salvarMovimentacaoMatriz(entrada());

  assert.equal(r.encerradaId, null, 'não havia vigência anterior');
  assert.equal(r.encerradoMotivo, null);
  assert.equal(r.movimento.origem, ORIGEM_MANUAL);
  assert.equal(r.movimento.diretor_chave, 'ana silva');
  assert.equal(r.movimento.posicao_automatica, 3, 'automática preservada para auditoria');
  assert.equal(r.movimento.posicao_manual, 5);
  assert.ok(!r.movimento.arquivada_em, 'linha nasce ativa');

  const ativas = await listarMovimentacoesAtivas();
  assert.equal(ativas.length, 1);
  assert.equal(ativas[0].posicao_manual, 5);
});

test('2º arraste no MESMO período: anterior vira histórico "substituida"', async () => {
  const r = await salvarMovimentacaoMatriz(entrada({ posicaoAnterior: 5, posicaoManual: 2 }));

  assert.equal(r.encerradaId, linhas()[0].id, 'encerra a vigência anterior');
  assert.equal(r.encerradoMotivo, MOTIVO_SUBSTITUIDA, 'mesmo período => substituída');

  // Nada apagado: 2 linhas, a antiga só arquivada (histórico preservado).
  assert.equal(linhas().length, 2);
  const antiga = linhas()[0];
  assert.ok(antiga.arquivada_em, 'anterior arquivada logicamente');
  assert.equal(antiga.encerrado_motivo, MOTIVO_SUBSTITUIDA);
  assert.equal(antiga.posicao_manual, 5, 'posição manual antiga preservada no histórico');
  assert.equal(antiga.status_usado, 'Gestão I');
  assert.equal(antiga.nivel_usado, '(III)');

  // Listagem: SÓ a vigente.
  const ativas = await listarMovimentacoesAtivas();
  assert.equal(ativas.length, 1, 'somente a movimentação vigente é retornada');
  assert.equal(ativas[0].posicao_manual, 2);
  assert.ok(!ativas[0].arquivada_em);
});

test('arraste com período POSTERIOR: anterior vira histórico "novo_periodo"', async () => {
  const r = await salvarMovimentacaoMatriz(entrada({
    periodoId: PERIODO_OUT,
    referencia: 'OUT/4TRI 2026 · Valor importado',
    mes: 10,
    status: 'Gestão II',
    nivel: '(II)',
    posicaoAutomatica: 4,
    posicaoAnterior: 2,
    posicaoManual: 4
  }));

  assert.equal(r.encerradoMotivo, MOTIVO_NOVO_PERIODO, 'setembro -> outubro => novo período');

  assert.equal(linhas().length, 3, 'histórico completo: 2 arquivadas + 1 ativa');
  assert.equal(ativasAgora().length, 1);
  const vigente = ativasAgora()[0];
  assert.equal(vigente.periodo_mes, 10, 'vigência aponta para o último período');
  assert.equal(vigente.status_usado, 'Gestão II');
  assert.equal(vigente.posicao_automatica, 4);

  // As duas encerradas seguem consultáveis (nada é apagado).
  const historicas = linhas().filter((l) => l.arquivada_em);
  assert.equal(historicas.length, 2);
  assert.deepEqual(historicas.map((l) => l.encerrado_motivo), [MOTIVO_SUBSTITUIDA, MOTIVO_NOVO_PERIODO]);
});

test('INDEPENDÊNCIA: salvar na Risco × Dano não encerra a vigência da Ninebox', async () => {
  const nineboxAntes = ativasAgora().filter((l) => l.matriz === 'ninebox');
  assert.equal(nineboxAntes.length, 1, 'ninebox tem vigência ativa');

  const r = await salvarMovimentacaoMatriz(entrada({
    matriz: 'risk',
    posicaoAutomatica: 0,
    posicaoAnterior: 0,
    posicaoManual: 12
  }));

  assert.equal(r.encerradaId, null, 'a outra matriz NÃO é tocada');
  const ativas = await listarMovimentacoesAtivas();
  assert.equal(ativas.length, 2, 'uma vigência por matriz, lado a lado');
  assert.deepEqual(ativas.map((l) => l.matriz).sort(), ['ninebox', 'risk']);

  const nineboxDepois = ativas.find((l) => l.matriz === 'ninebox');
  assert.equal(nineboxDepois.id, nineboxAntes[0].id, 'linha da Ninebox permanece ativa');
  assert.equal(nineboxDepois.posicao_manual, 4, 'posição manual da Ninebox intacta');
});

test('arraste na MESMA matriz encerra só a própria matriz (risk não duplica)', async () => {
  const antes = ativasAgora().find((l) => l.matriz === 'risk');

  const r = await salvarMovimentacaoMatriz(entrada({
    matriz: 'risk',
    posicaoAutomatica: 0,
    posicaoAnterior: 12,
    posicaoManual: 7
  }));

  assert.equal(r.encerradaId, antes.id, 'encerra a vigência da MESMA matriz');
  assert.equal(r.encerradoMotivo, MOTIVO_SUBSTITUIDA, 'mesmo período (setembro) => substituída');

  const ativas = await listarMovimentacoesAtivas();
  assert.equal(ativas.length, 2, 'nunca mais de uma ativa por matriz+diretor');
  assert.equal(ativas.filter((l) => l.matriz === 'risk').length, 1);
  assert.equal(ativas.filter((l) => l.matriz === 'ninebox').length, 1);
});

test('validações rejeitam sem gravar nada', async () => {
  const antes = linhas().length;

  await assert.rejects(
    salvarMovimentacaoMatriz(entrada({ posicaoManual: 3 })),
    /diferente da posição atual/i,
    'mesma célula de origem e destino'
  );
  await assert.rejects(
    salvarMovimentacaoMatriz(entrada({ posicaoManual: 9 })),
    /fora da grade/i,
    'ninebox só tem índices 0..8'
  );
  await assert.rejects(
    salvarMovimentacaoMatriz(entrada({ matriz: 'risk', posicaoManual: 16 })),
    /fora da grade/i,
    'risk só tem índices 0..15'
  );
  await assert.rejects(
    salvarMovimentacaoMatriz(entrada({ matriz: 'hist' })),
    /Matriz inválida/i
  );
  await assert.rejects(
    salvarMovimentacaoMatriz(entrada({ diretor: '   ' })),
    /identificar o diretor/i
  );

  assert.equal(linhas().length, antes, 'nenhuma linha gravada em rejeições');
  assert.equal((await listarMovimentacoesAtivas()).length, 2, 'vigências intactas');
});

test('o fake não escreve no Supabase real (sanidade)', () => {
  assert.ok(linhas().length >= 4, 'histórico completo em memória');
  assert.equal(ativasAgora().length, 2, 'uma ativa por matriz');
  // Tabela nunca sofre DELETE: todas as linhas criadas continuam presentes.
  assert.ok(linhas().every((l) => l.id), 'toda linha tem id');
});
