import { getSupabase } from './supabaseClient.js';
import { romanLevel } from '../lib/dataParser.js';
import type { ValorVigente, OpcaoNivel, ResultadoValidacaoNivel, SalvarAjustePayload, RestaurarPayload, AplicarRestauracaoPayload } from '../types/ajustes';
import type { AjusteRow } from '../types/supabase';
import type { DashboardModel, Registro, Periodo } from '../types/modelo';
import type { Status, NivelAlgarismo, NivelRoman, StatusConhecido } from '../types/status';

// ---------------------------------------------------------------------------
// Ajustes manuais de STATUS (estágio) e NÍVEL por PERÍODO do diretor.
//
// O dado importado da planilha NUNCA é alterado: ele continua em
// avaliacoes_diretores_periodos (estagio, nivel) para consulta e auditoria.
// O ajuste fica nesta estrutura separada, vinculado a avaliacao_id,
// registro_id e periodo_id (identificadores reais, nunca só o nome do diretor).
//
// REGRA CENTRALIZADA DO VALOR VIGENTE (usada por resumo, último ponto do
// gráfico, tooltip e matriz — nunca duplicada em componentes):
//   * existe ajuste manual ATIVO para o período -> status_ajustado/nivel_ajustado;
//   * não existe ajuste                -> estagio/nivel importados.
// ---------------------------------------------------------------------------

const TABELA = 'avaliacoes_diretores_ajustes';
const PERIODOS = 'avaliacoes_diretores_periodos';

export const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V'];

// Escolha manual explícita por "sem informação". É um VALOR AJUSTADO válido
// (gravado como texto na coluna ajustada) — diferente de NÃO existir ajuste,
// caso em que vigora o valor importado. Assim o banco diferencia:
//   A) sem ajuste ativo            -> valor importado/cadastrado;
//   B) ajuste ativo = "Não informado" -> vigente "Não informado" (não volta
//      automaticamente ao importado; origem continua "Ajuste manual").
export const NAO_INFORMADO = 'Não informado';

const eNaoInformadoTexto = (v: unknown): boolean => {
  const n = String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
  return n === 'nao informado';
};

export const NIVEL_OPCOES: OpcaoNivel[] = [
  { valor: 'I', nivel: 1 },
  { valor: 'II', nivel: 2 },
  { valor: 'III', nivel: 3 },
  { valor: 'IV', nivel: 4 },
  { valor: 'V', nivel: 5 }
];

// Classificações de estágio usadas pelo sistema e pela planilha. A lista
// exibida no formulário é esta BASE + qualquer valor válido distinto que já
// exista nos períodos importados (nunca "Não informado", ciclo de vida,
// status de gestão da unidade, pareceres, aprovação ou indicadores).
export const STATUS_OPCOES_BASE: StatusConhecido[] = [
  'Acompanhamento',
  'Supervisão I',
  'Supervisão II',
  'Gestão I',
  'Gestão II',
  'Delegação I',
  'Delegação II',
  'Reposicionamento'
];

const txt = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const chave = (v: unknown): string => txt(v).toLocaleLowerCase('pt-BR');

/** Exibição do nível no mesmo formato importado da planilha: "III" -> "(III)". */
export function nivelExibicao(nivelRoman: number | string | null | undefined): string | null {
  return nivelRoman != null && ROMANOS[nivelRoman as number] ? `(${ROMANOS[nivelRoman as number]})` : null;
}

/**
 * Lista de Status do formulário: base do sistema + valores válidos distintos
 * já presentes nos períodos importados (verificação feita a cada carregamento
 * a partir do modelo atual, não uma lista fixa cega).
 */
export function opcoesStatus(estagiosImportados?: string[] | null): string[] {
  const mapa = new Map<string, string>();
  const add = (v: string) => { const t = txt(v); if(t && !mapa.has(chave(t))) mapa.set(chave(t), t); };
  for(const s of STATUS_OPCOES_BASE) add(s);
  for(const s of estagiosImportados || []){
    if(chave(s) === 'não informado') continue;
    add(s);
  }
  return [...mapa.values()];
}

/** Valida o Nível: I–V ou a escolha explícita "Não informado" (salvável).
 *  Vazio NUNCA vira I — erro explícito; "Não informado" não é falha. */
export function validarNivel(valor: unknown): ResultadoValidacaoNivel {
  if(eNaoInformadoTexto(valor)) return { valor: NAO_INFORMADO, nivel: null };
  const limpo = txt(valor).toUpperCase().replace(/[()\s]/g, '');
  const opcao = NIVEL_OPCOES.find((o) => o.valor === limpo);
  if(!opcao) throw new Error('Selecione um nível entre I e V.');
  return { valor: opcao.valor, nivel: opcao.nivel };
}

/** Valida o Status: obrigatório; aceita "Não informado" ou valor da lista. */
export function validarStatus(valor: unknown, opcoes?: string[] | null): Status {
  const limpo = txt(valor);
  if(!limpo) throw new Error('Selecione um status para o período.');
  if(eNaoInformadoTexto(limpo)) return NAO_INFORMADO;
  const lista = (opcoes || STATUS_OPCOES_BASE).map(txt);
  if(!lista.includes(limpo)) throw new Error('Selecione um status válido.');
  return limpo;
}

