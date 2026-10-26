import type { Status, NivelAlgarismo, NivelRoman, OrigemDado } from './status';
import type { ValorVigente } from './ajustes';

// ---------------------------------------------------------------------------
// Modelo em memória (camelCase) usado pelos dashboards — montado a partir das
// linhas Supabase (supabase.ts) pelo `dashboardService.buildDashboardModel`.
// ---------------------------------------------------------------------------

// Informação de origem/auditoria de uma métrica vigente no registro.
export interface InfoMetrica {
  origem: 'planilha' | 'cadastro_manual' | 'edicao_manual';
  ajustado: boolean;
  atualizadoEm: string | null;
}

// Métricas numéricas vigentes (nome amigável → valor). Percentuais em fração
// (0.1 = 10%).
export type Metricas = Record<string, number | null>;

// Indicador nomeado de um registro (valor numérico OU texto).
export interface Indicador {
  id: string;
  nome: string;
  valorNumerico: number | null;
  valorTexto: string | null;
  unidadeMedida: string | null;
  ordem: number | null;
}

// Período (mensal/trimestral) de um registro, com Status/Nível vigentes
// (possivelmente ajustados manualmente) e os originais para auditoria.
export interface Periodo {
  id: string;
  rotulo: string | null;
  ordem: number | null;
  estagio: Status;
  nivel: string | null;
  nivelRoman: NivelRoman | null;
  estagioOriginal: Status;
  nivelOriginal: NivelRoman | null;
  ajustado: boolean;
  origem: OrigemDado;
}

// Entidade Diretor+Unidade reutilizada entre importações; `avaliacaoId` é a
// atribuição da criação e os períodos novos se acumulam no mesmo registro.
export interface Registro {
  id: string;
  avaliacaoId: string;
  avaliacaoLabel: string;
  codigoRegional: string | null;
  regional: string | null;
  diretor: string | null;
  unidade: string | null;
  statusGestao: string | null;
  cicloVida: string | null;
  nivelAtual: string | null;
  nivelRoman: NivelRoman | null;
  arquivado: boolean;
  metricas: Metricas;
  metricasImportado: Metricas;
  metricasInfo: Record<string, InfoMetrica>;
  indicadores: Indicador[];
  periodos: Periodo[];
}

// Avaliação publicada (uma importação) com seus registros ativos e agregados.
export interface AvaliacaoModel {
  id: string;
  titulo?: string | null;
  ano: number;
  trimestre: number;
  label: string;
  arquivoNome?: string | null;
  storagePath?: string | null;
  totalRegistros?: number | null;
  publicadoEm?: string | null;
  importadoEm?: string | null;
  registros: Registro[];
  agregados: AgregadosRegistro;
}

// Agregados de uma avaliação (contagens e médias).
export interface AgregadosRegistro {
  diretores: number;
  unidades: number;
  nivelMedio: number | null;
  metricas: Metricas;
}

// Modelo completo do dashboard: avaliações publicadas, registros ativos,
// registros arquivados (para detectar reativação na prévia) e ajustes de
// indicadores ativos.
export interface DashboardModel {
  avaliacoes: AvaliacaoModel[];
  registros: Registro[];
  registrosArquivados: Registro[];
  ajustesIndicadores: unknown[];
}

// Payload cru do Supabase usado por buildDashboardModel.
export interface DashboardRaw {
  avaliacoes: unknown[];
  registros: unknown[];
  periodos: unknown[];
  indicadores: unknown[];
  ajustes: unknown[];
  ajustesIndicadores: unknown[];
}

// Ponto do gráfico de evolução mensal (Status/Nível) — um período de um
// registro, já com rótulo composto quando repetido entre avaliações.
export interface PeriodoGrafico {
  label: string;
  rotulo: string | null;
  isQuarter: boolean;
  quarterLabel: string | null;
  status: Status;
  nivelRoman: NivelRoman | null;
  periodoId: string | null;
  registroId: string | null;
  avaliacaoId: string | null;
  statusOriginal: Status;
  nivelOriginal: NivelRoman | null;
  ajustado: boolean;
}

// Nomes canônicos de diretor e unidade (strings limpas).
export type NomeDiretor = string;
export type NomeUnidade = string;

// Valor vigente de um período — reexportado para conveniência dos services.
export type { ValorVigente };
