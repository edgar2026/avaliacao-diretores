// Testes das regras puras dos PARECERES (regional | operacoes).
// O parecer é individual: só aparece para o MESMO diretor, da mesma regional,
// com tipo válido e não arquivado. Um parecer criado para um diretor NUNCA
// aparece para outro diretor — e a lista ordenada sempre traz o mais recente
// primeiro (os anteriores ficam no histórico).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIPOS_PARECER,
  TIPO_LABEL,
  ehTipoParecer,
  validarParecer,
  parecerFiltros,
  parecerVisivel,
  parecerPertence,
  parecerMaisRecente,
  parecerEditado,
  listPareceres
} from '../../src/services/pareceresService.js';

const REG_HESDRAS = '11111111-1111-4111-8111-111111111111';
const REG_GREGORIO = '22222222-2222-4222-8222-222222222222';
const SELECAO = { regional: 'PAULO PALMEIRA', diretor: 'Hesdras Viana' };
const REGISTROS = [
  { id: REG_HESDRAS, diretor: 'Hesdras Viana', regional: 'PAULO PALMEIRA' },
  { id: REG_GREGORIO, diretor: 'Gregorio Batista', regional: 'PAULO PALMEIRA' }
];

const parecerBase = {
  tipo: 'regional',
  escopo: 'diretor',
  regional: 'PAULO PALMEIRA',
  diretor: 'Hesdras Viana',
  registro_id: REG_HESDRAS,
  arquivada_em: null
};

test('tipos de parecer: somente regional e operacoes; primeiro card = JUSTIFICATIVA', () => {
  assert.deepEqual(TIPOS_PARECER, ['regional', 'operacoes']);
  assert.equal(TIPO_LABEL.regional, 'JUSTIFICATIVA');
  assert.equal(TIPO_LABEL.operacoes, 'Parecer de Operações');
  assert.equal(ehTipoParecer('regional'), true);
  assert.equal(ehTipoParecer('operacoes'), true);
  assert.equal(ehTipoParecer('geral'), false);
  assert.equal(ehTipoParecer(null), false);
});

test('validarParecer: exige tipo, texto, regional e diretor', () => {
  assert.equal(validarParecer({ ...SELECAO, tipo: 'regional', texto: '  Parecer válido.  ' }), 'Parecer válido.');
  assert.equal(validarParecer({ ...SELECAO, tipo: 'operacoes', texto: 'ok' }), 'ok');
  assert.throws(() => validarParecer({ ...SELECAO, tipo: 'regional', texto: '   ' }), /não pode ficar vazio/);
  assert.throws(() => validarParecer({ ...SELECAO, tipo: 'outra', texto: 'x' }), /Tipo de parecer inválido/);
  assert.throws(() => validarParecer({ regional: '', diretor: 'Hesdras Viana', tipo: 'regional', texto: 'x' }), /Selecione uma regional/);
  assert.throws(() => validarParecer({ regional: 'PAULO PALMEIRA', diretor: '', tipo: 'operacoes', texto: 'x' }), /Selecione um diretor/);
});

test('parecerFiltros: escopo + tipo + SEMPRE arquivada_em IS NULL + diretor/regional', () => {
  const cols = parecerFiltros({ tipo: 'regional', ...SELECAO });
  const porCol = Object.fromEntries(cols.map((f) => [f.col, f.valor]));
  assert.equal(porCol.escopo, 'diretor');
  assert.equal(porCol.tipo, 'regional');
  assert.equal(porCol.arquivada_em, null);
  assert.equal(porCol.diretor, 'Hesdras Viana');
  assert.equal(porCol.regional, 'PAULO PALMEIRA');

  // Card E histórico usam o mesmo filtro: excluídos nunca aparecem em nenhum.
  const historico = parecerFiltros({ tipo: 'operacoes', ...SELECAO });
  assert.ok(historico.some((f) => f.col === 'arquivada_em' && f.op === 'is' && f.valor === null), 'o histórico também filtra arquivada_em IS NULL');
  assert.ok(historico.some((f) => f.col === 'tipo' && f.valor === 'operacoes'));
});

