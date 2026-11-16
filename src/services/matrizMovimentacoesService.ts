import { getSupabase } from './supabaseClient.ts';
import {
  ROTULO_AGUARDANDO,
  indiceNinebox,
  indiceRiscoDano,
  normalizarChave,
  obterUltimoPeriodoValido,
  periodosClassificacaoDoDiretor
} from './classificacaoMatrizService.ts';
import type { DetalheClassificacaoDiretor } from './classificacaoMatrizService.ts';
import type { MovimentacaoMatrizRow } from '../types/supabase';
import type { Registro } from '../types/modelo';

// ---------------------------------------------------------------------------
// POSIÇÃO MANUAL DAS MATRIZES (NINEBOX E RISCO × DANO) COM VIGÊNCIA POR PERÍODO
//
// A classificação AUTOMÁTICA continua morando no motor aprovado
// (classificacaoMatrizService.ts) — este serviço NÃO altera nenhuma regra.
// Aqui vive somente a camada MANUAL:
//   * posição automática calculada      -> nunca é apagada (continua no motor);
//   * posição manual                    -> gravada em
//     avaliacoes_diretores_matriz_movimentacoes (UMA linha por arraste);
//   * posição VIGENTE                   -> calculada em tempo de leitura:
//     há movimentação ativa E o período de referência dela ainda é o ÚLTIMO
//     PERÍODO VÁLIDO do diretor? sim -> manual; não -> automática;
//   * histórico                         -> linhas arquivadas nunca são apagadas.
//
// REGRA DE VIGÊNCIA (mesma para as duas matrizes, cada uma com a sua):
//   * MESMO período (upload repetido, filtro trocado, página atualizada,
//     campos vazios completados, Status/Nível alterados): a posição manual
//     permanece — só a automática é recalculada;
//   * período CRONOLÓGICAMENTE POSTERIOR (upload de planilha OU cadastro
//     manual): a vigência manual anterior termina (fica só no histórico) e a
//     nova automática passa a valer; a manual não é transportada;
//   * repetição da MESMA referência não é período novo (não encerra nada).
//
// As duas matrizes são INDEPENDENTES: `matriz` participa do índice único —
// movimentação na Ninebox nunca altera a Risco × Dano (e vice-versa).
// ---------------------------------------------------------------------------

const TABELA = 'avaliacoes_diretores_matriz_movimentacoes';

export type TipoMatriz = 'ninebox' | 'risk';

/** Origem de toda linha desta tabela: decisão manual (nunca automática). */
export const ORIGEM_MANUAL = 'manual';
/** Vigência encerrada porque surgiu período cronologicamente posterior. */
export const MOTIVO_NOVO_PERIODO = 'novo_periodo';
/** Vigência encerrada por outro arraste no MESMO período. */
export const MOTIVO_SUBSTITUIDA = 'substituida';

/** Grade aprovada: Ninebox 9 células (0..8), Risco × Dano 16 (0..15). */
const CELULAS: Record<TipoMatriz, number> = { ninebox: 9, risk: 16 };

const COLUNAS_SELECT =
  'id, avaliacao_id, registro_id, periodo_id, matriz, diretor, diretor_chave, referencia, ' +
  'periodo_ano, periodo_mes, status_usado, nivel_usado, posicao_automatica, posicao_anterior, ' +
  'posicao_manual, origem, encerrado_motivo, arquivada_em, created_at, updated_at';

const txt = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Período de referência do CÁLCULO de UM diretor: o último período válido
 * (Status e Nível do MESMO período) com sua cronologia (mês/ano) — é a chave
 * da vigência da posição manual.
 */
export interface ReferenciaPeriodo {
  periodoId: string | null;
  registroId: string | null;
  /** Rótulo + origem do valor usado (ex.: "SET/3TRI 2026 · Valor importado"). */
  referencia: string | null;
  ano: number | null;
  mes: number | null;
  status: string | null;
  nivel: string | null;
}

