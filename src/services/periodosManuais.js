import { getSupabase } from './supabaseClient.js';
import { romanLevel } from '../dataParser.js';
import { nivelExibicao, validarNivel, validarStatus } from './ajustesService.js';
import { buildMonthlyLabelMap, janelaDeAnos } from './dashboardService.js';

// ---------------------------------------------------------------------------
// CADASTRO MANUAL DE PERÍODOS (Matriz histórica → "Atualizar dados").
//
// Estrutura: reutiliza public.avaliacoes_diretores_periodos (sem tabela
// duplicada), vinculada por registro_id (→ avaliacao_id) e por mês/ano
// normalizados no rotulo_periodo ("OUT/2026"; fechamento de trimestre
// "DEZ/4TRI 2026"). A linha nasce com origem = 'cadastro_manual'.
//
// EDIÇÃO de Status/Nível (inclusive completar campos vazios de um período
// importado) NUNCA escreve nestas linhas: acontece na camada de ajustes
// (avaliacoes_diretores_ajustes, origem "ajuste manual"), preservando o valor
// original da planilha.
//
// ORIGEM E PRIORIDADE (vigência): ajuste manual > cadastro manual > valor
// importado. Uma planilha futura só insere novas linhas — nunca sobrescreve
// valores manuais.
// ---------------------------------------------------------------------------

const PER = 'avaliacoes_diretores_periodos';

export const MES3 = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
export const MES_NOME = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
export const MESES = MES3.map((sigla, i) => ({ valor: i + 1, sigla, nome: MES_NOME[i] }));

export function trimestreDoMes(mes){
  return Math.ceil(Number(mes) / 3);
}

export function ehFechamentoTrimestral(mes){
  const m = Number(mes);
  return Number.isInteger(m) && m >= 1 && m <= 12 && m % 3 === 0;
}

/** Rótulo normalizado gerado ao salvar: "OUT/2026" ou "DEZ/4TRI 2026". */
export function gerarRotuloPeriodo(mes, ano){
  const m = Number(mes), a = Number(ano);
  const sigla = MES3[m - 1];
  return ehFechamentoTrimestral(m) ? `${sigla}/${trimestreDoMes(m)}TRI ${a}` : `${sigla}/${a}`;
}

/** Ano inicial sugerido no formulário, sempre dentro da janela válida. */
export function anoSugerido(avaliacoes){
  const anos = (avaliacoes || []).map(a => Number(a?.ano)).filter(Number.isFinite);
  const base = anos.length ? Math.max(...anos) : new Date().getFullYear();
  const { janela } = janelaDeAnos(avaliacoes);
  return String(Math.min(Math.max(base, janela[0]), janela[1]));
}

/** Célula importada vazia: '', "Não informado" e marcadores comuns. */
export function eValorVazio(v){
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if(!t) return true;
  const n = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return ['NAO INFORMADO', '-', '—', 'N/D', 'ND', 'S/N', 'N/A'].includes(n);
}

/** Origem exibida do período (vigente): ajuste manual > cadastro > planilha. */
export function origemDoPeriodo(p){
  if(!p) return '—';
  if(p.ajustado) return 'Ajuste manual';
  if(p.origem === 'cadastro_manual') return 'Cadastro manual';
  return 'Planilha';
}

function validarMes(mes){
  const n = Number(mes);
  if(!Number.isInteger(n) || n < 1 || n > 12){
    throw new Error('Selecione um mês entre janeiro e dezembro.');
  }
  return n;
}

function validarAno(ano, janela){
  const t = String(ano ?? '').trim();
  if(!/^\d{4}$/.test(t)) throw new Error('Informe o ano com quatro dígitos (ex.: 2026).');
  const n = Number(t);
  if(n < janela[0] || n > janela[1]){
    throw new Error(`Ano inválido: informe um ano entre ${janela[0]} e ${janela[1]}.`);
  }
  return n;
}

/**
 * Cadastra um período novo para o registro do diretor. Valida mês, ano,
 * Status e Nível; gera rótulo normalizado, trimestre (mar/jun/sep/dez) e ordem
 * cronológica; bloqueia ano inválido e período duplicado no MESMO registro.
 * Devolve o período gravado e as linhas reposicionadas (ordem), para o modelo
 * em memória ser atualizado na hora (sem F5).
 */
