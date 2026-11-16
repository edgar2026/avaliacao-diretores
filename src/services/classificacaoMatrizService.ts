import { romanLevel } from '../lib/dataParser.ts';
import { buildMonthlyLabelMap } from './dashboardService.ts';
import type { Registro } from '../types/modelo';

// ---------------------------------------------------------------------------
// MOTOR CENTRALIZADO DE CLASSIFICAÇÃO AUTOMÁTICA DAS MATRIZES DE DIRETORES
// (Ninebox Potencial × Desempenho e Matriz Risco × Dano).
//
// Toda regra aprovada mora SOMENTE neste arquivo: componentes visuais apenas
// recebem o resultado já distribuído. Nenhuma condição é duplicada em tela.
//
// Entrada: Status VIGENTE e Nível VIGENTE do ÚLTIMO PERÍODO VÁLIDO do diretor
// (mesmo período para os dois valores — nunca se mistura mês de meses
// diferentes). O último período pode ter sido criado por upload de planilha,
// por cadastro manual ou ter ajuste manual vigente.
//
// STATUS COM DESTINO DEFINIDO SEM NÍVEL: Acompanhamento, Supervisão I e
// Supervisão II classificam independente do Nível; Reposicionamento EXCLUI o
// diretor das duas matrizes (fora de células, fora de "Aguardando" e fora das
// contagens — não é pendência). Gestão e Delegação continuam exigindo Nível.
// A regra é sempre do STATUS vigente, nunca do nome de uma pessoa.
//
// NÃO usa: status de gestão da unidade, ciclo de vida, nível da unidade,
// notas, indicadores, pareceres nem justificativas.
//
// Combinação sem regra aprovada => "Aguardando classificação" (nunca se
// inventa regra, peso, média, nota ou fórmula).
// ---------------------------------------------------------------------------

/** Rótulo de diretor sem regra aplicável em uma das matrizes. */
export const ROTULO_AGUARDANDO = 'Aguardando classificação';

/** Origem de TODA classificação deste motor: automática (nunca manual). */
export const ORIGEM_AUTOMATICA = 'automatica' as const;

const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V'];

/** Ordem dos eixos da matriz Risco × Dano (linhas de cima para baixo). */
export const EIXO_RISCO = ['Altíssimo', 'Alto', 'Médio', 'Baixo'] as const;
export const EIXO_DANO = ['Baixo', 'Médio', 'Alto', 'Altíssimo'] as const;

// ---------------------------------------------------------------------------
// NORMALIZAÇÃO — somente para COMPARAÇÃO. O texto armazenado no banco nunca é
// alterado. Cuidados: maiúsculas/minúsculas, espaços extras, acentuação e
// formas válidas de números romanos (I..V, com ou sem parênteses).
// "Gestão I" nunca casa com "Gestão II"; "Delegação I" com "Delegação II";
// "Supervisão I" com "Supervisão II"; "Nível IV" com "Nível V".
// ---------------------------------------------------------------------------

