import { getSupabase } from './supabaseClient.js';
import { loadPublishedDashboard, buildDashboardModel } from './dashboardService.js';
import type { AvaliacaoRow } from '../types/supabase';
import type { DashboardModel } from '../types/modelo';

const TABLE = 'avaliacoes_diretores';
const REGISTROS = 'avaliacoes_diretores_registros';
const PERIODOS = 'avaliacoes_diretores_periodos';
const INDICADORES = 'avaliacoes_diretores_indicadores';

const BATCH_SIZE = 500;

function fail(error: { message?: string } | null | undefined, context: string): void {
  if(error) throw new Error(`${context}: ${error.message || error}`);
}

function chunks<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for(let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface AvaliacaoHashInfo {
  id: string;
  titulo?: string | null;
  ano: number;
  trimestre: number;
  status?: string | null;
  arquivo_hash?: string | null;
  importado_em?: string | null;
}

export interface HashDuplicates {
  blocked: boolean;
  samePeriod: AvaliacaoHashInfo[];
  otherPeriod: AvaliacaoHashInfo[];
}

// ---------------------------------------------------------------------------
// Consulta de duplicidade por hash (antes de importar)
// ---------------------------------------------------------------------------
export async function findAvaliacoesByHash(hash: string): Promise<AvaliacaoHashInfo[]> {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('id, titulo, ano, trimestre, status, arquivo_hash, importado_em')
    .eq('arquivo_hash', hash);
  fail(error, 'Falha ao consultar o hash no Supabase');
  return (data || []) as unknown as AvaliacaoHashInfo[];
}

export function classifyHashDuplicates(existing: AvaliacaoHashInfo[], { ano, trimestre }: { ano: number | string; trimestre: number | string }): HashDuplicates {
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
export async function createAvaliacao(row: Record<string, unknown>): Promise<{ id: string; status?: string | null }> {
  const { data, error } = await getSupabase().from(TABLE).insert(row).select('id, status').single();
  fail(error, 'Falha ao criar a avaliação no Supabase');
  return data as { id: string; status?: string | null };
}

// UPDATE via RLS: se a linha não corresponder ao `using`, o PostgREST devolve
// 0 linhas sem erro — por isso sempre conferimos a representação retornada.
export async function updateArquivoInfo(id: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await getSupabase().from(TABLE).update(patch).eq('id', id).select('id');
  fail(error, 'Falha ao registrar o arquivo da avaliação');
  if(!data || data.length === 0) throw new Error('Atualização do arquivo negada pelas regras de acesso (RLS).');
}

export async function publishAvaliacao(id: string, { totalRegistros, totalColunas }: { totalRegistros: number; totalColunas: number }): Promise<{ id: string; status?: string | null }> {
  const { data, error } = await getSupabase().from(TABLE).update({
    total_registros: totalRegistros,
    total_colunas: totalColunas,
    status: 'publicada',
    publicado_em: new Date().toISOString()
  }).eq('id', id).select('id, status');
  fail(error, 'Falha ao publicar a avaliação');
  if(!data || data.length === 0) throw new Error('Publicação negada pelas regras de acesso (RLS).');
  return data[0] as { id: string; status?: string | null };
}

export async function markAvaliacaoErro(id: string, detalhe: unknown): Promise<void> {
  try{
    const { error } = await getSupabase().from(TABLE).update({
      status: 'erro',
      erro_detalhe: String(detalhe || '').slice(0, 500)
    }).eq('id', id).select('id');
    if(error) throw new Error(error.message);
  }catch(err){
    // Melhor esforço: a falha original tem prioridade sobre a marcação de erro.
    console.warn('Não foi possível marcar a avaliação como erro:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Registros / Períodos / Indicadores (inserções em lote)
// ---------------------------------------------------------------------------
export async function insertRegistros(rows: Record<string, unknown>[]): Promise<number> {
  for(const batch of chunks(rows)){
    const { error } = await getSupabase().from(REGISTROS).insert(batch);
    fail(error, 'Falha ao inserir os registros');
  }
  return rows.length;
}

export async function insertPeriodos(rows: Record<string, unknown>[]): Promise<number> {
  for(const batch of chunks(rows)){
    const { error } = await getSupabase().from(PERIODOS).insert(batch);
    fail(error, 'Falha ao inserir os períodos');
  }
  return rows.length;
}

export async function insertIndicadores(rows: Record<string, unknown>[]): Promise<number> {
  for(const batch of chunks(rows)){
    const { error } = await getSupabase().from(INDICADORES).insert(batch);
    fail(error, 'Falha ao inserir os indicadores');
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// REGRA DEFINITIVA DE IMPORTAÇÃO — base fresca + gravação incremental
// (identidade Diretor+Unidade; ver src/services/importPlan.js)
// ---------------------------------------------------------------------------

/**
 * Estado ATUAL do sistema no formato do plano de importação: lido DIRETO do
 * banco no momento da gravação (a prévia usa o model em memória pela mesma
 * função pura). Somente avaliações publicadas — o mesmo recorte dos dashboards
 * (resíduos de importações `erro` ficam fora e não participam do vínculo).
 */
export async function carregarBaseImportacao(): Promise<Pick<DashboardModel, 'avaliacoes' | 'registros' | 'registrosArquivados' | 'ajustesIndicadores'>> {
  const raw = await loadPublishedDashboard();
  const model = buildDashboardModel(raw);
  return {
    avaliacoes: model.avaliacoes,
    registros: model.registros,
    registrosArquivados: model.registrosArquivados || [],
    ajustesIndicadores: model.ajustesIndicadores
  };
}

/**
 * Atualiza UM período (completar estagio/nivel vazio ou ajustar `ordem`).
 * A coluna-granted + trigger do banco garantem: valor já preenchido nunca é
 * sobreescrito; rotulo_periodo/registro_id não mudam.
 */
export async function updatePeriodo(id: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await getSupabase().from(PERIODOS).update(patch).eq('id', id).select('id');
  fail(error, 'Falha ao atualizar o período');
  if(!data || data.length === 0){
    throw new Error('Atualização do período negada pelas regras de acesso (RLS).');
  }
}

/** Atualiza os valores importados de UM indicador (prioridade manual fica na camada de ajustes). */
export async function updateIndicador(id: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await getSupabase().from(INDICADORES).update(patch).eq('id', id).select('id');
  fail(error, 'Falha ao atualizar o indicador');
  if(!data || data.length === 0){
    throw new Error('Atualização do indicador negada pelas regras de acesso (RLS).');
  }
}

export interface RegistroPatch {
  id: string;
  patch: Record<string, unknown>;
}

/**
 * Atualiza registros reutilizados/arquivados/reativados em LOTE: patches
 * idênticos são agrupados em uma única requisição (`in`). Cada grupo confere
 * a quantidade de linhas devolvidas — diferença = RLS negando.
 */
export async function updateRegistrosEmLote(patches: RegistroPatch[]): Promise<number> {
  const grupos = new Map<string, { patch: Record<string, unknown>; ids: string[] }>();
  for(const item of patches || []){
    if(!item?.id || !item.patch) continue;
    const chave = JSON.stringify(item.patch);
    if(!grupos.has(chave)) grupos.set(chave, { patch: item.patch, ids: [] });
    grupos.get(chave)!.ids.push(item.id);
  }
  for(const { patch, ids } of grupos.values()){
    const { data, error } = await getSupabase().from(REGISTROS).update(patch).in('id', ids).select('id');
    fail(error, 'Falha ao atualizar os registros');
    if(!data || data.length !== ids.length){
      throw new Error('Atualização de registros negada pelas regras de acesso (RLS).');
    }
  }
  return patches?.length || 0;
}
