import { getSupabase } from './supabaseClient.js';
import { nameKey } from './dashboardService.js';

const TABELA = 'avaliacoes_diretores_observacoes';
// Regra do módulo: a observação do regional é INDIVIDUAL — sempre vinculada
// ao diretor selecionado (escopo 'diretor'). Não existe gravação por regional
// nem observação geral pelo frontend.
const ESCOPO_DIRETOR = 'diretor';

const textoDe = (v) => String(v ?? '').trim();

/**
 * Valida os dados mínimos de uma observação individual e devolve o texto
 * limpo. Regional e diretor são obrigatórios: sem ambos não há vínculo.
 */
export function validarObservacao({ regional, diretor, observacao } = {}){
  const texto = textoDe(observacao);
  if(!texto) throw new Error('A observação não pode ficar vazia.');
  if(!textoDe(regional)) throw new Error('Selecione uma regional para registrar uma observação.');
  if(!textoDe(diretor)) throw new Error('Selecione um diretor para registrar uma observação.');
  return texto;
}

/**
 * Localiza o vínculo da observação: avaliação + registro do diretor dentro da
 * regional selecionada. Percorre as avaliações da MAIS RECENTE para a mais
 * antiga e devolve o primeiro registro do par regional+diretor. Sem registro
 * não há vínculo individualizável (retorna null).
 */
export function resolveObservacaoVinculo(registros, avaliacoes, { regional, diretor } = {}){
  const rk = nameKey(regional);
  const dk = nameKey(diretor);
  if(!rk || !dk) return null;
  const lista = registros || [];
  const ordenadas = avaliacoes || [];
  for(let i = ordenadas.length - 1; i >= 0; i--){
    const avaliacaoId = ordenadas[i]?.id;
    if(!avaliacaoId) continue;
    const registro = lista.find((r) => r?.avaliacaoId === avaliacaoId
      && nameKey(r?.regional) === rk && nameKey(r?.diretor) === dk);
    if(registro) return { avaliacaoId, registroId: registro.id || null, regional, diretor };
  }
  return null;
}

/**
 * Filtros da consulta (prioridade): registro_id → avaliacao_id → escopo
 * 'diretor' → não arquivadas → SEM tipo (pareceres ficam fora da lista de
 * observações: `tipo` só é preenchido por Parecer do Regional/Operações);
 * regional e diretor confirmam a seleção atual.
 * Nunca consulta somente pela regional.
 */
export function observacaoFiltros({ registroId, avaliacaoId, regional, diretor } = {}){
  const filtros = [
    { col: 'escopo', op: 'eq', valor: ESCOPO_DIRETOR },
    { col: 'tipo', op: 'is', valor: null },
    { col: 'arquivada_em', op: 'is', valor: null }
  ];
  if(textoDe(diretor)) filtros.push({ col: 'diretor', op: 'eq', valor: textoDe(diretor) });
  if(textoDe(regional)) filtros.push({ col: 'regional', op: 'eq', valor: textoDe(regional) });
  if(textoDe(avaliacaoId)) filtros.push({ col: 'avaliacao_id', op: 'eq', valor: textoDe(avaliacaoId) });
  if(textoDe(registroId)) filtros.push({ col: 'registro_id', op: 'eq', valor: textoDe(registroId) });
  return filtros;
}

/**
 * Guarda de exibição: só aparece observação individual (escopo 'diretor'),
 * não arquivada, SEM tipo (pareceres regional/operacoes nunca entram na
 * lista de observações), do MESMO diretor, da mesma regional e da mesma
 * avaliação. Observações de outro diretor, de outra regional, de outra
 * avaliação, de escopo regional/geral ou arquivadas nunca são exibidas.
 */
export function observacaoVisivel(obs, { registroId, avaliacaoId, regional, diretor } = {}){
  if(!obs || obs.arquivada_em) return false;
  if(obs.escopo !== ESCOPO_DIRETOR) return false;
  if(obs.tipo != null) return false;
  if(!textoDe(diretor) || nameKey(obs.diretor) !== nameKey(diretor)) return false;
  if(textoDe(regional) && nameKey(obs.regional) !== nameKey(regional)) return false;
  if(registroId && obs.registro_id && obs.registro_id !== registroId) return false;
  if(avaliacaoId && obs.avaliacao_id && obs.avaliacao_id !== avaliacaoId) return false;
  return true;
}

/** Data/horário em pt-BR para os cartões da lista. */
export function formatarDataHora(iso){
  const d = iso ? new Date(iso) : null;
  if(!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

/**
 * Cria uma observação individual (escopo 'diretor') vinculada ao diretor e à
 * avaliação selecionados. Aguarda a confirmação real (select da linha
 * inserida) antes de retornar. `criado_por`/`atualizado_por` ficam NULL
 * (sem login). Campos: avaliacao_id, registro_id, escopo, regional, diretor,
 * observacao.
 */
export async function createObservacao({ avaliacaoId, registroId, regional, diretor, observacao } = {}){
  const texto = validarObservacao({ regional, diretor, observacao });
  if(!textoDe(avaliacaoId)) throw new Error('Não foi possível identificar a avaliação do diretor selecionado.');
  const sb = getSupabase();
  const row = {
    avaliacao_id: textoDe(avaliacaoId),
    registro_id: registroId ? textoDe(registroId) : null,
    escopo: ESCOPO_DIRETOR,
    regional: textoDe(regional),
    diretor: textoDe(diretor),
    observacao: texto,
    criado_por: null,
    atualizado_por: null
  };
  const { data, error } = await sb.from(TABELA).insert(row).select().single();
  if(error) throw new Error(error.message || 'Não foi possível salvar a observação.');
  return data;
}

/**
 * Lista as observações individuais da seleção atual (diretor + regional +
 * avaliação + registro quando disponível), não arquivadas, da mais recente
 * para a mais antiga. Um diretor nunca vê observações de outro diretor.
 */
export async function listObservacoesDiretor({ registroId, avaliacaoId, diretor, regional } = {}){
  if(!textoDe(diretor)) return [];
  const sb = getSupabase();
  const filtros = observacaoFiltros({ registroId, avaliacaoId, diretor, regional });
  let q = sb.from(TABELA).select('*');
  for(const f of filtros) q = f.op === 'is' ? q.is(f.col, f.valor) : q.eq(f.col, f.valor);
  const { data, error } = await q.order('created_at', { ascending: false });
  if(error) throw new Error(error.message || 'Não foi possível carregar as observações.');
  const selecao = { registroId, avaliacaoId, diretor, regional };
  return (data || []).filter((o) => observacaoVisivel(o, selecao));
}

/**
 * Atualiza o TEXTO de uma observação existente (edição). Preenche
 * updated_at. Não cria novo registro e NÃO altera o vínculo (avaliacao_id,
 * registro_id, escopo, regional e diretor permanecem).
 */
export async function updateObservacao({ id, observacao } = {}){
  const texto = String(observacao ?? '').trim();
  if(!texto) throw new Error('A observação não pode ficar vazia.');
  const sb = getSupabase();
  const { data, error } = await sb.from(TABELA)
    .update({ observacao: texto, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if(error) throw new Error(error.message || 'Não foi possível atualizar a observação.');
  return data;
}

/**
 * Exclusão lógica: preenche arquivada_em. Não apaga fisicamente (o DELETE
 * físico não tem política no RLS e permanece bloqueado).
 */
export async function archiveObservacao(id){
  const sb = getSupabase();
  const { data, error } = await sb.from(TABELA)
    .update({ arquivada_em: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if(error) throw new Error(error.message || 'Não foi possível excluir a observação.');
  return data;
}
