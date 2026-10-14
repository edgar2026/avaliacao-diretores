import { getSupabase } from './supabaseClient.js';

const TABLE = 'avaliacoes_diretores';
const REGISTROS = 'avaliacoes_diretores_registros';
const PERIODOS = 'avaliacoes_diretores_periodos';
const INDICADORES = 'avaliacoes_diretores_indicadores';

const BATCH_SIZE = 500;

function fail(error, context){
  if(error) throw new Error(`${context}: ${error.message || error}`);
}

function chunks(items, size = BATCH_SIZE){
  const out = [];
  for(let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Consulta de duplicidade por hash (antes de importar)
// ---------------------------------------------------------------------------
export async function findAvaliacoesByHash(hash){
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('id, titulo, ano, trimestre, status, arquivo_hash, importado_em')
    .eq('arquivo_hash', hash);
  fail(error, 'Falha ao consultar o hash no Supabase');
  return data || [];
}

export function classifyHashDuplicates(existing, { ano, trimestre }){
  // Avaliações `erro` não bloqueiam nova tentativa do mesmo arquivo (retry é permitido);
  // `publicada` e `processando` no mesmo período bloqueiam o reenvio.
  const samePeriod = existing.filter(a =>
    Number(a.ano) === Number(ano) && Number(a.trimestre) === Number(trimestre) && a.status !== 'erro');
  const otherPeriod = existing.filter(a => !samePeriod.includes(a));
  return { blocked: samePeriod.length > 0, samePeriod, otherPeriod };
}

// ---------------------------------------------------------------------------
// Avaliação (cabeçalho da importação)
// ---------------------------------------------------------------------------
export async function createAvaliacao(row){
  const { data, error } = await getSupabase().from(TABLE).insert(row).select('id, status').single();
  fail(error, 'Falha ao criar a avaliação no Supabase');
  return data;
}

// UPDATE via RLS: se a linha não corresponder ao `using`, o PostgREST devolve
// 0 linhas sem erro — por isso sempre conferimos a representação retornada.
export async function updateArquivoInfo(id, patch){
  const { data, error } = await getSupabase().from(TABLE).update(patch).eq('id', id).select('id');
  fail(error, 'Falha ao registrar o arquivo da avaliação');
  if(!data || data.length === 0) throw new Error('Atualização do arquivo negada pelas regras de acesso (RLS).');
}

export async function publishAvaliacao(id, { totalRegistros, totalColunas }){
  const { data, error } = await getSupabase().from(TABLE).update({
    total_registros: totalRegistros,
    total_colunas: totalColunas,
    status: 'publicada',
    publicado_em: new Date().toISOString()
  }).eq('id', id).select('id, status');
  fail(error, 'Falha ao publicar a avaliação');
  if(!data || data.length === 0) throw new Error('Publicação negada pelas regras de acesso (RLS).');
  return data[0];
}

export async function markAvaliacaoErro(id, detalhe){
  try{
    const { error } = await getSupabase().from(TABLE).update({
      status: 'erro',
      erro_detalhe: String(detalhe || '').slice(0, 500)
    }).eq('id', id).select('id');
    if(error) throw new Error(error.message);
  }catch(err){
    // Melhor esforço: a falha original tem prioridade sobre a marcação de erro.
    console.warn('Não foi possível marcar a avaliação como erro:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Registros / Períodos / Indicadores (inserções em lote)
// ---------------------------------------------------------------------------
export async function insertRegistros(rows){
  for(const batch of chunks(rows)){
    const { error } = await getSupabase().from(REGISTROS).insert(batch);
    fail(error, 'Falha ao inserir os registros');
  }
  return rows.length;
}

export async function insertPeriodos(rows){
  for(const batch of chunks(rows)){
    const { error } = await getSupabase().from(PERIODOS).insert(batch);
    fail(error, 'Falha ao inserir os períodos');
  }
  return rows.length;
}

export async function insertIndicadores(rows){
  for(const batch of chunks(rows)){
    const { error } = await getSupabase().from(INDICADORES).insert(batch);
    fail(error, 'Falha ao inserir os indicadores');
  }
  return rows.length;
}
