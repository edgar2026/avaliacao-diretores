import type { Registro, PeriodoGrafico } from './modelo';
import type { StatusConhecido } from './status';

// ---------------------------------------------------------------------------
// GRÁFICOS — indicadores de mudança, séries e props de componentes
// ---------------------------------------------------------------------------

// Tipo do indicador de mudança entre dois períodos consecutivos (Status e
// Nível). Prioridade: Status > Nível.
export type TipoMudanca =
  | 'status-up'
  | 'status-down'
  | 'level-up'
  | 'level-down'
  | 'unchanged'
  | 'indeterminate';

// Classe CSS do ícone de seta (sobe/desce/igual) no gráfico de evolução.
export type ClasseSeta = 'up' | 'down' | 'same';

// Seta de mudança entre períodos (formato do path SVG + classe de cor).
export interface SetaConfig {
  s: string;
  classe: ClasseSeta;
}

// Configuração visual de um status de gestão no gráfico de evolução.
export interface StatusEvoConfig {
  chave: string;
  nome: string;
  ordem: number | null;
  cor: string;
  texto: string;
  borda: string;
}

// Métrica de um ponto do gráfico de radar (valor normalizado 0..1).
export interface MetricaRadar {
  nome: string;
  valor: number;
  max: number;
}

// Dados de um ponto do gráfico de radar por registro.
export interface RadarRecord {
  diretor: string;
  unidade: string;
  metricas: MetricaRadar[];
}

// Configuração do gráfico de evolução mensal (status e nível ao longo do tempo).
export interface MonthlyEvolutionChartProps {
  registros: Registro[];
  registrosArquivados?: Registro[];
  statusEvo?: StatusEvoConfig[];
  periods?: PeriodoGrafico[];
  onPeriodClick?: (periodo: PeriodoGrafico) => void;
}

// Configuração do gráfico de radar (indicadores comparados).
export interface RadarChartProps {
  registros: Registro[];
  allRecords?: Registro[];
  onRecordClick?: (registro: Registro) => void;
}

// Resumo do card de evolução do diretor (último período + mudanças).
export interface ResumoEvolucao {
  diretor: string;
  unidade: string;
  regional: string;
  ultimoStatus: string | null;
  ultimoNivel: string | null;
  ultimoPeriodo: string | null;
  mudancaStatus: TipoMudanca;
  mudancaNivel: TipoMudanca;
  indicadores: { nome: string; valor: number | null }[];
}

// Opção do filtro de status (chave + nome + ordem de exibição).
export interface OpcaoStatus {
  chave: StatusConhecido;
  nome: string;
  ordem: number | null;
}
