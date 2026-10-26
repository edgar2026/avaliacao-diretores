import type { WorkbookAnalysis } from './planilha';
import type { Status, NivelRoman } from './status';

// ---------------------------------------------------------------------------
// PRÉVIA DA ATUALIZAÇÃO PELA PLANILHA (previewService + importPlan)
// ---------------------------------------------------------------------------

// Ação real sobre uma divergência: o sistema atualiza o valor ou o mantém
// (prioridade manual/cadastro manual sobre a nova planilha).
export type AcaoDivergencia = 'atualizado' | 'mantido';

// Origem do valor vigente que gerou a divergência.
export type OrigemDivergencia = 'Ajuste manual' | 'Cadastro manual' | 'Planilha' | string;

// Divergência entre planilha e sistema (Status/Nível/indicador).
export interface Divergencia {
  tipo: 'status' | 'nivel' | 'indicador' | string;
  campo?: string;
  acao: AcaoDivergencia;
  origem: OrigemDivergencia;
  diretor: string;
  unidade: string;
  periodo?: string;
  valorSistema: unknown;
  valorPlanilha: unknown;
  valorSistemaExibido: string;
  valorPlanilhaExibido: string;
}

// Pendência/alerta da prévia (arquivo idêntico, linhas ignoradas etc.).
export interface Pendencia {
  tipo: string;
  mensagem: string;
  bloqueia?: boolean;
}

// Referência dinâmica dos indicadores (período mais recente da planilha).
export interface ReferenciaIndicadores {
  atual: string;
  nova: string;
  avanca: boolean;
}

// Contagem de períodos novos por rótulo.
export interface PeriodoNovoResumo {
  label: string;
  comStatus: number;
  comNivel: number;
  semPreenchimento: number;
  registros: number;
}

// Detalhe de uma completação de campo vazio (período existente + valor novo).
export interface Completacao {
  registroId?: string;
  periodoId?: string;
  campo: string;
  valor?: unknown;
  [chave: string]: unknown;
}

// Ajuste manual preservado (detalhe exibido na prévia).
export interface AjustePreservado {
  diretor: string | null;
  unidade: string | null;
  periodo: string | null;
  statusOriginal: string;
  nivelOriginal: string;
  statusVigente: string;
  nivelVigente: string;
}

// Detalhe de indicador por registro (valores não nulos).
export interface IndicadorDetalhe {
  diretor: string;
  unidade: string;
  valores: { nome: string; valor: number | null }[];
}

// Contagens de registros (novos/reutilizados/reativados/arquivados/ignorados).
export interface ResumoRegistros {
  novos: number;
  reutilizados: number;
  reativados: number;
  arquivados: number;
  ignoradas: number;
  ignoradasSemDiretor: number;
  ignoradasSemUnidade: number;
  novosDetalhes: string[];
  reativadosDetalhes: string[];
  arquivadosDetalhes: string[];
  ignoradasDetalhes: string[];
}

// Mudança de regional/unidade detectada na nova planilha.
export interface MudancaCadastro {
  diretor: string;
  unidade?: string;
  anterior: string;
  novo: string;
}

// Cadastros identificados (somente identificação — nada é re-vinculado).
export interface CadastrosPrev {
  regionaisNovas: string[];
  diretoresExistentes: number;
  diretoresNovos: string[];
  unidadesExistentes: number;
  unidadesNovas: string[];
  semDiretor: number;
  mudancasRegional: MudancaCadastro[];
  mudancasUnidade: MudancaCadastro[];
}

