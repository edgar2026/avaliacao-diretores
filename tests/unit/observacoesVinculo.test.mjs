// Testes das regras puras de VÍNCULO e EXIBIÇÃO das observações do regional.
// A observação é individual: só aparece para o MESMO diretor (escopo 'diretor'),
// da mesma regional e da mesma avaliação. Uma observação criada para um diretor
// (ex.: Hesdras Viana) NUNCA aparece para outro diretor da mesma regional.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validarObservacao,
  resolveObservacaoVinculo,
  observacaoFiltros,
  observacaoVisivel,
  formatarDataHora,
  listObservacoesDiretor
} from '../../src/services/observacoesService.js';

const AVALIACAO_ATUAL = 'aaaaaaaa-0000-4000-8000-000000000001';
const AVALIACAO_ANTIGA = 'aaaaaaaa-0000-4000-8000-000000000002';
const REG_HESDRAS = '11111111-1111-4111-8111-111111111111';
const REG_GREGORIO = '22222222-2222-4222-8222-222222222222';
const REG_CILENE = '33333333-3333-4333-8333-333333333333';

// Base parecida com a planilha real: mesma regional, diretores diferentes.
const AVALIACOES = [
  { id: AVALIACAO_ANTIGA, trimestre: 2, ano: 2026 },
  { id: AVALIACAO_ATUAL, trimestre: 3, ano: 2026 }
];
const REGISTROS = [
  { id: REG_HESDRAS, avaliacaoId: AVALIACAO_ANTIGA, regional: 'PAULO PALMEIRA', diretor: 'Hesdras Viana' },
  { id: REG_GREGORIO, avaliacaoId: AVALIACAO_ANTIGA, regional: 'PAULO PALMEIRA', diretor: 'Gregorio Batista' },
  { id: REG_CILENE, avaliacaoId: AVALIACAO_ANTIGA, regional: 'PAULO PALMEIRA', diretor: 'Cilene Andrade' },
  { id: '44444444-4444-4444-8444-444444444444', avaliacaoId: AVALIACAO_ATUAL, regional: 'PAULO PALMEIRA', diretor: 'Hesdras Viana' },
  { id: '55555555-5555-4555-8555-555555555555', avaliacaoId: AVALIACAO_ATUAL, regional: 'PAULO PALMEIRA', diretor: 'Gregorio Batista' }
];
const SELECAO = { regional: 'PAULO PALMEIRA', diretor: 'Hesdras Viana' };

test('resolveObservacaoVinculo: usa a avaliação mais recente do MESMO diretor', () => {
  const v = resolveObservacaoVinculo(REGISTROS, AVALIACOES, SELECAO);
  assert.equal(v.avaliacaoId, AVALIACAO_ATUAL);
  assert.equal(v.registroId, '44444444-4444-4444-8444-444444444444');
});

test('resolveObservacaoVinculo: diretor diferente da mesma regional ganha registro diferente', () => {
  const hesdras = resolveObservacaoVinculo(REGISTROS, AVALIACOES, SELECAO);
  const gregorio = resolveObservacaoVinculo(REGISTROS, AVALIACOES, { regional: 'PAULO PALMEIRA', diretor: 'Gregorio Batista' });
  const cilene = resolveObservacaoVinculo(REGISTROS, AVALIACOES, { regional: 'PAULO PALMEIRA', diretor: 'Cilene Andrade' });
  assert.notEqual(hesdras.registroId, gregorio.registroId);
  assert.notEqual(hesdras.registroId, cilene.registroId);
  assert.equal(gregorio.registroId, '55555555-5555-4555-8555-555555555555');
  // Cilene só existe na avaliação antiga → vincula lá.
  assert.equal(cilene.avaliacaoId, AVALIACAO_ANTIGA);
});

test('resolveObservacaoVinculo: sem regional ou sem diretor não há vínculo', () => {
  assert.equal(resolveObservacaoVinculo(REGISTROS, AVALIACOES, { regional: 'PAULO PALMEIRA', diretor: '' }), null);
  assert.equal(resolveObservacaoVinculo(REGISTROS, AVALIACOES, { regional: '', diretor: 'Hesdras Viana' }), null);
  assert.equal(resolveObservacaoVinculo(REGISTROS, AVALIACOES, { regional: 'OUTRA REGIONAL', diretor: 'Hesdras Viana' }), null);
});

test('resolveObservacaoVinculo: nomes com caixa/acentos diferentes ainda encontram o registro', () => {
  const v = resolveObservacaoVinculo(REGISTROS, AVALIACOES, { regional: 'paulo palmeira', diretor: 'hesdras viana' });
  assert.equal(v.registroId, '44444444-4444-4444-8444-444444444444');
});

