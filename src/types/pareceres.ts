import type { ObservacaoRow } from './supabase';
import type { Registro } from './modelo';

// ---------------------------------------------------------------------------
// Pareceres do diretor — reutiliza a tabela de observações
// (avaliacoes_diretores_observacoes) com a coluna `tipo`.
// ---------------------------------------------------------------------------

// Tipo INTERNO no banco (a mudança do primeiro card é apenas visual: a tela
// mostra "JUSTIFICATIVA" para 'regional').
export type TipoParecer = 'regional' | 'operacoes';

// Rótulo VISUAL de cada tipo de parecer.
export type TipoParecerLabel = {
  regional: 'JUSTIFICATIVA';
  operacoes: 'Parecer de Operações';
};

// Filtro de consulta (col + operação + valor) usado por observacoes/pareceres.
export interface FiltroConsulta {
  col: string;
  op: 'eq' | 'is' | 'neq' | 'gt' | 'lt';
  valor: string | null;
}

// Payload para criar/editar um parecer.
export interface ParecerPayload {
  avaliacaoId?: string;
  registroId?: string;
  regional?: string;
  diretor?: string;
  tipo?: TipoParecer;
  texto?: string;
}

// Filtros de um parecer (diretor/regional/tipo).
export interface ParecerFiltros {
  tipo?: TipoParecer;
  regional?: string;
  diretor?: string;
  registros?: Registro[] | null;
}

// Reexporta a linha ObservacaoRow para conveniência dos services.
export type { ObservacaoRow };