/** Origem da posição exibida de um diretor em UMA matriz (identificação discreta). */
export interface InfoOrigem {
  origem: 'automatica' | 'manual';
  /** Linha(s) de tooltip: "Automática" ou "Alterada manualmente" + detalhes. */
  origemDetalhe: string;
}

/**
 * Referência do último período válido de TODOS os diretor da base COMPLETA
 * (`model.registros`, sem filtro lateral): a vigência da posição manual não
 * pode depender do filtro ativo — trocar Regional/Diretor nunca encerra uma
 * vigência nem cria outra.
 */
export function montarReferenciasPeriodo(
  registros: readonly Registro[] | null | undefined,
  avaliacoes: readonly { id: string }[] | null | undefined
): Map<string, ReferenciaPeriodo> {
  const porNome = new Map<string, Registro[]>();
  for (const r of registros || []) {
    if (!r || r.arquivado) continue;
    const k = normalizarChave(r.diretor);
    if (!k) continue;
    const lista = porNome.get(k);
    if (lista) lista.push(r);
    else porNome.set(k, [r]);
  }

  const refs = new Map<string, ReferenciaPeriodo>();
  for (const [k, lista] of porNome) {
    const entradas = periodosClassificacaoDoDiretor(lista, avaliacoes);
    const ultimo = obterUltimoPeriodoValido(entradas);
    if (!ultimo) continue;
    const entrada = entradas.find((e) => !!e.id && e.id === ultimo.periodoId) || null;
    refs.set(k, {
      periodoId: ultimo.periodoId,
      registroId: ultimo.registroId,
      referencia: ultimo.referencia,
      ano: entrada?.tempo?.ano ?? null,
      mes: entrada?.tempo?.mes ?? null,
      status: ultimo.status,
      nivel: ultimo.nivel
    });
  }
  return refs;
}

/**
 * O período gravado numa movimentação É o período de referência atual?
 * Comparação por mês/ano quando os dois lados têm cronologia reconhecida
 * (mesma referência repetida = mesmo período, nunca "período novo"); senão,
 * por identificador real do período.
 */
export function mesmoPeriodo(
  periodo:
    | { periodo_id?: string | null; periodo_ano?: number | null; periodo_mes?: number | null }
    | null
    | undefined,
  referencia: ReferenciaPeriodo | null | undefined
): boolean {
  if (!periodo || !referencia) return false;
  const aTem = Number.isFinite(periodo.periodo_ano) && Number.isFinite(periodo.periodo_mes);
  const bTem = referencia.ano != null && referencia.mes != null;
  if (aTem && bTem) return periodo.periodo_ano === referencia.ano && periodo.periodo_mes === referencia.mes;
  return !!periodo.periodo_id && periodo.periodo_id === referencia.periodoId;
}

/**
 * REGRA DA VIGÊNCIA: movimentação manual vale quando está ATIVA (não
 * arquivada) e o período de referência dela ainda é o último período do
 * diretor. Período posterior encerra a vigência; a linha permanece no
 * histórico (nunca é apagada).
 */
export function movimentoVigente(
  movimento: MovimentacaoMatrizRow | null | undefined,
  referencia: ReferenciaPeriodo | null | undefined
): boolean {
  if (!movimento || movimento.arquivada_em) return false;
  return mesmoPeriodo(movimento, referencia);
}

/** Motivo do encerramento da vigência: mesmo período => substituída; senão => novo período. */
export function motivoEncerramento(
  anterior: { periodo_id?: string | null; periodo_ano?: number | null; periodo_mes?: number | null } | null | undefined,
  referencia: ReferenciaPeriodo | null | undefined
): string {
  return mesmoPeriodo(anterior, referencia) ? MOTIVO_SUBSTITUIDA : MOTIVO_NOVO_PERIODO;
}

/** Posição AUTOMÁTICA (índice na grade) do último período; null = aguardando. */
export function posicaoAutomaticaDoDiretor(
  det: DetalheClassificacaoDiretor | null | undefined,
  matriz: TipoMatriz
): number | null {
  if (!det) return null;
  return matriz === 'ninebox' ? indiceNinebox(det.ninebox) : indiceRiscoDano(det.risco);
}

