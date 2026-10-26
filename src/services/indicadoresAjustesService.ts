import { getSupabase } from './supabaseClient.js';
import type { AjusteIndicadorRow } from '../types/supabase';

// ---------------------------------------------------------------------------
// PONTUAÇÕES E INDICADORES — cadastro/edição manual
// (Matriz histórica → "Atualizar dados" → "Pontuações e indicadores").
//
// Estrutura: tabela separada avaliacoes_diretores_indicadores_ajustes,
// vinculada por avaliacao_id + registro_id + chave amigável do indicador.
// O dado importado NUNCA é alterado: continua em
// avaliacoes_diretores_indicadores (EAV) para consulta/auditoria; o valor
// VIGENTE é resolvido pela regra centralizada de dashboardService:
// ajuste manual > valor importado, com propagação apenas para planilhas
// futuras do mesmo diretor (histórico anterior nunca é reescrito).
//
// Formatos: notas em número (aceita vírgula ou ponto; sem faixa fixa — os
// dados reais variam); percentuais digitados em % (10 = 10%) e gravados como
// FRAÇÃO (0.1), a mesma unidade do EAV e de formatMetricCell. Campo em branco
// NUNCA vira zero.
// ---------------------------------------------------------------------------

const TABELA = 'avaliacoes_diretores_indicadores_ajustes';

export interface CampoIndicador {
  chave: string;
  rotulo: string;
  tipo: 'nota' | 'percentual';
}

export const CAMPOS_NOTA: CampoIndicador[] = [
  { chave: 'Presencial', rotulo: 'Presencial', tipo: 'nota' },
  { chave: 'Acadêmico', rotulo: 'Acadêmico', tipo: 'nota' },
  { chave: 'Pós-graduação', rotulo: 'Pós-graduação', tipo: 'nota' },
  { chave: 'Nota geral', rotulo: 'Nota geral', tipo: 'nota' },
  { chave: 'Avaliação institucional', rotulo: 'Avaliação institucional', tipo: 'nota' }
];

export const CAMPOS_PERCENTUAL: CampoIndicador[] = [
  { chave: 'Ritmo de captação', rotulo: 'Ritmo de captação', tipo: 'percentual' },
  { chave: 'Crescimento de matrículas', rotulo: 'Crescimento de matrículas', tipo: 'percentual' },
  { chave: 'Evasão', rotulo: 'Evasão', tipo: 'percentual' },
  { chave: 'EBITDA', rotulo: 'EBITDA', tipo: 'percentual' }
];

export const CAMPOS_INDICADORES: CampoIndicador[] = [...CAMPOS_NOTA, ...CAMPOS_PERCENTUAL];

const RE_NUMERO = /^[+-]?\d+([.,]\d+)?$/;
const txt = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Texto digitado → número (fração nos percentuais). Vazio → null (nunca 0). */
export function parseValorIndicador(texto: unknown, tipo: CampoIndicador['tipo']): number | null {
  const t = txt(texto);
  if(!t) return null;
  if(!RE_NUMERO.test(t)){
    throw new Error(`Número inválido: use apenas dígitos com vírgula ou ponto (ex.: ${tipo === 'percentual' ? '10,5' : '3,25'}).`);
  }
  const n = Number(t.replace(',', '.'));
  if(!Number.isFinite(n)) throw new Error('Número inválido: informe um valor válido.');
  return tipo === 'percentual' ? n / 100 : n;
}

