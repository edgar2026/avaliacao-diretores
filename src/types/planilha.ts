// Estruturas do parser da planilha (`dataParser`): análise da aba Planilha1 e
// registros crus antes de irem para o banco.

export interface CampoPlanilha {
  key: string;
  label: string;
  required: boolean;
  found: boolean;
}

export interface ColunaPeriodo {
  valueCol: number;
  levelCol: number;
  label: string;
}

export interface ColunaIndicador {
  name: string;
  column: number;
  ordem: number;
}

// Célula do histórico mensal: período (rótulo bruto da planilha), estágio
// (Status) e nível (algarismo ou texto livre).
export interface CelulaHistorico {
  period: string;
  stage: string;
  level: string;
}

export interface IndicadorPlanilhaLinha {
  name: string;
  ordem?: number | null;
  valor_numerico: number | null;
  valor_texto: string | null;
  unidade_medida: string | null;
}

// Linha de dado da planilha: uma ENTIDADE (Diretor + Unidade) com histórico
// completo de períodos, status/ciclo/nível atuais, métricas numéricas e
// indicadores nomeados.
export interface RegistroPlanilha {
  id: string;
  regionalCode: string;
  regional: string;
  director: string;
  unit: string;
  history: CelulaHistorico[];
  currentStage: string;
  lifeCycle: string;
  currentLevel: string;
  metrics: Record<string, number | null>;
  indicators: IndicadorPlanilhaLinha[];
}

export interface CelulaInvalida {
  diretor: string;
  unidade: string;
  indicador: string;
  valor: string;
}

export interface DuplicidadePlanilha {
  regional: string;
  director: string;
  unit: string;
  count: number;
}

// Resultado completo de analyzeRows/analyzeWorkbookBuffer.
export interface WorkbookAnalysis {
  ok: boolean;
  sourceName: string;
  sheetName: string;
  headerRow: number;
  totalRows: number;
  dataRowCount: number;
  columnCount: number;
  fields: CampoPlanilha[];
  missingRequired: CampoPlanilha[];
  missingOptional: CampoPlanilha[];
  periods: ColunaPeriodo[];
  periodLabels: string[];
  indicatorColumns: { name: string; ordem: number }[];
  regionals: string[];
  directors: string[];
  units: string[];
  rowsWithoutDirector: number;
  duplicates: DuplicidadePlanilha[];
  invalidMetricCells: CelulaInvalida[];
  records: RegistroPlanilha[];
  importedAt: string;
  sheetNames?: string[];
}

// Dataset pronto para importação (subset da análise usado pelo fluxo).
export interface DatasetPlanilha {
  records: RegistroPlanilha[];
  periods: string[];
  sourceName: string;
  importedAt: string;
}
