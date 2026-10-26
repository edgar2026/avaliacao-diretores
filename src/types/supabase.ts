// Linhas cruas das tabelas do Supabase (snake_case, conforme o banco). Estes
// são os contratos das CONSULTAS; o modelo em memória (camelCase) está em
// `modelo.ts`.

export interface AvaliacaoRow {
  id: string;
  titulo?: string | null;
  ano: number;
  trimestre: number;
  status?: string | null;
  total_registros?: number | null;
  total_colunas?: number | null;
  arquivo_nome_original?: string | null;
  storage_path?: string | null;
  publicado_em?: string | null;
  importado_em?: string | null;
  arquivo_hash?: string | null;
}

export interface RegistroRow {
  id: string;
  avaliacao_id: string;
  codigo_regional?: string | null;
  regional: string | null;
  diretor: string | null;
  unidade: string | null;
  status_gestao?: string | null;
  ciclo_vida?: string | null;
  nivel_atual?: string | null;
  numero_linha_origem?: number | null;
  arquivado_em?: string | null;
}

export interface PeriodoRow {
  id: string;
  registro_id: string;
  rotulo_periodo: string;
  ordem?: number | null;
  estagio?: string | null;
  nivel?: string | null;
  origem?: string | null;
}

export interface IndicadorRow {
  id: string;
  registro_id: string;
  nome_indicador: string;
  valor_numerico?: number | string | null;
  valor_texto?: string | null;
  unidade_medida?: string | null;
  ordem?: number | null;
}

export interface AjusteRow {
  id: string;
  avaliacao_id?: string | null;
  registro_id: string;
  periodo_id: string;
  status_original?: string | null;
  nivel_original?: string | null;
  status_ajustado?: string | null;
  nivel_ajustado?: string | null;
  arquivada_em?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  criado_por?: string | null;
  atualizado_por?: string | null;
}

export interface AjusteIndicadorRow {
  id: string;
  avaliacao_id?: string | null;
  registro_id: string;
  chave_indicador: string;
  nome_indicador?: string | null;
  valor_manual?: number | string | null;
  valor_importado?: number | string | null;
  origem?: string | null;
  arquivada_em?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  criado_por?: string | null;
  atualizado_por?: string | null;
}

// Tabela `avaliacoes_diretores_observacoes` — usada por observações comuns e
// pelos pareceres do diretor (`tipo` regional/operacoes, coluna de texto
// `observacao`).
export interface ObservacaoRow {
  id: string;
  avaliacao_id?: string | null;
  registro_id?: string | null;
  escopo?: string | null;
  regional?: string | null;
  diretor?: string | null;
  tipo?: string | null;
  observacao?: string | null;
  criado_por?: string | null;
  atualizado_por?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  arquivada_em?: string | null;
}
