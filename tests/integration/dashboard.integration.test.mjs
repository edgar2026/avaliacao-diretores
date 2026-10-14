// Teste de integração do dashboard — SOMENTE LEITURA no Supabase real.
// Não cria nem remove nada; é tolerante a banco vazio (estado pós-limpeza).
import './loadEnv.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSupabase } from '../../src/services/supabaseClient.js';
import { loadPublishedDashboard, buildDashboardModel, matrixPeriodColumns, filterMatrixRows, buildPeriodLabelMap } from '../../src/services/dashboardService.js';

const configured = Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  && Boolean(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
const skip = configured ? false : 'Credenciais Supabase ausentes (arquivo .env)';

test('dashboard carrega avaliações publicadas e monta o modelo', { skip }, async () => {
  const raw = await loadPublishedDashboard();

  // Estrutura sempre válida (mesmo vazio)
  assert.ok(Array.isArray(raw.avaliacoes));
  assert.ok(Array.isArray(raw.registros));
  assert.ok(Array.isArray(raw.periodos));
  assert.ok(Array.isArray(raw.indicadores));

  const model = buildDashboardModel(raw);
  assert.equal(model.avaliacoes.length, raw.avaliacoes.length);
  assert.equal(model.registros.length, raw.registros.length);

  // Quando há dados, toda avaliação carregada é publicada e coerente
  const supabase = getSupabase();
  const { data: todas } = await supabase.from('avaliacoes_diretores').select('id, status');
  const statusPorId = new Map((todas || []).map(t => [t.id, t.status]));
  const modelPorId = new Map(model.avaliacoes.map(a => [a.id, a]));
  const ids = new Set(raw.avaliacoes.map(a => a.id));
  for(const a of raw.avaliacoes){
    assert.equal(statusPorId.get(a.id), 'publicada', 'somente publicadas entram no dashboard');
    const m = modelPorId.get(a.id);
    assert.ok(m, 'avaliação publicada entra no modelo');
    assert.match(m.label, /^\dº tri\/\d{4}$/);
    assert.ok(m.titulo);
  }
  for(const r of raw.registros){
    assert.ok(ids.has(r.avaliacao_id), 'registro pertence a uma avaliação carregada');
    assert.ok(r.diretor, 'registro publicado tem diretor');
  }

  for(const a of model.avaliacoes){
    assert.ok(a.arquivoNome, 'nome real do arquivo disponível para exibição');
    assert.ok(a.ano && a.trimestre);
  }
});

test('sem avaliação publicada o modelo volta vazio (estado vazio informativo)', { skip }, async () => {
  // Contrato com listas vazias: a tela exibe o estado vazio, sem exceção.
  const model = buildDashboardModel({ avaliacoes: [], registros: [], periodos: [], indicadores: [] });
  assert.deepEqual(model.avaliacoes, []);
  assert.deepEqual(model.registros, []);
});

test('matriz histórica: colunas por período e caso Hesdras (tolerante a dados ausentes)', { skip }, async () => {
  const raw = await loadPublishedDashboard();
  const model = buildDashboardModel(raw);
  if(!model.registros.length) return; // banco vazio: nada a validar

  // Colunas de histórico vêm dos períodos reais, ordenadas
  const cols = matrixPeriodColumns(model.registros, model.avaliacoes);
  assert.ok(Array.isArray(cols));
  if(model.registros.some(r => (r.periodos || []).length)){
    assert.ok(cols.length > 0, 'há períodos → colunas de histórico');
  }

  // Caso Hesdras Viana: só valida se o registro existir neste banco
  const h = model.registros.find(r => norm(r.diretor) === 'HESDRAS VIANA');
  if(h){
    const labelMap = buildPeriodLabelMap(model.registros, model.avaliacoes);
    const labelOf = (r, p) => labelMap.get(`${r.avaliacaoId}|${p.rotulo}`);
    // Bloco final: leitura do registro (statusGestao/cicloVida/nivelAtual)
    assert.equal(h.statusGestao, 'Delegação I');
    assert.equal(h.cicloVida, 'Reposicionamento');
    assert.equal(h.nivelAtual, '(IV)');
    // Histórico: período SET/3TRI 2026 → estagio/nivel próprios
    const p = (h.periodos || []).find(x => labelOf(h, x) === 'SET/3TRI 2026');
    if(p){
      assert.equal(p.estagio, 'Gestão I');
      assert.equal(p.nivel, '(III)');
    }
    // Filtro por período + status/nível do histórico acha o registro
    const rows = filterMatrixRows(model.registros, { periodo:'SET/3TRI 2026', statusTrimestral:'Gestão I', nivel:'(III)' }, labelOf);
    assert.ok(rows.some(r => r.id === h.id), 'Hesdras casado pelos filtros da matriz');
  }
});

function norm(v){ return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim(); }
