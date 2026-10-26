import type { Status, NivelAlgarismo, NivelRoman, Nivel } from './status';

// ---------------------------------------------------------------------------
// Ajustes manuais de Status/Nível por período
// ---------------------------------------------------------------------------

// Valor vigente de um período (Status + Nível) considerando ajuste manual
// ativo, se houver. `statusOriginal`/`nivelOriginal` preservam a auditoria do
// que veio da planilha.
export interface ValorVigente {
  status: Status;
  nivel: NivelRoman | null;
  statusOriginal: Status;
  nivelOriginal: NivelRoman | null;
  ajustado: boolean;
}

// Opção do seletor de nível no editor de períodos.
export interface OpcaoNivel {
  valor: NivelAlgarismo;
  nivel: NivelRoman;
}

// Resultado da validação de um nível enviado pelo formulário.
export interface ResultadoValidacaoNivel {
  valor: NivelAlgarismo | 'Não informado';
  nivel: NivelRoman | null;
}

// Payload gravado pelo editor de períodos (Status/Nível ajustados manualmente).
export interface SalvarAjustePayload {
  avaliacaoId?: string;
  registroId?: string;
  periodoId?: string;
  statusAjustado?: Status;
  nivelAjustado?: Nivel;
  opcoes?: Status[];
}

// Payload da restauração (desfazer ajuste manual de um período).
export interface RestaurarPayload {
  periodoId?: string;
}

export interface AplicarRestauracaoPayload {
  periodoId?: string;
  registroId?: string;
}

// ---------------------------------------------------------------------------
// Ajustes manuais de indicadores/pontuações
// ---------------------------------------------------------------------------

// Ajuste de indicador (EAV) — linha da tabela de ajustes de indicadores.
export interface AjusteIndicador {
  id: string;
  registro_id: string;
  chave_indicador: string;
  nome_indicador?: string | null;
  valor_manual?: number | string | null;
  valor_importado?: number | string | null;
  origem?: string | null;
  arquivada_em?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// Payload para salvar um ajuste de indicador.
export interface SalvarAjusteIndicadorPayload {
  registroId?: string;
  chaveIndicador?: string;
  nomeIndicador?: string;
  valorManual?: number | string | null;
  valorImportado?: number | string | null;
  origem?: string;
}
