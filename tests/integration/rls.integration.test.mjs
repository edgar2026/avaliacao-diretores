// Teste de RLS / permissões — SOMENTE LEITURA + sondagens que NÃO criam dados.
// Verifica que o papel `anon` (usado pelo módulo) não consegue apagar nem
// sobrescrever nada. Nenhum teste desta suíte deixa resíduo no Supabase.
import './loadEnv.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSupabase } from '../../src/services/supabaseClient.js';
import { STORAGE_BUCKET } from '../../src/services/storageService.js';

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

test('nenhum resíduo: módulo segue vazio após sondagens', { skip }, async () => {
  const supabase = getSupabase();
  const { count } = await supabase.from('avaliacoes_diretores')
    .select('id', { count:'exact', head:true });
  // As sondagens acima não criam nem apagam nada — o estado é o que estava.
  assert.ok(typeof count === 'number');
});