/**
 * Aplica as posições manuais VIGENTES sobre a distribuição automática — UMA
 * matriz por vez, sem tocar na outra. Quem tem movimentação vigente sai de
 * todas as células (a automática pode ter mudado no período) e entra na célula
 * manual. Diretores sem movimentação vigente permanecem exatamente onde o
 * motor os colocou.
 */
export function aplicarMovimentos<T extends { id: string; name: string }>(
  ninebox: readonly (readonly T[])[],
  risk: readonly (readonly T[])[],
  movimentos: readonly MovimentacaoMatrizRow[] | null | undefined,
  referencias: ReadonlyMap<string, ReferenciaPeriodo>
): { ninebox: T[][]; risk: T[][] } {
  const aplicar = (celulas: readonly (readonly T[])[], matriz: TipoMatriz): T[][] => {
    const copia = celulas.map((c) => [...c]);
    for (const mov of movimentos || []) {
      if (!mov || mov.matriz !== matriz) continue;
      if (!movimentoVigente(mov, referencias.get(normalizarChave(mov.diretor_chave)))) continue;
      const chave = normalizarChave(mov.diretor_chave);
      let achado: T | null = null;
      for (const cel of copia) {
        const i = cel.findIndex((p) => normalizarChave(p.name) === chave);
        if (i >= 0) {
          achado = cel.splice(i, 1)[0];
          break;
        }
      }
      const destino = copia[mov.posicao_manual];
      if (achado && destino) destino.push(achado);
    }
    return copia;
  };
  return { ninebox: aplicar(ninebox, 'ninebox'), risk: aplicar(risk, 'risk') };
}

// Rótulo da posição AUTOMÁTICA exibida no tooltip (nunca inventa: vem do motor
// ou do próprio rótulo "Aguardando classificação").
function rotuloAutomatico(matriz: TipoMatriz, det: DetalheClassificacaoDiretor | undefined): string {
  if (matriz === 'ninebox') return det?.ninebox?.aplicavel ? det.ninebox.quadrante : ROTULO_AGUARDANDO;
  return det?.risco?.aplicavel ? det.risco.celula : ROTULO_AGUARDANDO;
}

/**
 * Identificação DISCRETA da origem por célula (sem alterar o visual): cada
 * diretor ganha `origem` ('automatica' | 'manual') e uma linha de tooltip com
 * a posição automática calculada, a posição manual vigente e o período da
 * decisão. `rotulo` converte o índice da célula no rótulo aprovado da grade.
 */
export function marcarOrigens<T extends { id: string; name: string }>(
  celulas: readonly (readonly T[])[],
  matriz: TipoMatriz,
  movimentos: readonly MovimentacaoMatrizRow[] | null | undefined,
  referencias: ReadonlyMap<string, ReferenciaPeriodo>,
  detalhes: ReadonlyMap<string, DetalheClassificacaoDiretor>,
  rotulo: (matriz: TipoMatriz, index: number) => string
): (T & InfoOrigem)[][] {
  const vigentes = new Map<string, MovimentacaoMatrizRow>();
  for (const mov of movimentos || []) {
    if (!mov || mov.matriz !== matriz) continue;
    const chave = normalizarChave(mov.diretor_chave);
    if (!movimentoVigente(mov, referencias.get(chave))) continue;
    vigentes.set(chave, mov);
  }

  return celulas.map((cel) =>
    cel.map((p) => {
      const chave = normalizarChave(p.name);
      const mov = vigentes.get(chave);
      if (!mov) return { ...p, origem: 'automatica' as const, origemDetalhe: 'Automática' };
      const automatica = rotuloAutomatico(matriz, detalhes.get(chave));
      const manual = rotulo(matriz, mov.posicao_manual);
      const periodo = txt(mov.referencia) || 'Não informado';
      return {
        ...p,
        origem: 'manual' as const,
        origemDetalhe: `Alterada manualmente\nAutomática: ${automatica}\nManual: ${manual}\nPeríodo: ${periodo}`
      };
    })
  );
}