/**
 * REGRA CENTRALIZADA: valor VIGENTE de um período.
 * Entrada: linha crua do período (estagio/nivel importados) + ajuste ativo
 * (ou null). Saída preserva, separadamente, o original importado e o vigente.
 * O campo `ajustado` indica que o vigente é uma decisão manual.
 *
 * DIFERENCIA AUSÊNCIA DE AJUSTE × AJUSTE PARA "NÃO INFORMADO":
 *   A) sem ajuste ativo -> vigente = importado/cadastrado;
 *   B) ajuste ativo     -> vigente = valor AJUSTADO, mesmo quando a decisão
 *      manual foi "Não informado" (status gravado como texto "Não informado";
 *      nível com roman nulo). NUNCA `valor_manual ?? valor_importado`: um
 *      ajuste sem informação NÃO volta ao valor da planilha.
 */
export function valorVigente(periodo: Partial<Pick<Periodo, 'estagio' | 'nivel'>> | null | undefined, ajuste: Partial<AjusteRow> | null | undefined): ValorVigente {
  const statusOriginal = txt(periodo?.estagio);
  const nivelOriginal = romanLevel(periodo?.nivel);
  if(!ajuste || ajuste.arquivada_em){
    return {
      status: statusOriginal,
      nivel: nivelOriginal,
      statusOriginal,
      nivelOriginal,
      ajustado: false
    };
  }
  const statusAjustado = txt(ajuste.status_ajustado);
  const nivelAjustadoTxt = txt(ajuste.nivel_ajustado);
  return {
    status: statusAjustado || NAO_INFORMADO,
    // Nível ajustado: I–V -> número; "Não informado"/não reconhecido -> null
    // (sem informação vigente; o importado permanece só em nivelOriginal).
    nivel: eNaoInformadoTexto(nivelAjustadoTxt) ? null : romanLevel(nivelAjustadoTxt),
    statusOriginal,
    nivelOriginal,
    ajustado: true
  };
}

/**
 * Lê os ajustes manuais ATIVOS de todos os períodos (um por período). Usado no
 * carregamento do dashboard; em caso de falha o dashboard continua apenas com
 * o dado importado (o ajuste é uma camada adicional, nunca obrigatória).
 */
export async function listarAjustesAtivos(): Promise<AjusteRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABELA)
    .select('id, avaliacao_id, registro_id, periodo_id, status_original, nivel_original, status_ajustado, nivel_ajustado, arquivada_em, created_at, updated_at')
    .is('arquivada_em', null)
    .order('created_at', { ascending: true });
  if(error) throw new Error(error.message || 'Não foi possível carregar os ajustes manuais.');
  return (data || []) as unknown as AjusteRow[];
}

/**
 * Salva (cria ou atualiza) o ajuste manual do ÚLTIMO PERÍODO VÁLIDO.
 * O período NUNCA é escolhido pelo usuário: vem do resumo (periodoId), que já
 * aponta para o único período editável naquele momento. O valor original é
 * relido DIRETO do banco (fonte da verdade, jamais alterada) na primeira vez;
 * reeditar carrega os valores vigentes e atualiza a MESMA linha ativa.
 * Só retorna depois da confirmação real do banco (select da linha gravada).
 */
export async function salvarAjuste({ avaliacaoId, registroId, periodoId, statusAjustado, nivelAjustado, opcoes }: SalvarAjustePayload = {}): Promise<AjusteRow> {
  const status = validarStatus(statusAjustado, opcoes);
  const { valor: nivel } = validarNivel(nivelAjustado);
  const perId = txt(periodoId);
  if(!perId) throw new Error('Não foi possível identificar o período a editar.');
  const aval = txt(avaliacaoId);
  const reg = txt(registroId);
  if(!aval || !reg) throw new Error('Não foi possível identificar o registro do diretor.');

  const sb = getSupabase();

  // Original importado: lido do período (que o sistema de edição nunca altera).
  const { data: periodo, error: errPeriodo } = await sb
    .from(PERIODOS)
    .select('id, registro_id, estagio, nivel')
    .eq('id', perId)
    .maybeSingle();
  if(errPeriodo) throw new Error(errPeriodo.message || 'Não foi possível confirmar o período no sistema.');
  if(!periodo) throw new Error('O período selecionado não foi encontrado no sistema.');

  const agora = new Date().toISOString();

  // Já existe ajuste ATIVO para este período? -> atualiza a MESMA linha
  // (novo período não é criado; periodo_id e origem permanecem).
  const { data: existente, error: errAchou } = await sb
    .from(TABELA)
    .select('id, status_original, nivel_original')
    .eq('periodo_id', perId)
    .is('arquivada_em', null)
    .maybeSingle();
  if(errAchou) throw new Error(errAchou.message || 'Não foi possível consultar o ajuste do período.');

  if(existente){
    const { data, error } = await sb
      .from(TABELA)
      .update({ status_ajustado: status, nivel_ajustado: nivel, atualizado_por: null, updated_at: agora })
      .eq('id', (existente as { id: string }).id)
      .select()
      .single();
    if(error) throw new Error(error.message || 'Não foi possível atualizar o ajuste do período.');
    return data as unknown as AjusteRow;
  }

  const { data, error } = await sb
    .from(TABELA)
    .insert({
      avaliacao_id: aval,
      registro_id: reg,
      periodo_id: perId,
      status_original: txt((periodo as { estagio?: string | null }).estagio),
      nivel_original: ROMANOS[romanLevel((periodo as { nivel?: string | null }).nivel) ?? 0] || '',
      status_ajustado: status,
      nivel_ajustado: nivel,
      criado_por: null,
      atualizado_por: null
    })
    .select()
    .single();
  if(error) throw new Error(error.message || 'Não foi possível salvar o ajuste do período.');
  return data as unknown as AjusteRow;
}