// Resultado completo da prévia — objeto pronto para a UI.
export interface PreviewResult {
  analisadoEm: string;
  arquivoNome: string;
  periodoMaisRecente: string;
  totalRegistros: number;
  totalDiretores: number;
  totalUnidades: number;
  totalPeriodosIdentificados: number;
  referencia: ReferenciaIndicadores;
  registros: ResumoRegistros;
  novosPeriodos: PeriodoNovoResumo[];
  completacoes: Completacao[];
  divergencias: Divergencia[];
  divergenciasMantidas: Divergencia[];
  periodosPreservados: { total: number; registros: number; rotulos: string[] };
  ajustesPreservados: { total: number; detalhes: AjustePreservado[] };
  indicadores: {
    totalRegistros: number;
    referencia: string;
    nomes: string[];
    detalhes: IndicadorDetalhe[];
    atualizados: number;
    novos: number;
    registrosComMudanca: number;
    preservadosPorAjuste: { diretor: string; unidade: string; campo: string; valorSistema: string; valorPlanilha: string }[];
  };
  cadastros: CadastrosPrev;
  pendencias: Pendencia[];
  bloqueado: boolean;
}

// Resumo numérico do plano de atualização (importPlan.planejarAtualizacao).
export interface ResumoPlano {
  ignoradas: number;
  ignoradasSemDiretor: number;
  ignoradasSemUnidade: number;
  novos: number;
  existentes: number;
  reutilizados: number;
  reativados: number;
  arquivados: number;
  periodosNovos: number;
  completacoes: number;
  divergencias: number;
  divergenciasMantidas: number;
  divergenciasAtualizadas: number;
  situacoes: number;
  indicadoresAtualizados: number;
  indicadoresNovos: number;
  registrosComIndicadores: number;
}

// Linha gravável de período (usada nas inserções do plano).
export interface LinhaPeriodo {
  registro_id?: string;
  rotulo_periodo: string;
  ordem?: number;
  estagio?: Status | null;
  nivel?: string | null;
  origem?: string;
  [chave: string]: unknown;
}

// Entrada de inserção de períodos em registro existente.
export interface InsercaoPeriodos {
  registroId: string;
  diretor: string;
  unidade: string;
  rows: LinhaPeriodo[];
}

// Bloco de períodos do plano (inserções + completações + reordenações).
export interface PlanoPeriodos {
  insercoesNovos: LinhaPeriodo[];
  insercoesExistentes: InsercaoPeriodos[];
  completacoes: Completacao[];
  reordenacoes?: { id: string; ordem: number }[];
}

// Plano completo de atualização (função pura usada pela prévia E pela gravação).
export interface PlanoAtualizacao {
  janela: { min: number; max: number };
  resumo: ResumoPlano;
  novos: { diretor: string; unidade: string; registro: Record<string, unknown> }[];
  reativados: { diretor: string; unidade: string }[];
  arquivados: { id: string; diretor: string; unidade: string }[];
  ignoradas: { linha: number; diretor: string; unidade: string; motivo: 'sem-diretor' | 'sem-unidade' }[];
  periodos: PlanoPeriodos;
  divergencias: Omit<Divergencia, 'valorSistemaExibido' | 'valorPlanilhaExibido'>[];
  registrosAtualizacoes: { id: string; patch: Record<string, unknown>; reativado: boolean }[];
  indicadoresAtualizacoes: unknown[];
  indicadoresInsercoes: unknown[];
  situacoes: { registroId: string; diretor: string; unidade: string; patch: Record<string, unknown> }[];
}

// ---------------------------------------------------------------------------
// ESTÁGIOS E ERROS DA IMPORTAÇÃO (importService)
// ---------------------------------------------------------------------------

export type ImportStage =
  | 'validando'
  | 'enviando'
  | 'salvando'
  | 'atualizando_periodos'
  | 'atualizando_indicadores'
  | 'atualizando_cadastros'
  | 'concluido';

export interface ImportErrorInfo {
  stage: ImportStage | null;
  code: string;
  details: unknown;
}

// Reexporta a análise da planilha para conveniência do fluxo de importação.
export type { WorkbookAnalysis };

// Período original (auditoria) de um registro — usado na prévia de ajustes.
export interface PeriodoOriginal {
  statusOriginal: Status;
  nivelOriginal: NivelRoman | null;
}
