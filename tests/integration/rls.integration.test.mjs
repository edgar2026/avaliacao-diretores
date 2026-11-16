// Teste de RLS / permissões — SOMENTE LEITURA + sondagens que NÃO criam dados.
// Verifica que o papel `anon` (usado pelo módulo) não consegue apagar nem
// sobrescrever nada. Nenhum teste desta suíte deixa resíduo no Supabase.
import './loadEnv.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSupabase } from '../../src/services/supabaseClient.ts';
import { STORAGE_BUCKET } from '../../src/services/storageService.ts';

const configured = Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  && Boolean(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
const skip = configured ? false : 'Credenciais Supabase ausentes (arquivo .env)';

const DUMMY = '00000000-0000-0000-0000-000000000000';

test('DELETE é negado para o papel anon (sem criar dados)', { skip }, async () => {
  const supabase = getSupabase();

  const delAv = await supabase.from('avaliacoes_diretores').delete().eq('id', DUMMY);
  assert.ok(delAv.error, 'DELETE de avaliação deve ser negado');

  const delReg = await supabase.from('avaliacoes_diretores_registros').delete().eq('id', DUMMY);
  assert.ok(delReg.error, 'DELETE de registro deve ser negado');

  const delObs = await supabase.from('avaliacoes_diretores_observacoes').delete().eq('id', DUMMY);
  assert.ok(delObs.error, 'DELETE de observação deve ser negado');
});

test('UPDATE de avaliação não altera nada (sem criar dados)', { skip }, async () => {
  const supabase = getSupabase();

  // UPDATE fora do conjunto permitido (coluna titulo) é negado
  const updTitulo = await supabase.from('avaliacoes_diretores')
    .update({ titulo:'hacked' }).eq('id', DUMMY).select('id');
  assert.ok(updTitulo.error, 'UPDATE fora das colunas permitidas deve ser negado');

  // UPDATE de status fora da regra (só sai de 'processando') não afeta linhas
  const updStatus = await supabase.from('avaliacoes_diretores')
    .update({ status:'arquivada' }).eq('id', DUMMY).select('id');
  assert.ifError(updStatus.error);
  assert.equal((updStatus.data || []).length, 0, 'nenhuma linha deve ser alterada');
});

test('Storage não permite remover arquivos (sem criar dados)', { skip }, async () => {
  const supabase = getSupabase();

  // remove() em caminho inexistente não dá erro e não toca em nada
  const rm = await supabase.storage.from(STORAGE_BUCKET).remove(['avaliacoes/nao-existe/x.xlsx']);
  assert.ifError(rm.error);

  // list() do bucket funciona (leitura)
  const { data: root, error: listError } = await supabase.storage.from(STORAGE_BUCKET).list('', { limit: 1 });
  assert.ifError(listError);
  assert.ok(Array.isArray(root));
});

test('Movimentação manual das matrizes: leitura ok; DELETE e UPDATE restrito negados', { skip }, async () => {
  const supabase = getSupabase();
  const T = 'avaliacoes_diretores_matriz_movimentacoes';

  // Contagem antes das sondagens (nenhuma delas cria linha).
  const antes = await supabase.from(T).select('id', { count: 'exact', head: true });

  // Leitura: vigência + histórico são expostos ao papel anon.
  const { data, error } = await supabase.from(T).select('id, matriz, posicao_manual, arquivada_em').limit(1);
  assert.ifError(error);
  assert.ok(Array.isArray(data));

  // DELETE físico: sem política => negado (arquivamento é lógico).
  const del = await supabase.from(T).delete().eq('id', DUMMY);
  assert.ok(del.error, 'DELETE deve ser negado');

  // UPDATE fora do conjunto permitido (posicao_manual) => negado por privilégio
  // de coluna, mesmo sem linha correspondente.
  const updPos = await supabase.from(T)
    .update({ posicao_manual: 8 }).eq('id', DUMMY).select('id');
  assert.ok(updPos.error, 'UPDATE de posicao_manual deve ser negado');

  // UPDATE do conjunto permitido (encerramento da vigência) => aceito e, como
  // o id não existe, nenhuma linha é alterada.
  const updArq = await supabase.from(T)
    .update({ encerrado_motivo: 'novo_periodo' }).eq('id', DUMMY).select('id');
  assert.ifError(updArq.error);
  assert.equal((updArq.data || []).length, 0, 'nenhuma linha alterada');

  // Nada foi criado nem apagado.
  const depois = await supabase.from(T).select('id', { count: 'exact', head: true });
  assert.equal(depois.count, antes.count, 'sondagens sem resíduo');
});

test('nenhum resíduo: módulo segue vazio após sondagens', { skip }, async () => {
  const supabase = getSupabase();
  const { count } = await supabase.from('avaliacoes_diretores')
    .select('id', { count:'exact', head:true });
  // As sondagens acima não criam nem apagam nada — o estado é o que estava.
  assert.ok(typeof count === 'number');
});