// ---------------------------------------------------------------------------
// PERSISTÊNCIA (Supabase — tabela própria, RLS provisória como os ajustes)
// ---------------------------------------------------------------------------

/**
 * Movimentações ATIVAS (vigentes por período) de todas as matrizes. Em caso de
 * falha (ex.: tabela ainda não criada) o chamador segue só com a distribuição
 * automática — a camada manual é adicional, nunca obrigatória.
 */
export async function listarMovimentacoesAtivas(): Promise<MovimentacaoMatrizRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABELA)
    .select(COLUNAS_SELECT)
    .is('arquivada_em', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message || 'Não foi possível carregar as movimentações manuais das matrizes.');
  return (data || []) as unknown as MovimentacaoMatrizRow[];
}

/** Payload validado da movimentação manual (montado a partir do cálculo exibido). */
export interface SalvarMovimentacaoMatriz {
  matriz: TipoMatriz;
  diretor: string;
  registroId: string;
  avaliacaoId: string;
  periodoId: string;
  referencia: string | null;
  ano: number | null;
  mes: number | null;
  status: string | null;
  nivel: string | null;
  posicaoAutomatica: number;
  posicaoAnterior: number;
  posicaoManual: number;
}

export interface ResultadoSalvamentoMatriz {
  movimento: MovimentacaoMatrizRow;
  /** Linha anterior encerrada (histórico) ou null quando não havia vigência. */
  encerradaId: string | null;
  encerradoMotivo: string | null;
}

/**
 * Monta o payload da movimentação a partir do que está EXIBIDO na tela:
 * período de referência (vigência), Status/Nível e posição automática do
 * cálculo, posições de origem/destino do arraste. Lança erro claro quando não
 * há período válido (nada é gravado).
 */
export function prepararMovimentacaoMatriz(
  move: { type: TipoMatriz; directorName: string; fromIndex: number; toIndex: number },
  detalhes: ReadonlyMap<string, DetalheClassificacaoDiretor>,
  referencias: ReadonlyMap<string, ReferenciaPeriodo>,
  registros: readonly Registro[]
): SalvarMovimentacaoMatriz {
  const chave = normalizarChave(move.directorName);
  const det = detalhes.get(chave);
  const ref = referencias.get(chave);
  if (!det?.periodo || !ref) {
    throw new Error('Não há período válido para registrar a movimentação manual deste diretor.');
  }
  const posicaoAutomatica = posicaoAutomaticaDoDiretor(det, move.type);
  if (posicaoAutomatica == null) {
    throw new Error('Este diretor está aguardando classificação e não pode ser movimentado.');
  }
  // O registro do período de referência (mesmo par periodo_id/registro_id da
  // leitura) — identificadores reais, nunca só o nome do diretor.
  const registro = registros.find((r) => r.id === ref.registroId);
  if (!registro) throw new Error('Registro do diretor não encontrado para a movimentação manual.');
  return {
    matriz: move.type,
    diretor: txt(registro.diretor) || txt(move.directorName),
    registroId: registro.id,
    avaliacaoId: registro.avaliacaoId,
    periodoId: txt(ref.periodoId),
    referencia: ref.referencia,
    ano: ref.ano,
    mes: ref.mes,
    // Status/Nível usados no CÁLCULO exibido (auditoria por matriz e período).
    status: det.periodo.status,
    nivel: det.periodo.nivel,
    posicaoAutomatica,
    posicaoAnterior: move.fromIndex,
    posicaoManual: move.toIndex
  };
}

/**
 * Registra UMA movimentação manual:
 *  1. encerra a vigência ativa da MESMA matriz+diretor (linha vira histórico
 *     com `arquivada_em` + motivo: mesmo período => 'substituida', período
 *     posterior => 'novo_periodo');
 *  2. insere a nova decisão manual (única ativa — índice único parcial).
 * Nada é apagado; a posição automática (no motor) nunca é alterada.
 */