export function normalizarChave(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Status comparável: vazio e "Não informado" => null (sem dado vigente). */
export function normalizarStatus(v: unknown): string | null {
  const t = normalizarChave(v);
  return t && t !== 'nao informado' ? t : null;
}

/**
 * Nome de diretor VÁLIDO para as matrizes: não vazio, não composto só por
 * espaços e nunca o registro "Diretor não informado" (comparação NORMALIZADA —
 * caixa, acentuação e espaços extras). Registros inválidos não entram em
 * células, contagens, fotos, lista do modal, "Aguardando classificação" nem
 * movimentações — nenhum dado é apagado, apenas ignorado visualmente.
 */
export function nomeDiretorValido(v: unknown): boolean {
  const k = normalizarChave(v);
  return !!k && k !== 'diretor nao informado';
}

/** Nível comparável: aceita 1..5 ou algarismo romano I..V (com/sem "()"). */
export function normalizarNivel(v: unknown): 1 | 2 | 3 | 4 | 5 | null {
  if (typeof v === 'number') {
    return Number.isInteger(v) && v >= 1 && v <= 5 ? (v as 1 | 2 | 3 | 4 | 5) : null;
  }
  if (v == null || String(v).trim() === '') return null;
  return romanLevel(v);
}

/** Prioridade do valor vigente do período: ajuste manual > cadastro > planilha. */
export function prioridadeValor(p: { ajustado?: boolean; origem?: string | null } | null | undefined): number {
  if (!p) return 0;
  if (p.ajustado) return 2;
  return p.origem === 'cadastro_manual' ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 1) ÚLTIMO PERÍODO VÁLIDO
// ---------------------------------------------------------------------------

// Período na forma usada pelo motor (montado a partir do modelo em memória).
export interface EntradaPeriodoClassificacao {
  id?: string | null;
  registroId?: string | null;
  rotulo?: string | null;
  ordem?: number | null;
  /** Posição cronológica da avaliação dona do período. */
  ordemAvaliacao?: number | null;
  /** Mês/ano reconhecido do rótulo (cronologia real do sistema). */
  tempo?: { ano: number; mes: number } | null;
  /** Status VIGENTE do período (ajuste manual por cima do importado). */
  status?: string | null;
  /** Nível VIGENTE do período (texto exibido, ex.: "(III)"). */
  nivel?: string | number | null;
  nivelRoman?: number | null;
  ajustado?: boolean;
  origem?: string | null;
}

export type OrigemValorVigente = 'ajuste_manual' | 'cadastro_manual' | 'planilha';

// Último período válido do diretor: Status do MESMO período em que ele vigora
// (com Nível, quando o Status exige Nível — Gestão/Delegação).
export interface UltimoPeriodoValido {
  rotulo: string | null;
  status: string | null;
  nivel: string | null;
  nivelRoman: 1 | 2 | 3 | 4 | 5 | null;
  origem: OrigemValorVigente;
  periodoId: string | null;
  registroId: string | null;
  /** Referência usada na classificação (ex.: "AGO/2026 · Ajuste manual"). */
  referencia: string;
}

function texto(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function textoNivelExibicao(entrada: EntradaPeriodoClassificacao, roman: number): string {
  if (typeof entrada.nivel === 'string' && texto(entrada.nivel)) return texto(entrada.nivel);
  return ROMANOS[roman] ? `(${ROMANOS[roman]})` : '';
}

function origemValor(entrada: EntradaPeriodoClassificacao): OrigemValorVigente {
  if (entrada.ajustado) return 'ajuste_manual';
  return entrada.origem === 'cadastro_manual' ? 'cadastro_manual' : 'planilha';
}

function rotuloOrigem(o: OrigemValorVigente): string {
  if (o === 'ajuste_manual') return 'Ajuste manual';
  if (o === 'cadastro_manual') return 'Cadastro manual';
  return 'Valor importado';
}

// Um período é VÁLIDO quando tem Status vigente — e, para Gestão/Delegação,
// também Nível vigente (sempre do MESMO período; nunca se combina status de
// um mês com nível de outro). Status SEM dependência de Nível validam sozinhos
// (nunca retrocedem a um período anterior por falta de Nível nem caem em
// "Aguardando classificação"): Acompanhamento, Supervisão I, Supervisão II e
// Reposicionamento. Comparação SOMENTE por valores normalizados do Status.
const STATUS_ACOMPANHAMENTO = 'acompanhamento';
const STATUS_SUPERVISAO_I = 'supervisao i';
const STATUS_SUPERVISAO_II = 'supervisao ii';
const STATUS_REPOSICIONAMENTO = 'reposicionamento';
const STATUS_SEM_NIVEL: ReadonlySet<string> = new Set([
  STATUS_ACOMPANHAMENTO,
  STATUS_SUPERVISAO_I,
  STATUS_SUPERVISAO_II,
  STATUS_REPOSICIONAMENTO
]);

function comoUltimoValido(entrada: EntradaPeriodoClassificacao): UltimoPeriodoValido | null {
  const status = normalizarStatus(entrada.status) ? texto(entrada.status) : null;
  const chave = status ? normalizarStatus(status) : null;
  const roman = entrada.nivelRoman != null && Number.isInteger(entrada.nivelRoman) && entrada.nivelRoman >= 1 && entrada.nivelRoman <= 5
    ? (entrada.nivelRoman as 1 | 2 | 3 | 4 | 5)
    : normalizarNivel(entrada.nivel);
  const semNivel = !!chave && STATUS_SEM_NIVEL.has(chave);
  if (!status || (roman == null && !semNivel)) return null;
  const origem = origemValor(entrada);
  const rotulo = texto(entrada.rotulo) || null;
  return {
    rotulo,
    status,
    nivel: roman != null ? textoNivelExibicao(entrada, roman) : '',
    nivelRoman: roman,
    origem,
    periodoId: entrada.id ?? null,
    registroId: entrada.registroId ?? null,
    referencia: `${rotulo || 'Período'} · ${rotuloOrigem(origem)}`
  };
}

/**
 * REGRA DO ÚLTIMO PERÍODO VÁLIDO (centralizada):
 *  1. ordena os períodos do diretor cronologicamente (mês/ano do rótulo quando
 *     reconhecido; senão avaliação + ordem gravada);
 *  2. em empate de mês/ano vige o valor de MAIOR prioridade — ajuste manual
 *     vigente (2) > cadastro manual (1) > valor importado (0);
 *  3. percorre do mais recente para o mais antigo e devolve o primeiro
 *     período com Status válido (e Nível válido, quando o Status exige Nível —
 *     os dois do MESMO período);
 *  4. devolve null quando nenhum período satisfaz essa condição.
 */
export function obterUltimoPeriodoValido(
  periodos: readonly EntradaPeriodoClassificacao[] | null | undefined
): UltimoPeriodoValido | null {
  const entradas = (periodos || []).filter((p): p is EntradaPeriodoClassificacao => !!p);
  if (!entradas.length) return null;

  const tempoDe = (e: EntradaPeriodoClassificacao) =>
    e.tempo && Number.isFinite(e.tempo.ano) && Number.isFinite(e.tempo.mes) ? e.tempo : null;
  const comTempo = entradas.every((e) => tempoDe(e) != null);

  const ordenadas = entradas.map((entrada, i) => ({ entrada, i, pri: prioridadeValor(entrada) }));
  ordenadas.sort((a, b) => {
    if (comTempo) {
      const ta = tempoDe(a.entrada)!;
      const tb = tempoDe(b.entrada)!;
      if (ta.ano !== tb.ano) return ta.ano - tb.ano;
      if (ta.mes !== tb.mes) return ta.mes - tb.mes;
    }
    const oa = Number(a.entrada.ordemAvaliacao ?? 0) - Number(b.entrada.ordemAvaliacao ?? 0);
    if (oa) return oa;
    const o = Number(a.entrada.ordem ?? 0) - Number(b.entrada.ordem ?? 0);
    if (o) return o;
    if (a.pri !== b.pri) return a.pri - b.pri;
    return a.i - b.i;
  });

  let fim = ordenadas.length - 1;
  while (fim >= 0) {
    // Mesmo mês/ano = UMA posição cronológica (nunca se mistura meses).
    let inicio = fim;
    if (comTempo) {
      const t = tempoDe(ordenadas[fim].entrada)!;
      while (inicio - 1 >= 0) {
        const anterior = tempoDe(ordenadas[inicio - 1].entrada)!;
        if (anterior.ano !== t.ano || anterior.mes !== t.mes) break;
        inicio--;
      }
    }
    // Representante da posição: valor de MAIOR prioridade (ajuste > cadastro >
    // importado) — o valor vigente do período é um só.
    let melhor = ordenadas[inicio];
    for (let k = inicio + 1; k <= fim; k++) {
      if (ordenadas[k].pri >= melhor.pri) melhor = ordenadas[k];
    }
    const valido = comoUltimoValido(melhor.entrada);
    if (valido) return valido;
    fim = inicio - 1;
  }
  return null;
}

/**
 * Períodos de UM diretor na forma do motor: todos os períodos dos registros
 * ativos dele, com mês/ano reconhecido (mesma cronologia do gráfico de
 * evolução), ordem da avaliação e valores VIGENTES (ajuste manual por cima do
 * cadastro manual, por cima do importado).
 */
export function periodosClassificacaoDoDiretor(
  registros: readonly Registro[] | null | undefined,
  avaliacoes: readonly { id: string }[] | null | undefined
): EntradaPeriodoClassificacao[] {
  const lista = (registros || []).filter((r) => r && !r.arquivado);
  const ordemAval = new Map((avaliacoes || []).map((a, i) => [a.id, i]));
  const { labelMap } = buildMonthlyLabelMap(
    lista.map((r) => ({
      avaliacaoId: r.avaliacaoId,
      periodos: (r.periodos || []).map((p) => ({ rotulo: p.rotulo, ordem: p.ordem }))
    })),
    avaliacoes || []
  );
  const ultimaPosicao = (avaliacoes || []).length;
  const saida: EntradaPeriodoClassificacao[] = [];
  for (const r of lista) {
    for (const p of r.periodos || []) {
      const info = labelMap.get(`${r.avaliacaoId}|${p.rotulo}`);
      saida.push({
        id: p.id,
        registroId: r.id,
        rotulo: p.rotulo,
        ordem: p.ordem,
        // Avaliação fora da lista ordenada = mais recente (mesma convenção do
        // gráfico de evolução); a posição de fallback segue o tamanho atual.
        ordemAvaliacao: ordemAval.has(r.avaliacaoId) ? ordemAval.get(r.avaliacaoId)! : ultimaPosicao,
        tempo: info ? { ano: info.year, mes: info.month } : null,
        status: p.estagio,
        nivel: p.nivel,
        nivelRoman: p.nivelRoman,
        ajustado: p.ajustado,
        origem: p.origem
      });
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------
// 2) REGRAS DA NINEBOX
// ---------------------------------------------------------------------------

export type PotencialNinebox = 'Alto' | 'Médio' | 'Baixo';
export type DesempenhoNinebox = 'Abaixo do esperado' | 'Esperado' | 'Acima do esperado';

export interface ResultadoNinebox {
  aplicavel: boolean;
  potencial: PotencialNinebox | null;
  desempenho: DesempenhoNinebox | null;
  /** Quadrante aprovado ou "Aguardando classificação". */
  quadrante: string;
  /** Referência usada (ex.: "Delegação II · Nível V"). */
  referencia: string | null;
  origem: typeof ORIGEM_AUTOMATICA;
}

interface RegraNinebox {
  status: string;
  statusLabel: string;
  /** null = regra independente do Nível (ex.: Acompanhamento, sem Nível). */
  niveis: number[] | null;
  potencial: PotencialNinebox;
  desempenho: DesempenhoNinebox;
  quadrante: string;
}

// EXATAMENTE as regras aprovadas. Combinação ausente daqui não existe regra.
const REGRAS_NINEBOX: RegraNinebox[] = [
  { status: 'delegacao ii', statusLabel: 'Delegação II', niveis: [1, 2, 3, 4, 5], potencial: 'Alto', desempenho: 'Acima do esperado', quadrante: 'Alto Potencial' },
  { status: 'delegacao i', statusLabel: 'Delegação I', niveis: [3, 4, 5], potencial: 'Alto', desempenho: 'Esperado', quadrante: 'Forte Desempenho superior' },
  { status: 'delegacao i', statusLabel: 'Delegação I', niveis: [1, 2], potencial: 'Médio', desempenho: 'Acima do esperado', quadrante: 'Forte Desempenho do meio, canto direito' },
  // Supervisão I/II: destino definido INDEPENDENTE do Nível (I..V, vazio ou
  // "Não informado") — nunca fica em "Aguardando classificação".
  { status: STATUS_SUPERVISAO_I, statusLabel: 'Supervisão I', niveis: null, potencial: 'Alto', desempenho: 'Abaixo do esperado', quadrante: 'Diamante Bruto' },
  { status: STATUS_SUPERVISAO_II, statusLabel: 'Supervisão II', niveis: null, potencial: 'Alto', desempenho: 'Abaixo do esperado', quadrante: 'Diamante Bruto' },
  { status: 'gestao i', statusLabel: 'Gestão I', niveis: [1, 2], potencial: 'Baixo', desempenho: 'Abaixo do esperado', quadrante: 'Insuficiente' },
  { status: 'gestao i', statusLabel: 'Gestão I', niveis: [3, 4, 5], potencial: 'Médio', desempenho: 'Abaixo do esperado', quadrante: 'Questionável' },
  { status: 'gestao ii', statusLabel: 'Gestão II', niveis: [4, 5], potencial: 'Baixo', desempenho: 'Acima do esperado', quadrante: 'Comprometido' },
  { status: 'gestao ii', statusLabel: 'Gestão II', niveis: [1], potencial: 'Baixo', desempenho: 'Esperado', quadrante: 'Eficaz' },
  { status: 'gestao ii', statusLabel: 'Gestão II', niveis: [2, 3], potencial: 'Médio', desempenho: 'Esperado', quadrante: 'Mantenedor' },
  // Acompanhamento não possui Nível (validado antes da regra geral): sempre
  // "Insuficiente" — nunca aparece em "Aguardando classificação".
  { status: STATUS_ACOMPANHAMENTO, statusLabel: 'Acompanhamento', niveis: null, potencial: 'Baixo', desempenho: 'Abaixo do esperado', quadrante: 'Insuficiente' }
];

function semRegraNinebox(): ResultadoNinebox {
  return {
    aplicavel: false,
    potencial: null,
    desempenho: null,
    quadrante: ROTULO_AGUARDANDO,
    referencia: null,
    origem: ORIGEM_AUTOMATICA
  };
}

/**
 * NINEBOX: Potencial × Desempenho a partir do Status e do Nível vigentes do
 * último período válido. Acompanhamento e Supervisão I/II (sem exigir Nível)
 * têm destino definido => "Insuficiente" e "Diamante Bruto". Sem regra
 * aprovada => "Aguardando classificação" (o motor não decide nome de pessoa).
 */
export function classificarNinebox(status: unknown, nivel: unknown): ResultadoNinebox {
  const s = normalizarStatus(status);
  if (!s) return semRegraNinebox();
  const n = normalizarNivel(nivel);
  const regra = REGRAS_NINEBOX.find(
    (r) => r.status === s && (r.niveis === null || (n != null && r.niveis.includes(n)))
  );
  if (!regra) return semRegraNinebox();
  return {
    aplicavel: true,
    potencial: regra.potencial,
    desempenho: regra.desempenho,
    quadrante: regra.quadrante,
    referencia: n != null
      ? `${regra.statusLabel} · Nível ${ROMANOS[n as number]}`
      : regra.statusLabel,
    origem: ORIGEM_AUTOMATICA
  };
}

/** Índice da célula (0..8) na grade aprovada da Ninebox; null = aguardando. */
export function indiceNinebox(r: ResultadoNinebox | null | undefined): number | null {
  if (!r || !r.aplicavel || !r.potencial || !r.desempenho) return null;
  const linha = { Alto: 0, Médio: 1, Baixo: 2 }[r.potencial];
  const coluna = { 'Abaixo do esperado': 0, Esperado: 1, 'Acima do esperado': 2 }[r.desempenho];
  return linha * 3 + coluna;
}

// ---------------------------------------------------------------------------
// 3) REGRAS DA MATRIZ RISCO × DANO
// ---------------------------------------------------------------------------

export type NivelRisco = 'Altíssimo' | 'Alto' | 'Médio' | 'Baixo';
export type NivelDano = 'Baixo' | 'Médio' | 'Alto' | 'Altíssimo';

export interface ResultadoRiscoDano {
  aplicavel: boolean;
  risco: NivelRisco | null;
  dano: NivelDano | null;
  /** Célula aprovada ou "Aguardando classificação". */
  celula: string;
  /** Referência usada (ex.: "Delegação II · Nível III"). */
  referencia: string | null;
  /** Índice 0..15 na grade (linhas Altíssimo→Baixo, colunas Baixo→Altíssimo). */
  indice: number | null;
  origem: typeof ORIGEM_AUTOMATICA;
}

interface RegraRisco {
  risco: NivelRisco;
  dano: NivelDano;
  status: string;
  statusLabel: string;
  /** null = qualquer Nível (regra independente do nível). */
  niveis: number[] | null;
}

// EXATAMENTE as 16 células oficiais. Risco no eixo vertical, Dano no
// horizontal — nunca invertidos. Vários Status podem cair na MESMA célula
// (Altíssimo × Altíssimo recebe Acompanhamento, Supervisão I e Supervisão II).
const REGRAS_RISCO: RegraRisco[] = [
  { risco: 'Baixo', dano: 'Baixo', status: 'delegacao ii', statusLabel: 'Delegação II', niveis: [4, 5] },
  { risco: 'Baixo', dano: 'Médio', status: 'delegacao ii', statusLabel: 'Delegação II', niveis: [3] },
  { risco: 'Baixo', dano: 'Alto', status: 'delegacao ii', statusLabel: 'Delegação II', niveis: [1, 2] },
  { risco: 'Baixo', dano: 'Altíssimo', status: 'delegacao i', statusLabel: 'Delegação I', niveis: [4, 5] },
  { risco: 'Médio', dano: 'Baixo', status: 'delegacao i', statusLabel: 'Delegação I', niveis: [3] },
  { risco: 'Médio', dano: 'Médio', status: 'delegacao i', statusLabel: 'Delegação I', niveis: [2] },
  { risco: 'Médio', dano: 'Alto', status: 'delegacao i', statusLabel: 'Delegação I', niveis: [1] },
  { risco: 'Médio', dano: 'Altíssimo', status: 'gestao ii', statusLabel: 'Gestão II', niveis: [4, 5] },
  { risco: 'Alto', dano: 'Baixo', status: 'gestao ii', statusLabel: 'Gestão II', niveis: [3] },
  { risco: 'Alto', dano: 'Médio', status: 'gestao ii', statusLabel: 'Gestão II', niveis: [2] },
  { risco: 'Alto', dano: 'Alto', status: 'gestao ii', statusLabel: 'Gestão II', niveis: [1] },
  { risco: 'Alto', dano: 'Altíssimo', status: 'gestao i', statusLabel: 'Gestão I', niveis: [4, 5] },
  { risco: 'Altíssimo', dano: 'Baixo', status: 'gestao i', statusLabel: 'Gestão I', niveis: [3] },
  { risco: 'Altíssimo', dano: 'Médio', status: 'gestao i', statusLabel: 'Gestão I', niveis: [2] },
  { risco: 'Altíssimo', dano: 'Alto', status: 'gestao i', statusLabel: 'Gestão I', niveis: [1] },
  { risco: 'Altíssimo', dano: 'Altíssimo', status: 'acompanhamento', statusLabel: 'Acompanhamento', niveis: null },
  // Supervisão I/II: destino definido INDEPENDENTE do Nível (I..V, vazio ou
  // "Não informado") — nunca fica em "Aguardando classificação".
  { risco: 'Altíssimo', dano: 'Altíssimo', status: STATUS_SUPERVISAO_I, statusLabel: 'Supervisão I', niveis: null },
  { risco: 'Altíssimo', dano: 'Altíssimo', status: STATUS_SUPERVISAO_II, statusLabel: 'Supervisão II', niveis: null }
];

function semRegraRisco(): ResultadoRiscoDano {
  return {
    aplicavel: false,
    risco: null,
    dano: null,
    celula: ROTULO_AGUARDANDO,
    referencia: null,
    indice: null,
    origem: ORIGEM_AUTOMATICA
  };
}

/**
 * RISCO × DANO: célula a partir do Status e do Nível vigentes do último
 * período válido. Sem regra aprovada => "Aguardando classificação".
 */
export function classificarRiscoDano(status: unknown, nivel: unknown): ResultadoRiscoDano {
  const s = normalizarStatus(status);
  if (!s) return semRegraRisco();
  const n = normalizarNivel(nivel);
  const regra = REGRAS_RISCO.find(
    (r) => r.status === s && (r.niveis === null || (n != null && r.niveis.includes(n)))
  );
  if (!regra) return semRegraRisco();
  return {
    aplicavel: true,
    risco: regra.risco,
    dano: regra.dano,
    celula: `Risco ${regra.risco} • Dano ${regra.dano}`,
    referencia: n != null
      ? `${regra.statusLabel} · Nível ${ROMANOS[n as number]}`
      : regra.statusLabel,
    indice: EIXO_RISCO.indexOf(regra.risco) * 4 + EIXO_DANO.indexOf(regra.dano),
    origem: ORIGEM_AUTOMATICA
  };
}

/** Índice da célula (0..15) na grade aprovada Risco × Dano; null = aguardando. */
export function indiceRiscoDano(r: ResultadoRiscoDano | null | undefined): number | null {
  return r && r.aplicavel && r.indice != null ? r.indice : null;
}

// ---------------------------------------------------------------------------
// 6) DISTRIBUIÇÃO AUTOMÁTICA NAS DUAS MATRIZES
// ---------------------------------------------------------------------------

export interface DetalheClassificacaoDiretor {
  /** Último período válido (Status + Nível do mesmo período) ou null. */
  periodo: UltimoPeriodoValido | null;
  ninebox: ResultadoNinebox;
  risco: ResultadoRiscoDano;
}

export interface MatrizesClassificadas<T> {
  /** 9 células da Ninebox (na ordem aprovada da grade). */
  ninebox: T[][];
  /** 16 células da Risco × Dano (na ordem aprovada da grade). */
  risk: T[][];
  aguardandoNinebox: T[];
  aguardandoRisco: T[];
  detalhes: Map<string, DetalheClassificacaoDiretor>;
}

function chaveNome(v: unknown): string {
  return normalizarChave(v);
}

/**
 * Monta as duas matrizes a partir do motor, NESTA ordem centralizada:
 *  1. registro representa um diretor REAL (nome válido);
 *  2. localiza o último Status válido individual (com Nível quando Gestão/
 *     Delegação exige);
 *  3. Reposicionamento vigente => EXCLUÍDO das duas matrizes (fora de
 *     células, fora de "Aguardando classificação" e fora das contagens —
 *     não é pendência; nada é apagado do sistema);
 *  4/5. Acompanhamento e Supervisão I/II => regras especiais sem Nível;
 *  6. Gestão/Delegação => Nível validado e regras já existentes;
 *  7. somente então => "Aguardando classificação".
 * UM diretor aparece UMA única vez em cada matriz — sem duplicatas.
 */
export function montarMatrizesClassificadas<T extends { id: string; name: string }>(
  diretores: readonly T[] | null | undefined,
  registros: readonly Registro[] | null | undefined,
  avaliacoes: readonly { id: string }[] | null | undefined
): MatrizesClassificadas<T> {
  const ninebox: T[][] = Array.from({ length: 9 }, () => []);
  const risk: T[][] = Array.from({ length: 16 }, () => []);
  const aguardandoNinebox: T[] = [];
  const aguardandoRisco: T[] = [];
  const detalhes = new Map<string, DetalheClassificacaoDiretor>();

  const registrosPorNome = new Map<string, Registro[]>();
  for (const r of registros || []) {
    if (!r || r.arquivado) continue;
    const k = chaveNome(r.diretor);
    if (!k || !nomeDiretorValido(k)) continue;
    const lista = registrosPorNome.get(k);
    if (lista) lista.push(r);
    else registrosPorNome.set(k, [r]);
  }

  const vistos = new Set<string>();
  for (const d of diretores || []) {
    if (!d) continue;
    const k = chaveNome(d.name);
    // Nome inválido ("Diretor não informado", vazio ou só espaços) nunca entra
    // nas matrizes, nas contagens nem em "Aguardando classificação".
    if (!k || !nomeDiretorValido(k) || vistos.has(k)) continue;
    vistos.add(k);

    const periodos = periodosClassificacaoDoDiretor(registrosPorNome.get(k) || [], avaliacoes);
    const periodo = obterUltimoPeriodoValido(periodos);

    // 3) Reposicionamento VIGENTE: exclusão válida do universo das duas
    // matrizes — fora das células, fora de "Aguardando classificação" e fora
    // das contagens (não representa pendência). Nada é apagado: registros,
    // histórico, Status, Nível, indicadores e movimentações permanecem
    // intactos; ele volta a contar automaticamente quando o Status mudar.
    if (periodo && normalizarStatus(periodo.status) === STATUS_REPOSICIONAMENTO) continue;

    const nine = classificarNinebox(periodo?.status, periodo?.nivel);
    const risco = classificarRiscoDano(periodo?.status, periodo?.nivel);
    detalhes.set(k, { periodo, ninebox: nine, risco });

    const idxNine = indiceNinebox(nine);
    if (idxNine != null) ninebox[idxNine].push(d);
    else aguardandoNinebox.push(d);

    const idxRisco = indiceRiscoDano(risco);
    if (idxRisco != null) risk[idxRisco].push(d);
    else aguardandoRisco.push(d);
  }

  return { ninebox, risk, aguardandoNinebox, aguardandoRisco, detalhes };
}
