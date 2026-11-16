import {
  normalizarChave,
  normalizarStatus,
  periodosClassificacaoDoDiretor,
  prioridadeValor
} from '../../../services/classificacaoMatrizService.ts';
import type {
  DetalheClassificacaoDiretor,
  EntradaPeriodoClassificacao
} from '../../../services/classificacaoMatrizService.ts';
import type { Registro } from '../../../types/modelo';

// ---------------------------------------------------------------------------
// CARD INFORMATIVO DO DIRETORE (Ninebox e Risco × Dano)
//
// Monta, UMA vez por atualização de dados, o conteúdo exibido ao passar o
// mouse (ou focar) sobre um diretor dentro dos modais de movimentação e sobre
// um item de "Aguardando classificação". Tudo vem de dados EM MEMÓRIA — nenhum
// novo banco, nenhuma query por hover:
//   * Regional / Unidade: primeiro registro ativo do diretor (mesma ordem do
//     fonte que monta as matrizes);
//   * Referência, Status e Nível: SEMPRE do MESMO período — o último período
//     válido do motor (detalhes), nunca se mistura meses diferentes;
//   * Motivo de "Aguardando classificação": POR MATRIZ (um diretor pode ser
//     classificado numa matriz e aguardando na outra).
//
// Este arquivo SOMENTE LÊ o motor aprovado (classificacaoMatrizService.ts);
// nenhuma regra de classificação é duplicada ou alterada aqui.
// ---------------------------------------------------------------------------

/** Conteúdo exibido no card informativo de UM diretor. */
export interface InfoCardDiretor {
  /** Regional do diretor (primeiro registro ativo) ou "Não informado". */
  regional: string;
  /** Período usado na classificação (rótulo + origem do valor vigente). */
  periodo: string;
  /** Status VIGENTE do mesmo período usado na classificação. */
  status: string;
  /** Nível VIGENTE do mesmo período ("Não se aplica" quando o Status não usa). */
  nivel: string;
  /** Motivo de aguardar na Ninebox (presente só quando aguarda). */
  motivoNinebox?: string;
  /** Motivo de aguardar na Risco × Dano (presente só quando aguarda). */
  motivoRisco?: string;
}

const txt = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Status cujo destino é definido SEM exigir Nível (nunca "Não informado"). */
function semNivel(status: string | null): boolean {
  return status === 'acompanhamento' || status === 'supervisao i' || status === 'supervisao ii';
}

/** Exibição do Nível: "Não se aplica" (Status sem Nível) ou "Não informado". */
function exibirNivel(status: unknown, nivel: unknown): string {
  const s = normalizarStatus(status);
  if (s && semNivel(s)) return 'Não se aplica';
  return txt(nivel) || 'Não informado';
}

/**
 * Ordena os períodos EXATAMENTE como o motor (cronologia mês/ano quando todos
 * reconhecidos; senão avaliação + ordem; empate por prioridade ajuste manual >
 * cadastro > importado) — do mais antigo para o mais recente.
 */
function ordenarComoMotor(periodos: readonly EntradaPeriodoClassificacao[]): EntradaPeriodoClassificacao[] {
  const tempoDe = (e: EntradaPeriodoClassificacao) =>
    e.tempo && Number.isFinite(e.tempo.ano) && Number.isFinite(e.tempo.mes) ? e.tempo : null;
  const comTempo = periodos.every((e) => tempoDe(e) != null);
  const entradas = periodos.map((entrada, i) => ({ entrada, i, pri: prioridadeValor(entrada) }));
  entradas.sort((a, b) => {
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
  return entradas.map((x) => x.entrada);
}

/**
 * Motivo de "Aguardando classificação" de UMA matriz:
 *  * período válido mas sem regra aprovada => "Combinação sem regra";
 *  * sem nenhum período => "Sem avaliação válida";
 *  * sem período válido: o período mais recente com Status reconhecido é
 *    Gestão/Delegação sem Nível => "Gestão sem Nível" / "Delegação sem Nível";
 *    qualquer outro caso => "Sem Status válido".
 */
function motivoAguardando(
  det: DetalheClassificacaoDiretor,
  periodos: readonly EntradaPeriodoClassificacao[],
  aplicavel: boolean
): string | undefined {
  if (det.periodo) return aplicavel ? undefined : 'Combinação sem regra';
  if (!periodos.length) return 'Sem avaliação válida';
  const ordenados = ordenarComoMotor(periodos);
  let ultimoComStatus: EntradaPeriodoClassificacao | null = null;
  for (const p of ordenados) {
    if (normalizarStatus(p.status)) ultimoComStatus = p;
  }
  const s = ultimoComStatus ? normalizarStatus(ultimoComStatus.status) : null;
  if (s === 'gestao i' || s === 'gestao ii') return 'Gestão sem Nível';
  if (s === 'delegacao i' || s === 'delegacao ii') return 'Delegação sem Nível';
  return 'Sem Status válido';
}

/** Regional do diretor: primeiro registro ativo com regional preenchida. */
function regionalDe(registros: readonly Registro[]): string {
  for (const r of registros) {
    const regional = txt(r.regional);
    if (regional) return regional;
  }
  return 'Não informado';
}

/**
 * Monta o mapa (chave = nome do diretor normalizado) com o conteúdo do card
 * informativo de TODOS os diretor com detalhe de classificação — cobre quem
 * está em célula e quem está em "Aguardando classificação" das DUAS matrizes.
 */
export function montarInfoDiretores(
  registros: readonly Registro[] | null | undefined,
  avaliacoes: readonly { id: string }[] | null | undefined,
  detalhes: ReadonlyMap<string, DetalheClassificacaoDiretor> | null | undefined
): Map<string, InfoCardDiretor> {
  const saida = new Map<string, InfoCardDiretor>();
  if (!detalhes || !detalhes.size) return saida;

  const porNome = new Map<string, Registro[]>();
  for (const r of registros || []) {
    if (!r || r.arquivado) continue;
    const k = normalizarChave(r.diretor);
    if (!k) continue;
    const lista = porNome.get(k);
    if (lista) lista.push(r);
    else porNome.set(k, [r]);
  }

  for (const [chave, det] of detalhes) {
    const doDiretor = porNome.get(chave) || [];
    const periodo = det.periodo;
    // Só quem aguarda (ou está sem período válido) precisa varrer os períodos
    // para descobrir o motivo — diretor classificado não paga esse custo.
    const precisaMotivo = !periodo || !det.ninebox.aplicavel || !det.risco.aplicavel;
    // Varre os períodos só quando NÃO há período válido — o motivo precisa
    // saber se havia dados e qual o Status mais recente reconhecido.
    const periodos = !periodo ? periodosClassificacaoDoDiretor(doDiretor, avaliacoes) : [];

    const info: InfoCardDiretor = {
      regional: regionalDe(doDiretor),
      periodo: txt(periodo?.referencia) || 'Não informado',
      status: txt(periodo?.status) || 'Não informado',
      nivel: exibirNivel(periodo?.status, periodo?.nivel)
    };

    if (precisaMotivo) {
      const motivoNinebox = motivoAguardando(det, periodos, det.ninebox.aplicavel);
      const motivoRisco = motivoAguardando(det, periodos, det.risco.aplicavel);
      if (motivoNinebox) info.motivoNinebox = motivoNinebox;
      if (motivoRisco) info.motivoRisco = motivoRisco;
    }

    saida.set(chave, info);
  }

  return saida;
}