test('observacaoFiltros: nunca consulta somente pela regional (traz escopo+arquivadas+diretor)', () => {
  const cols = observacaoFiltros({ regional: 'PAULO PALMEIRA' }).map((f) => f.col);
  assert.ok(cols.includes('escopo'), 'deve filtrar escopo');
  assert.ok(cols.includes('arquivada_em'), 'deve excluir arquivadas');
  assert.ok(cols.includes('regional'), 'deve confirmar a regional');
  assert.ok(!cols.includes('diretor'), 'sem diretor selecionado não há consulta individual');

  const comDiretor = observacaoFiltros({ regional: 'PAULO PALMEIRA', diretor: 'Hesdras Viana' });
  const diretorFiltro = comDiretor.find((f) => f.col === 'diretor');
  assert.equal(diretorFiltro.valor, 'Hesdras Viana');
  assert.ok(comDiretor.some((f) => f.col === 'escopo' && f.valor === 'diretor'));
  assert.ok(comDiretor.some((f) => f.col === 'arquivada_em' && f.op === 'is' && f.valor === null));
});

test('observacaoFiltros: prioriza registro_id → avaliacao_id → escopo diretor', () => {
  const comTudo = observacaoFiltros({ registroId: REG_HESDRAS, avaliacaoId: AVALIACAO_ATUAL, ...SELECAO });
  const porCol = Object.fromEntries(comTudo.map((f) => [f.col, f.valor]));
  assert.equal(porCol.registro_id, REG_HESDRAS);
  assert.equal(porCol.avaliacao_id, AVALIACAO_ATUAL);
  assert.equal(porCol.escopo, 'diretor');
  assert.equal(porCol.diretor, 'Hesdras Viana');
  assert.equal(porCol.regional, 'PAULO PALMEIRA');
  assert.equal(porCol.arquivada_em, null);

  const semRegistro = observacaoFiltros({ avaliacaoId: AVALIACAO_ATUAL, ...SELECAO });
  assert.ok(!semRegistro.some((f) => f.col === 'registro_id'), 'sem registro_id o filtro não é incluído');
  assert.ok(semRegistro.some((f) => f.col === 'avaliacao_id' && f.valor === AVALIACAO_ATUAL));
});

test('observacaoVisivel: observação de Hesdras NÃO aparece para Gregorio/Cilene', () => {
  const obs = { escopo: 'diretor', regional: 'PAULO PALMEIRA', diretor: 'Hesdras Viana', registro_id: REG_HESDRAS, avaliacao_id: AVALIACAO_ATUAL, arquivada_em: null };
  assert.equal(observacaoVisivel(obs, { ...SELECAO, registroId: REG_HESDRAS, avaliacaoId: AVALIACAO_ATUAL }), true);
  assert.equal(observacaoVisivel(obs, { regional: 'PAULO PALMEIRA', diretor: 'Gregorio Batista' }), false);
  assert.equal(observacaoVisivel(obs, { regional: 'PAULO PALMEIRA', diretor: 'Cilene Andrade' }), false);
});

test('observacaoVisivel: regional, escopo geral e arquivadas nunca aparecem', () => {
  const base = { regional: 'PAULO PALMEIRA', diretor: 'Hesdras Viana', registro_id: REG_HESDRAS, avaliacao_id: AVALIACAO_ATUAL, arquivada_em: null };
  assert.equal(observacaoVisivel({ ...base, escopo: 'regional', diretor: null, registro_id: null }, SELECAO), false);
  assert.equal(observacaoVisivel({ ...base, escopo: 'geral', diretor: null }, SELECAO), false);
  assert.equal(observacaoVisivel({ ...base, escopo: 'diretor', arquivada_em: '2026-10-14T13:24:10.989+00:00' }, SELECAO), false);
  assert.equal(observacaoVisivel(null, SELECAO), false);
});

test('observacaoVisivel: observação de outra regional ou outra avaliação não aparece', () => {
  const obs = { escopo: 'diretor', regional: 'PAULO PALMEIRA', diretor: 'Hesdras Viana', registro_id: REG_HESDRAS, avaliacao_id: AVALIACAO_ATUAL, arquivada_em: null };
  assert.equal(observacaoVisivel(obs, { regional: 'AISLANE BELO', diretor: 'Hesdras Viana' }), false);
  assert.equal(observacaoVisivel(obs, { ...SELECAO, avaliacaoId: AVALIACAO_ANTIGA, registroId: REG_HESDRAS }), false);
});

test('validarObservacao: exige texto, regional e diretor', () => {
  assert.equal(validarObservacao({ ...SELECAO, observacao: '  Observação válida.  ' }), 'Observação válida.');
  assert.throws(() => validarObservacao({ ...SELECAO, observacao: '   ' }), /não pode ficar vazia/);
  assert.throws(() => validarObservacao({ regional: '', diretor: 'Hesdras Viana', observacao: 'x' }), /Selecione uma regional/);
  assert.throws(() => validarObservacao({ regional: 'PAULO PALMEIRA', diretor: '', observacao: 'x' }), /Selecione um diretor/);
});

test('formatarDataHora: devolve data/horário em pt-BR ou “—”', () => {
  assert.equal(formatarDataHora(null), '—');
  assert.equal(formatarDataHora('não é data'), '—');
  assert.match(formatarDataHora('2026-10-14T13:22:36.609608+00:00'), /^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}/);
});

test('listar sem diretor selecionado devolve lista vazia (sem consulta)', async () => {
  assert.deepEqual(await listObservacoesDiretor({ regional: 'PAULO PALMEIRA', diretor: '' }), []);
  assert.deepEqual(await listObservacoesDiretor({}), []);
});