export async function salvarPeriodoManual({ registroId, avaliacaoId, avaliacoes, mes, ano, status, nivel, opcoes } = {}){
  const m = validarMes(mes);
  const { janela } = janelaDeAnos(avaliacoes || []);
  const a = validarAno(ano, janela);
  const statusValido = validarStatus(status, opcoes);
  const { valor: nivelRoman } = validarNivel(nivel);
  if(!registroId || !avaliacaoId){
    throw new Error('Não foi possível identificar o registro do diretor.');
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from(PER)
    .select('id, registro_id, rotulo_periodo, ordem')
    .eq('registro_id', registroId)
    .order('ordem', { ascending: true });
  if(error) throw new Error(error.message || 'Não foi possível ler os períodos do diretor.');

  const existentes = data || [];
  const { labelMap } = buildMonthlyLabelMap(
    [{ avaliacaoId, periodos: existentes.map(p => ({ rotulo: p.rotulo_periodo, ordem: p.ordem })) }],
    avaliacoes || []
  );
  const infoDe = p => labelMap.get(`${avaliacaoId}|${p.rotulo_periodo}`) || null;

  const duplicado = existentes.find(p => {
    const info = infoDe(p);
    return info && info.month === m && info.year === a;
  });
  if(duplicado){
    throw new Error(`Período duplicado: ${MES3[m - 1]}/${a} já existe no registro atual deste diretor.`);
  }

  const antes = existentes.filter(p => {
    const info = infoDe(p);
    if(!info) return true;
    return info.year < a || (info.year === a && info.month < m);
  });
  const posicao = antes.length;

  const deslocados = [];
  for(let i = posicao; i < existentes.length; i++){
    const p = existentes[i];
    const novaOrdem = i + 1;
    if(Number(p.ordem) === novaOrdem) continue;
    const { error: errOrdem } = await sb.from(PER).update({ ordem: novaOrdem }).eq('id', p.id);
    if(errOrdem) throw new Error(errOrdem.message || 'Não foi possível reposicionar os períodos do diretor.');
    deslocados.push({ id: p.id, ordem: novaOrdem });
  }

  const rotulo = gerarRotuloPeriodo(m, a);
  const { data: criado, error: errIns } = await sb
    .from(PER)
    .insert({
      registro_id: registroId,
      rotulo_periodo: rotulo,
      ordem: posicao,
      estagio: statusValido,
      nivel: nivelExibicao(nivelRoman),
      origem: 'cadastro_manual'
    })
    .select('id, registro_id, rotulo_periodo, ordem, estagio, nivel, origem')
    .single();
  if(errIns) throw new Error(errIns.message || 'Não foi possível cadastrar o período.');

  return {
    registroId,
    avaliacaoId,
    periodo: criado,
    deslocados,
    rotulo,
    trimestre: ehFechamentoTrimestral(m) ? trimestreDoMes(m) : null
  };
}

/**
 * Aplica no modelo em memória um período recém-cadastrado (e eventuais linhas
 * reposicionadas): Matriz, gráfico mensal e resumo do último período
 * atualizam imediatamente, sem recarregar a página.
 */
export function aplicarPeriodoManualNoModelo(model, { registroId, periodo, deslocados = [] } = {}){
  if(!model || !registroId || !periodo) return model;
  const novasOrdens = new Map(deslocados.map(d => [d.id, d.ordem]));
  const registros = (model.registros || []).map(r => {
    if(r.id !== registroId) return r;
    const existentes = (r.periodos || []).map(p =>
      novasOrdens.has(p.id) ? { ...p, ordem: novasOrdens.get(p.id) } : p);
    const novo = {
      id: periodo.id,
      rotulo: periodo.rotulo_periodo,
      ordem: periodo.ordem,
      estagio: periodo.estagio,
      nivel: periodo.nivel,
      nivelRoman: romanLevel(periodo.nivel),
      estagioOriginal: periodo.estagio,
      nivelOriginal: romanLevel(periodo.nivel),
      ajustado: false,
      origem: periodo.origem === 'cadastro_manual' ? 'cadastro_manual' : 'planilha'
    };
    const periodos = [...existentes, novo].sort((x, y) => (x.ordem ?? 0) - (y.ordem ?? 0));
    return { ...r, periodos };
  });
  return { ...model, registros };
}

/**
 * Linhas da TABELA "Períodos existentes" do painel (uma linha por MÊS/ANO):
 *  * rótulo padronizado do mês/ano (labelMap: "SET/2026", "JAN DE 2026" →
 *    "JAN/2026", "2TRI/25" → "JUN/2025") — nunca composto com a avaliação;
 *  * mês repetido entre avaliações vira UMA linha, mantendo o período com
 *    MAIOR prioridade de vigência (ajuste manual > cadastro manual >
 *    importado) e, em empate, a avaliação mais recente;
 *  * ordem: do período mais recente para o mais antigo (períodos sem
 *    mês/ano reconhecível ficam no fim, na ordem encontrada).
 * Cada linha carrega { chave, registro, periodo, info } — edição e painel de
 * indicadores usam registro/período REAIS (nunca só o rótulo).
 */
export function linhasPeriodosDoDiretor(registros, avaliacoes){
  const ordemAval = new Map((avaliacoes || []).map((a, i) => [a.id, i]));
  const lista = [...(registros || [])].sort((a, b) =>
    (ordemAval.get(a.avaliacaoId) ?? -1) - (ordemAval.get(b.avaliacaoId) ?? -1));
  const { labelMap } = buildMonthlyLabelMap(
    lista.map(r => ({
      avaliacaoId: r.avaliacaoId,
      periodos: (r.periodos || []).map(p => ({ rotulo: p.rotulo, ordem: p.ordem }))
    })),
    avaliacoes || []
  );
  const prioridade = p => (p?.ajustado ? 2 : 0) + (p?.origem === 'cadastro_manual' ? 1 : 0);
  const melhores = new Map();
  for(const r of lista){
    for(const p of (r.periodos || [])){
      const info = labelMap.get(`${r.avaliacaoId}|${p.rotulo}`) || null;
      const chaveMes = info ? `mes:${info.year}-${info.month}` : `rot:${p.rotulo}`;
      const candidato = { chave: `${r.id}|${p.id}`, registro: r, periodo: p, info };
      const atual = melhores.get(chaveMes);
      if(!atual){
        melhores.set(chaveMes, candidato);
        continue;
      }
      const pv = prioridade(p), pa = prioridade(atual.periodo);
      const ra = ordemAval.get(r.avaliacaoId) ?? -1;
      const rb = ordemAval.get(atual.registro.avaliacaoId) ?? -1;
      if(pv > pa || (pv === pa && ra >= rb)) melhores.set(chaveMes, candidato);
    }
  }
  const linhas = [...melhores.values()];
  linhas.sort((a, b) => {
    if(a.info && b.info) return (b.info.year - a.info.year) || (b.info.month - a.info.month);
    if(a.info) return -1;
    if(b.info) return 1;
    return 0;
  });
  return linhas;
}
