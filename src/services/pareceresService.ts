import { getSupabase } from './supabaseClient.js';
import { nameKey } from './dashboardService.js';
import type { ObservacaoRow } from '../types/supabase';
import type { TipoParecer, TipoParecerLabel, FiltroConsulta, ParecerPayload, ParecerFiltros } from '../types/pareceres';
import type { Registro } from '../types/modelo';

// ---------------------------------------------------------------------------
// Pareceres do diretor — reutiliza a tabela existente de observações
// (avaliacoes_diretores_observacoes): id, avaliacao_id, registro_id, regional,
// diretor, texto (coluna `observacao`), created_at, updated_at e arquivada_em.
// A migration 20261015100000 acrescenta somente a coluna `tipo`, que
// diferencia os dois pareceres exibidos no topo da tela.
//   * 'regional'  → primeiro card, exibido como "JUSTIFICATIVA"
//   * 'operacoes' → Parecer de Operações
//   * NULL        → observação comum do regional (linha legada, inalterada)
// O tipo INTERNO no banco permanece o mesmo ('regional'/'operacoes') — a
// mudança do primeiro card é somente visual/textual. Toda consulta e lista
// visível filtra `arquivada_em IS NULL`: exclusões lógicas nunca aparecem
// (nem no card nem no histórico) e continuam no banco apenas para auditoria.
// ---------------------------------------------------------------------------
const TABELA = 'avaliacoes_diretores_observacoes';
const ESCOPO_DIRETOR = 'diretor';

export const TIPOS_PARECER: TipoParecer[] = ['regional', 'operacoes'];
// Rótulo VISUAL do primeiro card ("regional" segue sendo o tipo INTERNO, sem
// migration): a tela mostra "JUSTIFICATIVA". O segundo card permanece
// "Parecer de Operações".
export const TIPO_LABEL: TipoParecerLabel = {
  regional: 'JUSTIFICATIVA',
  operacoes: 'Parecer de Operações'
};

const textoDe = (v: unknown): string => String(v ?? '').trim();

export function ehTipoParecer(tipo: unknown): tipo is TipoParecer {
  return TIPOS_PARECER.includes(tipo as TipoParecer);
}

/**
 * Valida um parecer antes de gravar. Regional, diretor, tipo e texto são
 * obrigatórios: sem eles não há vínculo nem conteúdo.
 */
export function validarParecer({ tipo, regional, diretor, texto }: ParecerPayload = {}): string {
  const conteudo = textoDe(texto);
  if(!ehTipoParecer(tipo)) throw new Error('Tipo de parecer inválido.');
  if(!conteudo) throw new Error('O texto do parecer não pode ficar vazio.');
  if(!textoDe(regional)) throw new Error('Selecione uma regional para registrar este conteúdo.');
  if(!textoDe(diretor)) throw new Error('Selecione um diretor para registrar este conteúdo.');
  return conteudo;
}

/**
 * Filtros da consulta: escopo do diretor + tipo do parecer + SEMPRE ativos
 * (`arquivada_em IS NULL` — registros excluídos logicamente nunca aparecem,
 * nem no card nem no histórico) + regional e diretor da seleção.
 * O vínculo (registro_id/avaliacao_id) é GRAVADO no parecer; a consulta não
 * trava por avaliação para que um parecer antigo continue visível quando uma
 * avaliação mais nova é publicada.
 */
export function parecerFiltros({ tipo, regional, diretor }: ParecerFiltros = {}): FiltroConsulta[] {
  return [
    { col: 'escopo', op: 'eq', valor: ESCOPO_DIRETOR },
    { col: 'tipo', op: 'eq', valor: tipo },
    { col: 'arquivada_em', op: 'is', valor: null },
    ...(textoDe(diretor) ? [{ col: 'diretor', op: 'eq' as const, valor: textoDe(diretor) }] : []),
    ...(textoDe(regional) ? [{ col: 'regional', op: 'eq' as const, valor: textoDe(regional) }] : [])
  ];
}

export interface ParecerPertenceOpts {
  regional?: string;
  diretor?: string;
  registros?: Registro[] | null;
}

/**
 * Guarda de PERTENCIMENTO (compartilhada pela lista e pelo histórico): parecer
 * do MESMO diretor, da mesma regional e com tipo válido. Quando o parecer tem
 * registro_id e esse registro existe, ele precisa pertencer ao diretor/
 * regional selecionados — pareceres de diretores diferentes nunca se misturam.
 */
export function parecerPertence(p: Partial<ObservacaoRow> | null | undefined, { regional, diretor, registros }: ParecerPertenceOpts = {}): boolean {
  if(!p) return false;
  if(!ehTipoParecer(p.tipo)) return false;
  if(!textoDe(diretor) || nameKey(p.diretor) !== nameKey(diretor)) return false;
  if(textoDe(regional) && nameKey(p.regional) !== nameKey(regional)) return false;
  if(p.registro_id && Array.isArray(registros) && registros.length){
    const dono = registros.find((r) => r?.id === p.registro_id);
    if(dono){
      if(nameKey(dono.diretor) !== nameKey(diretor)) return false;
      if(textoDe(regional) && nameKey(dono.regional) !== nameKey(regional)) return false;
    }
  }
  return true;
}