test('parecerVisivel: parecer de Hesdras NÃO aparece para Gregorio', () => {
  assert.equal(parecerVisivel(parecerBase, { ...SELECAO, registros: REGISTROS }), true);
  assert.equal(parecerVisivel(parecerBase, { regional: 'PAULO PALMEIRA', diretor: 'Gregorio Batista', registros: REGISTROS }), false);
  assert.equal(parecerVisivel(parecerBase, { regional: 'AISLANE BELO', diretor: 'Hesdras Viana', registros: REGISTROS }), false);
});

test('parecerVisivel: rejeita arquivado, tipo inválido/ausente e registro de outro diretor', () => {
  assert.equal(parecerVisivel({ ...parecerBase, arquivada_em: '2026-10-15T10:00:00+00:00' }, { ...SELECAO, registros: REGISTROS }), false);
  assert.equal(parecerVisivel({ ...parecerBase, tipo: null }, { ...SELECAO, registros: REGISTROS }), false);
  assert.equal(parecerVisivel({ ...parecerBase, tipo: 'geral' }, { ...SELECAO, registros: REGISTROS }), false);
  assert.equal(parecerVisivel({ ...parecerBase, registro_id: REG_GREGORIO }, { ...SELECAO, registros: REGISTROS }), false);
  assert.equal(parecerVisivel(null, { ...SELECAO, registros: REGISTROS }), false);
});

test('parecerVisivel (card E histórico): arquivado nunca aparece; pertence sem filtrar', () => {
  const arquivado = { ...parecerBase, arquivada_em: '2026-10-15T10:00:00+00:00' };
  assert.equal(parecerVisivel(arquivado, { ...SELECAO, registros: REGISTROS }), false, 'o card nunca mostra o excluído');
  assert.equal(parecerVisivel(arquivado, { ...SELECAO, registros: REGISTROS }), false, 'o histórico também não mostra o excluído');
  assert.equal(parecerPertence(arquivado, { ...SELECAO, registros: REGISTROS }), true, 'pertencimento é só de dono (o filtro de arquivado é da visibilidade)');
  assert.equal(parecerPertence(arquivado, { regional: 'PAULO PALMEIRA', diretor: 'Gregorio Batista', registros: REGISTROS }), false, 'nunca vaza para outro diretor');
  assert.equal(parecerPertence({ ...parecerBase, tipo: null }, { ...SELECAO, registros: REGISTROS }), false);
  assert.equal(parecerPertence(null, { ...SELECAO, registros: REGISTROS }), false);
});

test('parecerMaisRecente: devolve o primeiro da lista ordenada ou null', () => {
  const lista = [
    { id: 'novo', created_at: '2026-10-15T09:00:00+00:00' },
    { id: 'antigo', created_at: '2026-09-01T09:00:00+00:00' }
  ];
  assert.equal(parecerMaisRecente(lista).id, 'novo');
  assert.equal(parecerMaisRecente([]), null);
  assert.equal(parecerMaisRecente(undefined), null);
});

test('parecerEditado: true somente quando updated_at difere de created_at', () => {
  assert.equal(parecerEditado({ created_at: '2026-10-15T09:00:00+00:00', updated_at: '2026-10-15T09:00:00+00:00' }), false);
  assert.equal(parecerEditado({ created_at: '2026-10-15T09:00:00+00:00', updated_at: '2026-10-15T11:30:00+00:00' }), true);
  assert.equal(parecerEditado({ created_at: null, updated_at: null }), false);
  assert.equal(parecerEditado(null), false);
});

test('listPareceres sem diretor selecionado devolve lista vazia (sem consulta)', async () => {
  assert.deepEqual(await listPareceres({ tipo: 'regional', regional: 'PAULO PALMEIRA', diretor: '' }), []);
  assert.deepEqual(await listPareceres({ tipo: 'operacoes' }), []);
  await assert.rejects(() => listPareceres({ tipo: 'invalido', ...SELECAO }), /Tipo de parecer inválido/);
});