export async function salvarMovimentacaoMatriz(entrada: SalvarMovimentacaoMatriz): Promise<ResultadoSalvamentoMatriz> {
  const matriz = txt(entrada.matriz);
  if (matriz !== 'ninebox' && matriz !== 'risk') throw new Error('Matriz inválida para a movimentação manual.');
  const limite = CELULAS[matriz];
  const posicoes: Array<[string, number]> = [
    ['automática', entrada.posicaoAutomatica],
    ['anterior', entrada.posicaoAnterior],
    ['manual', entrada.posicaoManual]
  ];
  for (const [nome, valor] of posicoes) {
    if (!Number.isInteger(valor) || valor < 0 || valor >= limite) {
      throw new Error(`Posição ${nome} fora da grade da matriz.`);
    }
  }
  if (entrada.posicaoManual === entrada.posicaoAnterior) {
    throw new Error('A posição manual precisa ser diferente da posição atual do diretor.');
  }
  const diretor = txt(entrada.diretor);
  const diretorChave = normalizarChave(diretor);
  const registroId = txt(entrada.registroId);
  const avaliacaoId = txt(entrada.avaliacaoId);
  const periodoId = txt(entrada.periodoId);
  if (!diretor || !diretorChave || !registroId || !avaliacaoId || !periodoId) {
    throw new Error('Não foi possível identificar o diretor, o registro ou o período da movimentação manual.');
  }

  const referencia: ReferenciaPeriodo = {
    periodoId,
    registroId,
    referencia: entrada.referencia,
    ano: entrada.ano,
    mes: entrada.mes,
    status: entrada.status,
    nivel: entrada.nivel
  };

  const sb = getSupabase();
  const agora = new Date().toISOString();

  // 1) Vigência atual (se houver) -> histórico. Consulta DIRETA no banco (não
  //    depende do estado em memória): mesma matriz + mesmo diretor.
  const { data: ativa, error: errAtiva } = await sb
    .from(TABELA)
    .select('id, periodo_id, periodo_ano, periodo_mes')
    .eq('matriz', matriz)
    .eq('diretor_chave', diretorChave)
    .is('arquivada_em', null)
    .maybeSingle();
  if (errAtiva) throw new Error(errAtiva.message || 'Não foi possível consultar a posição manual atual do diretor.');

  let encerradaId: string | null = null;
  let encerradoMotivo: string | null = null;
  if (ativa) {
    const idAtiva = (ativa as { id: string }).id;
    encerradoMotivo = motivoEncerramento(ativa, referencia);
    const { data: encerrada, error: errEnc } = await sb
      .from(TABELA)
      .update({ arquivada_em: agora, encerrado_motivo: encerradoMotivo, atualizado_por: null, updated_at: agora })
      .eq('id', idAtiva)
      .is('arquivada_em', null)
      .select('id');
    if (errEnc) throw new Error(errEnc.message || 'Não foi possível encerrar a vigência da posição manual anterior.');
    // 0 linhas = outra sessão encerrou antes (segue; o índice único protege).
    if (encerrada && encerrada.length) encerradaId = idAtiva;
  }

  // 2) Nova decisão manual — única ativa por matriz+diretor.
  const { data, error } = await sb
    .from(TABELA)
    .insert({
      avaliacao_id: avaliacaoId,
      registro_id: registroId,
      periodo_id: periodoId,
      matriz,
      diretor,
      diretor_chave: diretorChave,
      referencia: entrada.referencia ?? null,
      periodo_ano: entrada.ano ?? null,
      periodo_mes: entrada.mes ?? null,
      status_usado: entrada.status ?? null,
      nivel_usado: entrada.nivel ?? null,
      posicao_automatica: entrada.posicaoAutomatica,
      posicao_anterior: entrada.posicaoAnterior,
      posicao_manual: entrada.posicaoManual,
      origem: ORIGEM_MANUAL,
      criado_por: null,
      atualizado_por: null
    })
    .select(COLUNAS_SELECT)
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new Error('Já existe uma movimentação manual vigente para este diretor nesta matriz. Atualize a página e tente novamente.');
    }
    throw new Error(error.message || 'Não foi possível registrar a movimentação manual da matriz.');
  }
  return { movimento: data as unknown as MovimentacaoMatrizRow, encerradaId, encerradoMotivo };
}