/**
 * Guarda de EXIBIÇÃO do card e do histórico (defesa extra no cliente): o
 * parecer precisa pertencer à seleção E não pode estar arquivado (excluído).
 * Registros com `arquivada_em` preenchido nunca aparecem em nenhuma lista —
 * continuam no banco apenas para auditoria.
 */
export function parecerVisivel(p: Partial<ObservacaoRow> | null | undefined, opts: ParecerPertenceOpts = {}): boolean {
  return Boolean(p) && !p?.arquivada_em && parecerPertence(p, opts);
}

/** O mais recente (lista já ordenada por created_at desc) ou null. */
export function parecerMaisRecente<T>(lista: T[] | null | undefined): T | null {
  return Array.isArray(lista) && lista.length ? lista[0] : null;
}

/** true quando a linha foi editada depois de criada (mostra updated_at). */
export function parecerEditado(p: Partial<ObservacaoRow> | null | undefined): boolean {
  if(!p?.created_at || !p?.updated_at) return false;
  const c = Date.parse(p.created_at), u = Date.parse(p.updated_at);
  if(Number.isNaN(c) || Number.isNaN(u)) return false;
  return Math.abs(u - c) > 1000;
}

/**
 * Lista os pareceres ATIVOS de um tipo para o diretor selecionado, da mais
 * recente para a mais antiga (`created_at` desc). Sem diretor não há consulta.
 * O filtro `arquivada_em IS NULL` é aplicado NA CONSULTA e de novo no cliente
 * (parecerVisivel): excluídos logicamente nunca aparecem no card nem no
 * histórico — o registro permanece no banco apenas para auditoria.
 */
export async function listPareceres({ tipo, regional, diretor, registros }: ParecerFiltros = {}): Promise<ObservacaoRow[]> {
  if(!textoDe(diretor)) return [];
  if(!ehTipoParecer(tipo)) throw new Error('Tipo de parecer inválido.');
  const sb = getSupabase();
  const filtros = parecerFiltros({ tipo, regional, diretor });
  let q = sb.from(TABELA).select('*');
  for(const f of filtros) q = f.op === 'is' ? q.is(f.col, f.valor) : q.eq(f.col, f.valor);
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .order('updated_at', { ascending: false });
  if(error) throw new Error(error.message || 'Não foi possível carregar os pareceres.');
  return ((data || []) as unknown as ObservacaoRow[]).filter((p) => parecerVisivel(p, { regional, diretor, registros }));
}

/**
 * Cria um NOVO parecer (nunca substitui o anterior): o anterior permanece no
 * histórico e este passa a ser o mais recente. Vínculo por avaliacao_id +
 * registro_id da avaliação em que o diretor tem registro.
 */
export async function createParecer({ avaliacaoId, registroId, regional, diretor, tipo, texto }: ParecerPayload = {}): Promise<ObservacaoRow> {
  const conteudo = validarParecer({ tipo, regional, diretor, texto });
  if(!textoDe(avaliacaoId)) throw new Error('Não foi possível identificar a avaliação do diretor selecionado.');
  const sb = getSupabase();
  const row = {
    avaliacao_id: textoDe(avaliacaoId),
    registro_id: registroId ? textoDe(registroId) : null,
    escopo: ESCOPO_DIRETOR,
    regional: textoDe(regional),
    diretor: textoDe(diretor),
    tipo,
    observacao: conteudo,
    criado_por: null,
    atualizado_por: null
  };
  const { data, error } = await sb.from(TABELA).insert(row).select().single();
  if(error) throw new Error(error.message || 'Não foi possível salvar o parecer.');
  return data as unknown as ObservacaoRow;
}

export interface UpdateParecerPayload {
  id?: string;
  texto?: string;
}

/**
 * Edita SOMENTE o parecer selecionado: apenas o texto muda (diretor,
 * avaliação, registro e tipo permanecem) e `updated_at` é atualizado.
 */
export async function updateParecer({ id, texto }: UpdateParecerPayload = {}): Promise<ObservacaoRow> {
  const conteudo = textoDe(texto);
  if(!id) throw new Error('Parecer inválido para edição.');
  if(!conteudo) throw new Error('O texto do parecer não pode ficar vazio.');
  const sb = getSupabase();
  const { data, error } = await sb.from(TABELA)
    .update({ observacao: conteudo, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if(error) throw new Error(error.message || 'Não foi possível atualizar o parecer.');
  return data as unknown as ObservacaoRow;
}

/**
 * Exclusão lógica: preenche `arquivada_em` (o DELETE físico não tem política
 * no RLS e permanece bloqueado). Os demais pareceres ficam intactos — ao
 * excluir o mais recente, o anterior volta a aparecer automaticamente.
 */
export async function archiveParecer(id: string): Promise<ObservacaoRow> {
  if(!id) throw new Error('Parecer inválido para exclusão.');
  const sb = getSupabase();
  const { data, error } = await sb.from(TABELA)
    .update({ arquivada_em: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if(error) throw new Error(error.message || 'Não foi possível excluir o parecer.');
  return data as unknown as ObservacaoRow;
}