/** Número → texto de entrada do formulário (mesma leitura da exibição). */
export function formatarEntradaIndicador(valor: unknown, tipo: CampoIndicador['tipo']): string {
  if(valor == null || !Number.isFinite(Number(valor))) return '';
  const n = Number(valor);
  return tipo === 'percentual'
    ? (n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
    : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/**
 * Igualdade pela representação VISÍVEL: os valores importados vêm de fórmulas
 * da planilha (muitas casas decimais). Reenviar a mesma leitura exibida não é
 * alteração — e a comparação em string evita erro de arredondamento.
 */
export function mesmoValorIndicador(a: unknown, b: unknown, tipo: CampoIndicador['tipo']): boolean {
  if(a == null || b == null) return a == null && b == null;
  return formatarEntradaIndicador(a, tipo) === formatarEntradaIndicador(b, tipo);
}

export interface SalvarAjustesIndicadoresPayload {
  avaliacaoId?: string;
  registroId?: string;
  campos?: CampoIndicador[];
  entradas?: Record<string, string> | null;
  vigente?: Record<string, unknown> | null;
  importado?: Record<string, unknown> | null;
}

/**
 * Salva os campos alterados do registro do diretor. Só grava o que o usuário
 * digitou E que difere do vigente; vazio/igual é ignorado. `valor_original`
 * é capturado UMA vez (do importado) e nunca mais atualizado; reeditar
 * atualiza a MESMA linha ativa do (registro, chave).
 * Devolve as linhas gravadas para o modelo em memória ser atualizado na hora.
 */
export async function salvarAjustesIndicadores({ avaliacaoId, registroId, campos, entradas, vigente, importado }: SalvarAjustesIndicadoresPayload = {}): Promise<AjusteIndicadorRow[]> {
  const aval = txt(avaliacaoId);
  const reg = txt(registroId);
  if(!aval || !reg) throw new Error('Não foi possível identificar o registro do diretor.');

  const alterados: (CampoIndicador & { valor: number; atual: number | null })[] = [];
  for(const campo of campos || []){
    if(!entradas || !(campo.chave in entradas)) continue;
    const valor = parseValorIndicador(entradas[campo.chave], campo.tipo);
    if(valor == null) continue;
    const bruto = vigente ? vigente[campo.chave] : null;
    const atual = bruto == null || !Number.isFinite(Number(bruto)) ? null : Number(bruto);
    if(atual != null && mesmoValorIndicador(valor, atual, campo.tipo)) continue;
    alterados.push({ ...campo, valor, atual });
  }
  if(!alterados.length){
    throw new Error('Informe ao menos um valor diferente do vigente para salvar.');
  }

  const sb = getSupabase();
  const { data: existentes, error } = await sb
    .from(TABELA)
    .select('id, chave, valor_original, origem, created_at, updated_at')
    .eq('registro_id', reg)
    .is('arquivada_em', null);
  if(error) throw new Error(error.message || 'Não foi possível consultar os ajustes de indicadores.');
  const porChave = new Map((existentes || []).map(l => [(l as { chave: string }).chave, l]));

  const agora = new Date().toISOString();
  const paraAtualizar: { id: string; chave: string; valor_manual: number; origem: string }[] = [];
  const paraInserir: Record<string, unknown>[] = [];
  for(const alt of alterados){
    const origem = alt.atual == null ? 'cadastro_manual' : 'edicao_manual';
    const existente = porChave.get(alt.chave);
    if(existente){
      paraAtualizar.push({ id: (existente as { id: string }).id, chave: alt.chave, valor_manual: alt.valor, origem });
    } else {
      paraInserir.push({
        avaliacao_id: aval,
        registro_id: reg,
        chave: alt.chave,
        valor_original: importado && importado[alt.chave] != null && Number.isFinite(Number(importado[alt.chave]))
          ? Number(importado[alt.chave])
          : null,
        valor_manual: alt.valor,
        origem,
        criado_por: null,
        atualizado_por: null
      });
    }
  }

  const salvo: AjusteIndicadorRow[] = [];
  for(const linha of paraAtualizar){
    const { data, error: errUp } = await sb
      .from(TABELA)
      .update({ valor_manual: linha.valor_manual, origem: linha.origem, atualizado_por: null, updated_at: agora })
      .eq('id', linha.id)
      .select()
      .single();
    if(errUp) throw new Error(errUp.message || 'Não foi possível atualizar a pontuação/indicador.');
    salvo.push(data as unknown as AjusteIndicadorRow);
  }
  if(paraInserir.length){
    const { data, error: errIns } = await sb.from(TABELA).insert(paraInserir).select();
    if(errIns) throw new Error(errIns.message || 'Não foi possível salvar as pontuações/indicadores.');
    salvo.push(...((data || []) as unknown as AjusteIndicadorRow[]));
  }
  return salvo;
}