/**
 * Reaplica (em memória) um ajuste JÁ CONFIRMADO pelo banco sobre o modelo
 * montado: resumo, último ponto do gráfico, tooltip e célula da matriz
 * atualizam na hora, sem recarregar a tela e sem outra requisição. O original
 * importado (estagioOriginal/nivelOriginal) permanece intacto; somente a
 * cópia vigente é atualizada. Ajuste para "Não informado" NUNCA cai de volta
 * ao valor importado (status vira "Não informado"; nível, null).
 */
export function aplicarAjusteNoModelo(model: DashboardModel | null | undefined, ajuste: Partial<AjusteRow> | null | undefined): DashboardModel | null | undefined {
  if(!model || !ajuste?.periodo_id || !ajuste?.registro_id) return model;
  const nivelAjustadoTxt = txt(ajuste.nivel_ajustado);
  const nivelRoman: NivelRoman | null = eNaoInformadoTexto(nivelAjustadoTxt) ? null : (romanLevel(nivelAjustadoTxt) as NivelRoman | null);
  const nivel = nivelExibicao(nivelRoman);
  const registros = (model.registros || []).map((r: Registro) => {
    if(r.id !== ajuste.registro_id) return r;
    const periodos = (r.periodos || []).map((p: Periodo) => {
      if(p.id !== ajuste.periodo_id) return p;
      return {
        ...p,
        estagio: txt(ajuste.status_ajustado) || NAO_INFORMADO,
        nivel: nivel ?? NAO_INFORMADO,
        nivelRoman,
        ajustado: true
      };
    });
    return { ...r, periodos };
  });
  return { ...model, registros };
}

/**
 * Restaura o valor IMPORTADO de um período: arquiva (logicamente) somente o
 * ajuste manual ativo daquele período. O dado original da planilha nunca é
 * alterado; a linha de ajuste permanece para auditoria, com arquivada_em.
 * Ação separada de "salvar Não informado": restaurar VOLTA ao importado;
 * "Não informado" é uma escolha manual vigente.
 */
export async function restaurarValorImportado({ periodoId }: RestaurarPayload = {}): Promise<{ id: string; registro_id: string; periodo_id: string }> {
  const perId = txt(periodoId);
  if(!perId) throw new Error('Não foi possível identificar o período a restaurar.');
  const sb = getSupabase();
  const { data: existente, error: errAchou } = await sb
    .from(TABELA)
    .select('id, registro_id, periodo_id')
    .eq('periodo_id', perId)
    .is('arquivada_em', null)
    .maybeSingle();
  if(errAchou) throw new Error(errAchou.message || 'Não foi possível consultar o ajuste do período.');
  if(!existente) throw new Error('Não existe ajuste manual ativo para este período.');
  const agora = new Date().toISOString();
  const { data, error } = await sb
    .from(TABELA)
    .update({ arquivada_em: agora, atualizado_por: null, updated_at: agora })
    .eq('id', (existente as { id: string }).id)
    .select('id, registro_id, periodo_id')
    .single();
  if(error) throw new Error(error.message || 'Não foi possível restaurar o valor importado.');
  return data as { id: string; registro_id: string; periodo_id: string };
}

/**
 * Reaplica (em memória) a restauração CONFIRMADA pelo banco: a cópia vigente
 * volta ao valor original importado; a origem deixa de ser "Ajuste manual".
 */
export function aplicarRestauracaoNoModelo(model: DashboardModel | null | undefined, { periodoId, registroId }: AplicarRestauracaoPayload = {}): DashboardModel | null | undefined {
  if(!model || !periodoId || !registroId) return model;
  const registros = (model.registros || []).map((r: Registro) => {
    if(r.id !== registroId) return r;
    const periodos = (r.periodos || []).map((p: Periodo) => {
      if(p.id !== periodoId) return p;
      return {
        ...p,
        estagio: p.estagioOriginal ?? '',
        nivel: nivelExibicao(p.nivelOriginal),
        nivelRoman: p.nivelOriginal ?? null,
        ajustado: false
      };
    });
    return { ...r, periodos };
  });
  return { ...model, registros };
}
