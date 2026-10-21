import { getSupabase } from './supabaseClient.js';
import { friendlyMetricName, romanLevel } from '../dataParser.js';
import { valorVigente, nivelExibicao } from './ajustesService.js';

const AV = 'avaliacoes_diretores';
const REG = 'avaliacoes_diretores_registros';
const PER = 'avaliacoes_diretores_periodos';
const IND = 'avaliacoes_diretores_indicadores';
const AJ = 'avaliacoes_diretores_ajustes';
const AJI = 'avaliacoes_diretores_indicadores_ajustes';

// Tamanhos de lote/página: nunca uma requisição por registro (sem N+1).
const PAGE_SIZE = 500;
const AVALIACOES_POR_REQUISICAO = 20;
const REGISTRO_IDS_POR_REQUISICAO = 100;

function fail(error, context){
  if(error) throw new Error(`${context}: ${error.message || error}`);
}

// Paginação por range até esgotar as linhas (PostgREST limita a ~1000/página).
async function fetchAll(buildQuery){
  const out = [];
  let from = 0;
  for(;;){
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    fail(error, 'Falha ao consultar o Supabase');
    out.push(...(data || []));
    if(!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

function chunks(items, size){
  const out = [];
  for(let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Carrega todas as avaliações PUBLICADAS e suas linhas/períodos/indicadores.
 * Consulta somente `status = 'publicada'`. Não inclui `dados_originais` (jsonb
 * pesado, dispensado na leitura). Total de requisições ≈ 1 + nºdeLotes.
 */
export async function loadPublishedDashboard(){
  const supabase = getSupabase();

  const avaliacoes = await fetchAll(() => supabase
    .from(AV)
    .select('id, titulo, ano, trimestre, status, total_registros, total_colunas, arquivo_nome_original, storage_path, publicado_em, importado_em')
    .eq('status', 'publicada')
    .order('ano', { ascending: true })
    .order('trimestre', { ascending: true })
    .order('importado_em', { ascending: true }));

  if(avaliacoes.length === 0){
    return { avaliacoes: [], registros: [], periodos: [], indicadores: [], ajustes: [], ajustesIndicadores: [] };
  }

  const registros = [];
  for(const lote of chunks(avaliacoes.map(a => a.id), AVALIACOES_POR_REQUISICAO)){
    const rows = await fetchAll(() => supabase
      .from(REG)
      .select('id, avaliacao_id, codigo_regional, regional, diretor, unidade, status_gestao, ciclo_vida, nivel_atual, numero_linha_origem, arquivado_em')
      .in('avaliacao_id', lote)
      .order('avaliacao_id', { ascending: true })
      .order('numero_linha_origem', { ascending: true, nullsFirst: false }));
    registros.push(...rows);
  }

  const registroIds = registros.map(r => r.id);
  const periodos = [];
  const indicadores = [];
  for(const lote of chunks(registroIds, REGISTRO_IDS_POR_REQUISICAO)){
    const [per, ind] = await Promise.all([
      fetchAll(() => supabase
        .from(PER)
        .select('id, registro_id, rotulo_periodo, ordem, estagio, nivel, origem')
        .in('registro_id', lote)
        .order('registro_id', { ascending: true })
        .order('ordem', { ascending: true })),
      fetchAll(() => supabase
        .from(IND)
        .select('id, registro_id, nome_indicador, valor_numerico, valor_texto, unidade_medida, ordem')
        .in('registro_id', lote)
        .order('registro_id', { ascending: true })
        .order('ordem', { ascending: true }))
    ]);
    periodos.push(...per);
    indicadores.push(...ind);
  }

  // Ajustes manuais de status/nível (camada adicional sobre o dado
  // importado). Se a consulta falhar (ex.: ambiente sem a tabela), o
  // dashboard continua normalmente apenas com o valor importado.
  let ajustes = [];
  try {
    ajustes = await fetchAll(() => supabase
      .from(AJ)
      .select('id, avaliacao_id, registro_id, periodo_id, status_original, nivel_original, status_ajustado, nivel_ajustado, arquivada_em')
      .is('arquivada_em', null));
  } catch (err) {
    console.warn('[avaliacao-diretores] Ajustes manuais indisponíveis, usando apenas o dado importado:', err?.message || String(err));
    ajustes = [];
  }

  // Ajustes manuais de pontuações/indicadores (camada adicional sobre o
  // valor importado do EAV). Mesma tolerância: sem a tabela o dashboard
  // continua apenas com o dado importado.
  let ajustesIndicadores = [];
  try {
    ajustesIndicadores = await fetchAll(() => supabase
      .from(AJI)
      .select('id, avaliacao_id, registro_id, chave, valor_original, valor_manual, origem, arquivada_em, created_at, updated_at')
      .is('arquivada_em', null));
  } catch (err) {
    console.warn('[avaliacao-diretores] Ajustes de indicadores indisponíveis, usando apenas o dado importado:', err?.message || String(err));
    ajustesIndicadores = [];
  }

  return { avaliacoes, registros, periodos, indicadores, ajustes, ajustesIndicadores };
}

export function avaliacaoLabel(a){
  return `${a.trimestre}º tri/${a.ano}`;
}

export function avgNumbers(values){
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((x, y) => x + y, 0) / nums.length : null;
}

// ---------------------------------------------------------------------------
// Contagem de nomes (diretores / unidades) — função ÚNICA usada por toda a UI
// ---------------------------------------------------------------------------
// Marcadores técnicos de ausência gerados pelo parser ("Diretor não informado")
// ou pela planilha. NUNCA contam como nome válido.
const NOMES_AUSENTES = new Set([
  'diretor não informado', 'unidade não informada', 'diretor nao informado',
  'unidade nao informada', 'não informado', 'nao informado', 'não informada',
  'nao informada', 'sem diretor', 's/ diretor', 's/ unidade', 'n/d', 'nd', '-', '—', '–'
]);

/** Remove espaços extras e normaliza para comparação. */
export function normName(v){
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/** Nome presente e válido: descarta nulo, vazio e marcadores técnicos. */
export function isPresentName(v){
  const k = normName(v);
  return Boolean(k) && !NOMES_AUSENTES.has(k.toLocaleLowerCase('pt-BR'));
}

/** Chave de comparação: sem espaços extras e sem diferença de maiúsculas. */
export function nameKey(v){
  return normName(v).toLocaleLowerCase('pt-BR');
}

/**
 * Contagem DEFINITIVA de nomes distintos e válidos dentro de uma seleção.
 * Regras: descarta nulos/vazios/marcadores técnicos; ignora espaços extras e
 * diferenças somente de maiúsculas/minúsculas; NUNCA usa nº de registros.
 */
export function countDistinctNames(records, field){
  const set = new Set();
  for(const r of records || []){
    const v = r?.[field];
    if(!isPresentName(v)) continue;
    set.add(nameKey(v));
  }
  return set.size;
}

/** Lista de nomes distintos e válidos, no original, ordenada. */
export function distinctNames(values){
  const map = new Map();
  for(const v of values || []){
    if(!isPresentName(v)) continue;
    const k = nameKey(v);
    if(!map.has(k)) map.set(k, normName(v));
  }
  return [...map.values()].sort((x, y) => x.localeCompare(y, 'pt-BR'));
}

const MESES3 = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

// ---------------------------------------------------------------------------
// Trimestres consolidados — reconhecimento dinâmico por cabeçalho
// ---------------------------------------------------------------------------

/**
 * Identifica se um rótulo de período é um TRIMESTRE consolidado.
 * Aceita variações reais: "2TRI/25", "1º TRI/26", "1 TRI 2026", "MAR/1TRI 2026",
 * "SET/3TRI", "SET/3TRI 2026", "DEZ/4TRI", "DEZ/4TRI 2026", "2TRI/2025".
 * Um cabeçalho só com nome de mês NÃO é trimestre.
 * Retorna { isQuarter, quarter, year, label, sortKey } (year pode ser null
 * quando o rótulo não traz o ano — será inferido por buildQuarterLabelMap).
 */
export function parseQuarterHeader(rotulo){
  if(!rotulo) return { isQuarter:false };
  const s = String(rotulo).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
  // "2TRI/25", "2TRI/2025", "1º TRI/26"
  let m = s.match(/^(\d)\s*[º°]?\s*TRI\s*\/\s*(\d{2,4})$/);
  if(m){
    const q = +m[1]; if(q < 1 || q > 4) return { isQuarter:false };
    let y = +m[2]; if(y < 100) y += 2000;
    return { isQuarter:true, quarter:q, year:y, label:`${q}º TRI/${y}`, sortKey:y*10+q };
  }
  // "MAR/1TRI 2026", "JUN/2TRI 2026", "SET/3TRI", "DEZ/4TRI 2026"
  m = s.match(/^[A-Z]{3,9}\s*\/\s*(\d)\s*TRI(?:\s*(\d{4}))?$/);
  if(m){
    const q = +m[1]; if(q < 1 || q > 4) return { isQuarter:false };
    const y = m[2] ? +m[2] : null;
    return { isQuarter:true, quarter:q, year:y, label:y ? `${q}º TRI/${y}` : null, sortKey:y ? y*10+q : null };
  }
  // "1 TRI 2026", "1º TRI 2026" (sem barra)
  m = s.match(/^(\d)\s*[º°]?\s*TRI\s+(\d{4})$/);
  if(m){
    const q = +m[1]; if(q < 1 || q > 4) return { isQuarter:false };
    const y = +m[2];
    return { isQuarter:true, quarter:q, year:y, label:`${q}º TRI/${y}`, sortKey:y*10+q };
  }
  return { isQuarter:false };
}

/**
 * Constrói o mapa de rótulos de TRIMESTRES para o gráfico de evolução.
 * Varre todos os períodos em ordem (avaliação, ordem), identifica trimestres,
 * infere ano ausente a partir do trimestre anterior (se q > qAnterior → mesmo
 * ano; senão → ano+1; fallback = menor ano das avaliações) e retorna:
 *   labelMap: Map `${avaliacaoId}|${rotulo}` → "Nº TRI/AAAA" (só trimestres)
 *   columns:  [{ label, year, quarter }] ordenados por (ano, trimestre)
 * Meses e outros rótulos são ignorados (permanecem no banco/matrizes).
 */
export function buildQuarterLabelMap(registros, avaliacoes){
  const labelMap = new Map();
  const candidatos = [];
  const menorAno = (avaliacoes || []).reduce((min, a) => {
    const y = Number(a?.ano);
    return Number.isFinite(y) && (min == null || y < min) ? y : min;
  }, null);
  for(const r of registros || []){
    for(const p of r.periodos || []){
      const q = parseQuarterHeader(p.rotulo);
      if(q.isQuarter) candidatos.push({ ...q, ordem: p.ordem ?? 0, avaliacaoId: r.avaliacaoId, rotulo: p.rotulo });
    }
  }
  candidatos.sort((a, b) => a.ordem - b.ordem);
  let prevAno = null, prevQ = null;
  for(const c of candidatos){
    let ano = c.year;
    if(ano == null){
      if(prevAno != null) ano = c.quarter > prevQ ? prevAno : prevAno + 1;
      else ano = menorAno ?? new Date().getFullYear();
    }
    prevAno = ano; prevQ = c.quarter;
    labelMap.set(`${c.avaliacaoId}|${c.rotulo}`, `${c.quarter}º TRI/${ano}`);
  }
  const unique = new Map();
  for(const v of labelMap.values()){
    const m = v.match(/^(\d)º TRI\/(\d{4})$/);
    if(m) unique.set(v, { label:v, year:+m[2], quarter:+m[1] });
  }
  const columns = [...unique.values()].sort((a, b) => a.year - b.year || a.quarter - b.quarter);
  return { labelMap, columns };
}

function anoDoRotulo(label){
  const s = String(label ?? '');
  const m4 = s.match(/\b(20\d{2})\b/);
  if(m4) return Number(m4[1]);
  const m2 = s.match(/\/(\d{2})\b/);
  if(m2) return 2000 + Number(m2[1]);
  return null;
}

/**
 * Abrevia os rótulos de períodos internos para o eixo X do gráfico
 * ("2TRI/25" → "2º TRI/25", "JULHO" → "JUL/25", "JAN DE 2026" → "JAN/26").
 * O ano ausente é inferido do rótulo vizinho; o nome completo permanece no
 * tooltip. Rótulos compostos ("JULHO · 2º tri/2026") preferem o mês.
 */
export function abbreviatePeriods(labels){
  const list = labels || [];
  const anos = list.map(anoDoRotulo);
  let ultimo = null;
  for(let i = 0; i < anos.length; i++){
    if(anos[i] != null) ultimo = anos[i];
    else if(ultimo != null) anos[i] = ultimo;
  }
  ultimo = null;
  for(let i = anos.length - 1; i >= 0; i--){
    if(anos[i] != null) ultimo = anos[i];
    else if(ultimo != null) anos[i] = ultimo;
  }
  return list.map((lab, i) => {
    const yy = anos[i] != null ? String(anos[i]).slice(2) : '';
    const s = normName(lab);
    const up = s.toUpperCase();
    const composto = s.includes('·');
    const tri = s.match(/(\d)\s*[º°]?\s*TRI/i);
    if(tri && !composto) return `${tri[1]}º TRI/${yy}`;
    const mes = MESES3.find(m => up.startsWith(m));
    if(mes) return `${mes}/${yy}`;
    if(tri) return `${tri[1]}º TRI/${yy}`;
    return s;
  });
}

// ---------------------------------------------------------------------------
// Evolução MENSAL do diretor — linha do tempo pelos cabeçalhos REAIS
// ---------------------------------------------------------------------------
// A planilha traz cabeçalhos de três formas: nome de mês ("JULHO"), data
// ("JAN DE 2026" / "01/01/2026") e fechamento de trimestre ("2TRI/25",
// "SET/3TRI", "MAR/1TRI 2026"). Todos viram um MÊS/ANO único (JUN/2025 …
// SET/2026); nunca se lê ano de notas, percentuais ou valores de células e
// nenhum período é criado fora dos cabeçalhos existentes.

const MES_DE_NOME = {
  JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6,
  JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12,
  JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6,
  JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12
};
// Mês de fechamento de cada trimestre quando o cabeçalho não traz nome de mês
// ("2TRI/25" → JUN). Com nome de mês ("SET/3TRI") vale o mês do cabeçalho.
const MES_DO_TRIMESTRE = { 1: 3, 2: 6, 3: 9, 4: 12 };

function normalizaRotulo(v){
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}
function eNaoInformado(v){
  return normalizaRotulo(v) === 'NAO INFORMADO';
}
/** Status do período lido: vazio/"Não informado" → null (nunca conta como dado). */
function statusPeriodo(v){
  const s = normName(v);
  return s && !eNaoInformado(s) ? s : null;
}
/** Janela de anos plausível a partir das avaliações (corta anos inventados). */
export function janelaDeAnos(avaliacoes){
  const anos = (avaliacoes || []).map(a => Number(a?.ano)).filter(y => Number.isFinite(y));
  if(!anos.length) return { janela: [2000, new Date().getFullYear() + 2], base: null };
  const min = Math.min(...anos), max = Math.max(...anos);
  return { janela: [min - 2, max + 2], base: min };
}

/**
 * Interpreta um CABEÇALHO de período como MÊS da linha do tempo.
 * Aceita: nome de mês ("JULHO", "JAN DE 2026"), data ("01/01/2026",
 * "01/2026") e fechamento trimestral ("2TRI/25", "SET/3TRI", "MAR/1TRI 2026").
 * `year` só é preenchido quando o ano do cabeçalho é plausível dentro da
 * janela; caso contrário vem null e o ano é inferido cronologicamente —
 * assim um "…/85" nunca vira rótulo na tela.
 * Retorna { isMonth:false } quando o cabeçalho não é um período de mês.
 */
export function parseMonthHeader(rotulo, janela){
  const s = normalizaRotulo(rotulo);
  if(!s) return { isMonth:false };
  const [minAno, maxAno] = janela || [2000, new Date().getFullYear() + 2];
  const anoValido = y => Number.isFinite(y) && y >= minAno && y <= maxAno;
  const anoLongo = s.match(/\b(\d{4})\b/);
  const anoCurto = s.match(/\/\s*(\d{2})\b/);
  const anoDe2 = () => {
    if(!anoCurto) return null;
    const y = 2000 + Number(anoCurto[1]);
    return anoValido(y) ? y : null;
  };
  // Fechamento trimestral: "2TRI/25", "SET/3TRI", "MAR/1TRI 2026", "1º TRI/26"
  const tri = s.match(/(\d)\s*[º°]?\s*TRI/);
  if(tri){
    const quarter = Number(tri[1]);
    if(quarter < 1 || quarter > 4) return { isMonth:false };
    const prefixo = s.match(/^([A-Z]{3,9})\s*\//);
    const month = (prefixo && MES_DE_NOME[prefixo[1]]) || MES_DO_TRIMESTRE[quarter];
    const year = (anoLongo && anoValido(Number(anoLongo[1]))) ? Number(anoLongo[1]) : anoDe2();
    return { isMonth:true, month, year, isQuarter:true, quarter };
  }
  // Data: "01/01/2026" (dia/mês/ano)
  let m = s.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  if(m){
    const month = Number(m[2]), year = Number(m[3]);
    if(month < 1 || month > 12) return { isMonth:false };
    return { isMonth:true, month, year:anoValido(year) ? year : null, isQuarter:false };
  }
  // Data curta: "01/2026" (mês/ano)
  m = s.match(/^(\d{1,2})\s*\/\s*(\d{4})$/);
  if(m){
    const month = Number(m[1]), year = Number(m[2]);
    if(month < 1 || month > 12) return { isMonth:false };
    return { isMonth:true, month, year:anoValido(year) ? year : null, isQuarter:false };
  }
  // Nome do mês: "JULHO", "JAN DE 2026", "MAI/2026"
  const token = s.match(/^([A-Z]{3,9})/);
  if(token && MES_DE_NOME[token[1]]){
    let year = null;
    if(anoLongo && anoValido(Number(anoLongo[1]))) year = Number(anoLongo[1]);
    else year = anoDe2();
    return { isMonth:true, month:MES_DE_NOME[token[1]], year, isQuarter:false };
  }
  return { isMonth:false };
}

/**
 * Mapa de TODOS os períodos da seleção para o mês/ano da linha do tempo.
 *   labelMap: Map `${avaliacaoId}|${rotulo}` → { label, month, year,
 *              isQuarter, quarter, quarterLabel }
 *   columns:  [{ label, month, year, isQuarter, quarter, quarterLabel }]
 *             ordenadas cronologicamente (ano, mês) e deduplicadas por rótulo.
 * Ano ausente é inferido na ordem cronológica (ano do cabeçalho anterior);
 * cabeçalho sem ano confiável fica de fora (nada é inventado).
 */
export function buildMonthlyLabelMap(registros, avaliacoes){
  const { janela, base } = janelaDeAnos(avaliacoes);
  const ordemAval = new Map((avaliacoes || []).map((a, i) => [a.id, i]));
  const candidatos = [];
  for(const r of registros || []){
    const ai = ordemAval.has(r.avaliacaoId) ? ordemAval.get(r.avaliacaoId) : Number.MAX_SAFE_INTEGER;
    for(const p of r.periodos || []){
      const h = parseMonthHeader(p.rotulo, janela);
      if(!h.isMonth || !h.month) continue;
      candidatos.push({ ...h, rotulo:p.rotulo, ordem:Number(p.ordem) || 0, ai, avaliacaoId:r.avaliacaoId });
    }
  }
  candidatos.sort((a, b) => (a.ai - b.ai) || (a.ordem - b.ordem) || String(a.rotulo).localeCompare(String(b.rotulo)));
  const labelMap = new Map();
  let anoCorrente = null;
  for(const c of candidatos){
    let ano = c.year;
    if(ano == null) ano = anoCorrente != null ? anoCorrente : base;
    if(ano == null) continue;
    anoCorrente = ano;
    labelMap.set(`${c.avaliacaoId}|${c.rotulo}`, {
      label: `${MESES3[c.month - 1]}/${ano}`,
      month: c.month,
      year: ano,
      isQuarter: !!c.isQuarter,
      quarter: c.isQuarter ? c.quarter : null,
      quarterLabel: c.isQuarter ? `${c.quarter}º trimestre de ${ano}` : null
    });
  }
  const unicas = new Map();
  for(const info of labelMap.values()) if(!unicas.has(info.label)) unicas.set(info.label, info);
  const columns = [...unicas.values()].sort((a, b) => (a.year - b.year) || (a.month - b.month));
  return { labelMap, columns };
}

/**
 * Evolução MENSAL de UM diretor (registros já filtrados do diretor):
 *  1. ordena os períodos cronologicamente;
 *  2. localiza o primeiro mês com status OU nível válido;
 *  3. oculta todos os meses anteriores e inicia o gráfico ali;
 *  4. segue até o último período real da avaliação.
 * Lacuna posterior mantém o mês no eixo com `null` (sem ponto, sem zero e sem
 * repetir o valor anterior — o gráfico interrompe a linha).
 * Retorna { periods, series } ou null quando o diretor não tem nenhum período
 * válido (nesse caso o card nem aparece na tela).
 */
export function buildDirectorMonthlyEvolution(registros, avaliacoes, nomeDiretor){
  const { labelMap, columns } = buildMonthlyLabelMap(registros, avaliacoes);
  if(!columns.length) return null;
  // Ordem cronológica das avaliações: usada para escolher o registro dono do
  // ponto exibido quando o mesmo mês aparece em mais de uma avaliação.
  const ordemAvaliacao = new Map((avaliacoes || []).map((a, i) => [a.id, i]));
  const porRegistro = (registros || []).map(r => {
    const m = new Map();
    for(const p of r.periodos || []){
      const info = labelMap.get(`${r.avaliacaoId}|${p.rotulo}`);
      if(info && !m.has(info.label)) m.set(info.label, { p, r });
    }
    return m;
  });
  const dados = columns.map(col => {
    // ORIGEM E PRIORIDADE do ponto exibido (vigência): ajuste manual (2) >
    // cadastro manual (1) > valor importado (0); empate cai para a avaliação
    // mais recente. Uma planilha futura, portanto, não sobrescreve valores
    // manuais — nem no gráfico, nem no resumo, nem no período editável.
    const prioridadeDe = x => (x.p?.ajustado ? 2 : 0) + (x.p?.origem === 'cadastro_manual' ? 1 : 0);
    const donos = porRegistro.map(m => m.get(col.label)).filter(Boolean).sort((a, b) =>
      (prioridadeDe(b) - prioridadeDe(a)) ||
      ((ordemAvaliacao.get(b.r?.avaliacaoId) ?? -1) - (ordemAvaliacao.get(a.r?.avaliacaoId) ?? -1)));
    // Só os donos de MAIOR prioridade alimentam o ponto: um valor manual
    // (ajuste ou cadastro) nunca é diluído nem substituído pelo importado.
    const pesos = donos.map(prioridadeDe);
    const maximo = pesos.length ? Math.max(...pesos) : 0;
    const ps = donos.filter((x, i) => pesos[i] === maximo).map(x => x.p);
    const niveis = ps.map(p => romanLevel(p.nivel)).filter(v => v != null);
    const valor = avgNumbers(niveis);
    const nivelRoman = valor != null && Number.isInteger(valor) ? valor : (niveis[0] ?? null);
    const status = ps.map(p => statusPeriodo(p.estagio)).find(Boolean)
      ?? ps.map(p => normName(p.estagio)).find(Boolean) ?? null;
    const rotulo = ps.map(p => normName(p.rotulo)).find(Boolean) ?? null;
    const valido = ps.some(p => statusPeriodo(p.estagio) != null || romanLevel(p.nivel) != null);
    // Registro/período donos do ponto exibido (prioridade de vigência, depois
    // avaliação mais recente) — permitem editar e auditar o valor vigente
    // daquele mês.
    const dono = donos[0] || null;
    return {
      col, valor, nivelRoman, status, rotulo, valido,
      periodoId: dono?.p?.id ?? null,
      registroId: dono?.r?.id ?? null,
      avaliacaoId: dono?.r?.avaliacaoId ?? null,
      statusOriginal: dono?.p?.estagioOriginal ?? null,
      nivelOriginal: dono?.p?.nivelOriginal ?? null,
      ajustado: !!dono?.p?.ajustado
    };
  });
  const inicio = dados.findIndex(d => d.valido);
  if(inicio < 0) return null;
  const trecho = dados.slice(inicio);
  return {
    periods: trecho.map(d => ({
      label: d.col.label,
      // Rótulo ORIGINAL do período na planilha (ex.: "AGO DE 2026"), usado no
      // resumo do último período válido exibido no canto do gráfico.
      rotulo: d.rotulo,
      isQuarter: d.col.isQuarter,
      quarterLabel: d.col.quarterLabel,
      status: d.status,
      nivelRoman: d.nivelRoman,
      // Identificadores reais + valor original importado: sustentam a edição
      // do último período válido e o tooltip com o dado da planilha.
      periodoId: d.periodoId,
      registroId: d.registroId,
      avaliacaoId: d.avaliacaoId,
      statusOriginal: d.statusOriginal,
      nivelOriginal: d.nivelOriginal,
      ajustado: d.ajustado
    })),
    series: [{
      key: 'diretor',
      rotulo: nomeDiretor || '',
      classe: 'sel',
      valores: trecho.map(d => d.valor)
    }]
  };
}

/**
 * Conversão ÚNICA entre os dois nomes históricos de propriedade de indicador:
 * o modelo do dashboard (Supabase → buildDashboardModel) usa `metricas`;
 * o parser da planilha (dataParser) usa `metrics`. Todo leitor de tela deve
 * passar por aqui — nunca ler `record.metrics`/`record.metricas` direto.
 * Ausência do indicador retorna `null` (NUNCA 0): zero é um valor real.
 */
export function recordMetric(record, nome){
  if(!record || !nome) return null;
  for(const bag of [record.metricas, record.metrics]){
    if(bag && typeof bag === 'object' && Object.prototype.hasOwnProperty.call(bag, nome)){
      const v = bag[nome];
      if(v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

export const RADAR_INDICATORS = ['Presencial','Acadêmico','Pós-graduação','Nota geral','Avaliação institucional','Ritmo de captação','Crescimento de matrículas','Evasão','EBITDA'];

/**
 * Séries do RadarChart a partir dos registros do modelo. Só eixos com pelo
 * menos um valor numérico entram no radar; sem nenhum indicador disponível,
 * `disponivel` vem `false` e a interface mostra "Indicadores não disponíveis".
 */
export function buildRadarSeries(records, allRecords, names = RADAR_INDICATORS){
  const medias = regs => names.map(nome => avgNumbers((regs || []).map(r => recordMetric(r, nome))));
  const sel = medias(records);
  const all = medias(allRecords);
  const eixos = names
    .map((nome, i) => ({ nome, sel: sel[i], all: all[i] }))
    .filter(e => e.sel != null || e.all != null);
  return {
    disponivel: eixos.length > 0,
    nomes: eixos.map(e => e.nome),
    sel: eixos.map(e => e.sel),
    all: eixos.map(e => e.all)
  };
}

/** Agrega um conjunto de registros: diretores, unidades, nível médio e médias de indicadores. */
export function aggregateRegistros(registros){
  const metricas = {};
  for(const r of registros){
    for(const [nome, valor] of Object.entries(r.metricas || {})){
      (metricas[nome] ||= []).push(valor);
    }
  }
  return {
    diretores: countDistinctNames(registros, 'diretor'),
    unidades: countDistinctNames(registros, 'unidade'),
    nivelMedio: avgNumbers(registros.map(r => r.nivelRoman)),
    metricas: Object.fromEntries(Object.entries(metricas).map(([nome, vals]) => [nome, avgNumbers(vals)]))
  };
}

export function regionalsOf(registros){
  return distinctNames((registros || []).map(r => r.regional));
}

export function directorsOf(registros, regional){
  const base = regional ? registros.filter(r => r.regional === regional) : registros;
  return distinctNames(base.map(r => r.diretor));
}

/**
 * Rótulos de períodos internos para gráfico de evolução do diretor:
 * quando o mesmo rótulo aparece em mais de uma avaliação, compõe com o
 * rótulo da avaliação ("JULHO · 2º tri/2026") para não fundir histórias.
 * Retorna Map com chave `${avaliacaoId}|${rotulo}`.
 */
export function buildPeriodLabelMap(registros, avaliacoes){
  const labelPorId = new Map(avaliacoes.map(a => [a.id, avaliacaoLabel(a)]));
  const contagem = new Map();
  for(const r of registros){
    for(const p of r.periodos || []){
      contagem.set(p.rotulo, (contagem.get(p.rotulo) || 0) + 1);
    }
  }
  const avaliacoesPorRotulo = new Map();
  for(const r of registros){
    for(const p of r.periodos || []){
      (avaliacoesPorRotulo.get(p.rotulo) || avaliacoesPorRotulo.set(p.rotulo, new Set()).get(p.rotulo)).add(r.avaliacaoId);
    }
  }
  const map = new Map();
  for(const r of registros){
    for(const p of r.periodos || []){
      const chave = `${r.avaliacaoId}|${p.rotulo}`;
      if(map.has(chave)) continue;
      const duplicadoEntreAvaliacoes = (avaliacoesPorRotulo.get(p.rotulo)?.size || 0) > 1;
      map.set(chave, duplicadoEntreAvaliacoes
        ? `${p.rotulo} · ${labelPorId.get(r.avaliacaoId) || r.avaliacaoId}`
        : p.rotulo);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// AJUSTES MANUAIS DE PONTUAÇÕES/INDICADORES — regra centralizada de vigência
// ---------------------------------------------------------------------------
// Regra, POR REGISTRO e POR CHAVE (nunca duplicada em componentes):
//   1) ajuste manual ATIVO do PRÓPRIO registro vence;
//   2) senão, o ajuste manual ATIVO mais recente do MESMO diretor cuja
//      avaliação seja ANTERIOR à deste registro (propagação para planilhas
//      futuras: a planilha futura nunca sobrescreve o valor manual, e o
//      histórico anterior nunca é reescrito por um ajuste feito depois);
//   3) sem ajuste -> valor importado.
// Percentuais vêm como FRAÇÃO (0.1 = 10%) — mesma unidade gravada no EAV e
// exibida por formatMetricCell.

function contextoDeAjustesIndicadores(registros, avaliacoes, ajustes){
  // Aceita tanto as linhas cruas (avaliacao_id) quanto os registros do modelo
  // (avaliacaoId): o contexto é normalizado para o formato do modelo.
  const registrosById = new Map();
  for(const r of registros || []){
    if(!r || !r.id) continue;
    registrosById.set(r.id, {
      id: r.id,
      diretor: r.diretor,
      avaliacaoId: r.avaliacaoId ?? r.avaliacao_id ?? null
    });
  }
  const ordemAval = new Map((avaliacoes || []).map((a, i) => [a.id, i]));
  const porChave = new Map();
  for(const a of ajustes || []){
    if(!a || a.arquivada_em || !a.chave) continue;
    (porChave.get(a.chave) || porChave.set(a.chave, []).get(a.chave)).push(a);
  }
  return { registrosById, ordemAval, porChave };
}

function melhorAjusteIndicador(chave, record, ctx){
  const candidatos = ctx.porChave.get(chave);
  if(!candidatos || !candidatos.length) return null;
  const diretorKey = nameKey(record.diretor);
  const ordem = ctx.ordemAval.get(record.avaliacaoId) ?? -1;
  let melhor = null;
  let melhorRank = null;
  for(const a of candidatos){
    const dono = ctx.registrosById.get(a.registro_id);
    if(!dono) continue;
    const proprio = dono.id === record.id;
    if(!proprio && nameKey(dono.diretor) !== diretorKey) continue;
    const ordemAjuste = ctx.ordemAval.get(dono.avaliacaoId) ?? -1;
    if(!proprio && ordemAjuste >= ordem) continue;
    const rank = [proprio ? 1 : 0, ordemAjuste, String(a.created_at || '')];
    if(!melhorRank
      || rank[0] > melhorRank[0]
      || (rank[0] === melhorRank[0] && rank[1] > melhorRank[1])
      || (rank[0] === melhorRank[0] && rank[1] === melhorRank[1] && rank[2] > melhorRank[2])){
      melhor = a;
      melhorRank = rank;
    }
  }
  return melhor;
}

/**
 * Métricas VIGENTES de um registro: base importada (EAV → nome amigável)
 * sobreposta pelos ajustes manuais ativos. Devolve também `metricasImportado`
 * (base auditável, nunca alterada) e `metricasInfo` (origem/data por chave),
 * que alimentam o painel "Atualizar dados".
 */
function metricasDoRegistro(record, ctx){
  const importado = {};
  for(const ind of record.indicadores || []){
    const nome = friendlyMetricName(ind.nome);
    if(nome && importado[nome] === undefined) importado[nome] = ind.valorNumerico ?? null;
  }
  const metricas = { ...importado };
  const metricasInfo = {};
  const chaves = new Set([...Object.keys(importado), ...ctx.porChave.keys()]);
  for(const chave of chaves){
    const ajuste = melhorAjusteIndicador(chave, record, ctx);
    if(ajuste){
      metricas[chave] = ajuste.valor_manual == null ? null : Number(ajuste.valor_manual);
      metricasInfo[chave] = {
        origem: ajuste.origem === 'cadastro_manual' ? 'cadastro_manual' : 'edicao_manual',
        ajustado: true,
        atualizadoEm: ajuste.updated_at || ajuste.created_at || null
      };
    } else {
      metricasInfo[chave] = { origem: 'planilha', ajustado: false, atualizadoEm: null };
    }
  }
  return { metricas, metricasImportado: importado, metricasInfo };
}

/**
 * Reaplica (em memória) ajustes de pontuação JÁ CONFIRMADOS pelo banco sobre
 * o modelo montado: cards, radar e matriz atualizam na hora, sem F5. A base
 * importada (`metricasImportado`) permanece intacta; somente a cópia vigente
 * é recalculada pela mesma regra usada em buildDashboardModel.
 */
export function aplicarAjusteIndicadorNoModelo(model, ajustes){
  if(!model || !ajustes || !ajustes.length) return model;
  const mapa = new Map((model.ajustesIndicadores || []).map(a => [a.id, a]));
  for(const a of ajustes){
    if(!a || !a.id) continue;
    if(a.arquivada_em) mapa.delete(a.id);
    else mapa.set(a.id, a);
  }
  const ajustesIndicadores = [...mapa.values()];
  const ctx = contextoDeAjustesIndicadores(model.registros, model.avaliacoes, ajustesIndicadores);
  const registros = (model.registros || []).map(r => {
    const { metricas, metricasImportado, metricasInfo } = metricasDoRegistro(r, ctx);
    return { ...r, metricas, metricasImportado, metricasInfo };
  });
  return { ...model, registros, ajustesIndicadores };
}

/**
 * Transforma o resultado cru do Supabase no modelo usado pelos dashboards.
 * Cada registro é uma ENTIDADE (Diretor+Unidade) reutilizada entre
 * importações: `avaliacaoId` é a atribuição da criação e os períodos novos da
 * planilha entram no mesmo registro. Registros com `arquivado_em` saem do
 * conjunto ativo e vão para `registrosArquivados` (prévia/reativação) — nada
 * é apagado. Os períodos carregam o valor VIGENTE (ajuste manual por cima do
 * importado) e os indicadores expõem `id` para atualização incremental.
 */
export function buildDashboardModel(raw){
  const avaliacoesOrdenadas = [...(raw.avaliacoes || [])].sort((a, b) =>
    (a.ano - b.ano) || (a.trimestre - b.trimestre) || String(a.importado_em).localeCompare(String(b.importado_em)));

  // REGRA CENTRALIZADA DO VALOR VIGENTE: se existir ajuste manual ativo para
  // o período, Status/Nível vigentes são os ajustados; caso contrário, os
  // importados. O original importado fica preservado em estagioOriginal/
  // nivelOriginal (auditoria) e NUNCA é gravado de volta no banco.
  const ajustesPorPeriodo = new Map();
  for(const a of raw.ajustes || []){
    if(a?.periodo_id && !a.arquivada_em) ajustesPorPeriodo.set(a.periodo_id, a);
  }

  const periodosPorRegistro = new Map();
  for(const p of raw.periodos || []){
    const vig = valorVigente(p, ajustesPorPeriodo.get(p.id));
    (periodosPorRegistro.get(p.registro_id) || periodosPorRegistro.set(p.registro_id, []).get(p.registro_id)).push({
      id: p.id,
      rotulo: p.rotulo_periodo,
      ordem: p.ordem,
      estagio: vig.status,
      // Ajuste ativo com decisão manual "Não informado": vigente fica
      // "Não informado" (texto) / roman null — NUNCA volta ao p.nivel
      // importado; o original permanece em estagioOriginal/nivelOriginal.
      nivel: vig.ajustado ? (vig.nivel != null ? nivelExibicao(vig.nivel) : 'Não informado') : p.nivel,
      nivelRoman: vig.nivel,
      estagioOriginal: vig.statusOriginal,
      nivelOriginal: vig.nivelOriginal,
      ajustado: vig.ajustado,
      origem: p.origem === 'cadastro_manual' ? 'cadastro_manual' : 'planilha'
    });
  }
  const indicadoresPorRegistro = new Map();
  for(const i of raw.indicadores || []){
    (indicadoresPorRegistro.get(i.registro_id) || indicadoresPorRegistro.set(i.registro_id, []).get(i.registro_id)).push({
      id: i.id,
      nome: i.nome_indicador,
      valorNumerico: i.valor_numerico == null ? null : Number(i.valor_numerico),
      valorTexto: i.valor_texto,
      unidadeMedida: i.unidade_medida,
      ordem: i.ordem
    });
  }

  const labelPorId = new Map(avaliacoesOrdenadas.map(a => [a.id, avaliacaoLabel(a)]));

  // Ajustes manuais de pontuações/indicadores: mesma regra centralizada
  // aplicada a todos os registros na montagem do modelo.
  const ajustesIndicadores = (raw.ajustesIndicadores || []).filter(a => a && !a.arquivada_em);
  const ctxIndicadores = contextoDeAjustesIndicadores(raw.registros, avaliacoesOrdenadas, ajustesIndicadores);

  const registrosTodos = (raw.registros || []).map(r => {
    const indicadores = (indicadoresPorRegistro.get(r.id) || []).slice()
      .sort((x, y) => (x.ordem ?? 0) - (y.ordem ?? 0));
    const { metricas, metricasImportado, metricasInfo } = metricasDoRegistro(
      { id: r.id, avaliacaoId: r.avaliacao_id, diretor: r.diretor, indicadores },
      ctxIndicadores
    );
    return {
      id: r.id,
      avaliacaoId: r.avaliacao_id,
      avaliacaoLabel: labelPorId.get(r.avaliacao_id) || r.avaliacao_id,
      codigoRegional: r.codigo_regional,
      regional: r.regional,
      diretor: r.diretor,
      unidade: r.unidade,
      statusGestao: r.status_gestao,
      cicloVida: r.ciclo_vida,
      nivelAtual: r.nivel_atual,
      nivelRoman: romanLevel(r.nivel_atual),
      arquivado: !!r.arquivado_em,
      metricas,
      metricasImportado,
      metricasInfo,
      indicadores,
      periodos: (periodosPorRegistro.get(r.id) || []).slice().sort((x, y) => (x.ordem ?? 0) - (y.ordem ?? 0))
    };
  });

  // Ativos alimentam os dashboards; arquivados ficam à parte para a prévia de
  // importação detectar reativação (mesma entidade, não um registro novo).
  const registros = registrosTodos.filter(r => !r.arquivado);
  const registrosArquivados = registrosTodos.filter(r => r.arquivado);

  const registrosPorAvaliacao = new Map(avaliacoesOrdenadas.map(a => [a.id, []]));
  for(const r of registros){
    if(registrosPorAvaliacao.has(r.avaliacaoId)) registrosPorAvaliacao.get(r.avaliacaoId).push(r);
  }

  const avaliacoes = avaliacoesOrdenadas.map(a => {
    const regs = registrosPorAvaliacao.get(a.id) || [];
    return {
      id: a.id,
      titulo: a.titulo,
      ano: a.ano,
      trimestre: a.trimestre,
      label: avaliacaoLabel(a),
      arquivoNome: a.arquivo_nome_original,
      storagePath: a.storage_path,
      totalRegistros: a.total_registros,
      publicadoEm: a.publicado_em,
      importadoEm: a.importado_em,
      registros: regs,
      agregados: aggregateRegistros(regs)
    };
  });

  return { avaliacoes, registros, registrosArquivados, ajustesIndicadores };
}

// ---------------------------------------------------------------------------
// Matriz histórica de desempenho — helpers puros (sem UI, sem rede)
// ---------------------------------------------------------------------------

// Cabeçalhos curtos do bloco final da matriz → chave do indicador amigável
// (recordMetric). A ordem é a ordem exibida na planilha original.
export const MATRIX_INDICATORS = [
  { label: 'Presencial', key: 'Presencial' },
  { label: 'Acadêmico', key: 'Acadêmico' },
  { label: 'Pós-graduação', key: 'Pós-graduação' },
  { label: 'Nota geral', key: 'Nota geral' },
  { label: 'Captação', key: 'Ritmo de captação' },
  { label: 'Crescimento', key: 'Crescimento de matrículas' },
  { label: 'Evasão', key: 'Evasão' },
  { label: 'Avaliação institucional', key: 'Avaliação institucional' },
  { label: 'EBITDA', key: 'EBITDA' }
];

const PERCENT_KEYS = new Set(['Ritmo de captação', 'Crescimento de matrículas', 'Evasão', 'EBITDA']);

/** Valor de indicador formatado para célula da matriz: null → "—" (nunca 0). */
export function formatMetricCell(v, key){
  if(v == null || !Number.isFinite(v)) return '—';
  if(PERCENT_KEYS.has(key)) return `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/**
 * Colunas de histórico da matriz, em ordem CRONOLÓGICA (ano, mês) — a mesma
 * ordem da planilha e a ordem gerada pelo cadastro manual de períodos. Cada
 * período vira DUAS colunas (Status/estágio + Nível) no componente. Rótulos
 * repetidos entre avaliações são compostos (buildPeriodLabelMap); a leitura do
 * mês/ano usa sempre o rótulo BRUTO da planilha. Colunas sem mês/ano
 * reconhecível mantêm a posição original.
 */
export function matrixPeriodColumns(registros, avaliacoes){
  const labelMap = buildPeriodLabelMap(registros || [], avaliacoes || []);
  const regs = registros || [];
  const cols = [];
  const rotuloBruto = new Map();
  const vistas = new Set();
  for(const a of avaliacoes || []){
    for(const r of regs.filter(x => x.avaliacaoId === a.id)){
      for(const p of r.periodos || []){
        const lab = labelMap.get(`${r.avaliacaoId}|${p.rotulo}`);
        if(lab && !vistas.has(lab)){
          vistas.add(lab);
          cols.push(lab);
          rotuloBruto.set(lab, p.rotulo);
        }
      }
    }
  }
  return ordenarColunasCronicamente(cols, rotuloBruto, avaliacoes || []);
}

function ordenarColunasCronicamente(cols, rotuloBruto, avaliacoes){
  const { janela } = janelaDeAnos(avaliacoes);
  let anoCorrente = null;
  const candidatos = cols.map(lab => {
    const h = parseMonthHeader(rotuloBruto.get(lab) ?? lab, janela);
    if(!h.isMonth || !h.month) return null;
    const ano = h.year ?? anoCorrente;
    if(ano == null) return null;
    anoCorrente = ano;
    return { lab, ano, mes: h.month };
  });
  const posicoes = [];
  const ordenaveis = [];
  candidatos.forEach((c, i) => {
    if(!c) return;
    posicoes.push(i);
    ordenaveis.push(c);
  });
  if(!posicoes.length) return cols;
  ordenaveis.sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes));
  const out = cols.slice();
  posicoes.forEach((pos, i) => { out[pos] = ordenaveis[i].lab; });
  return out;
}

/**
 * Filtra registros da matriz (AND entre os 8 filtros; vazio = "Todos").
 * `periodo` delimita a casca em que `statusTrimestral`/`nivel` valem: com
 * período escolhido, casam apenas com aquele período; com vazio, com
 * qualquer período do registro. Registro sem o período escolhido não casa.
 * NUNCA confunde periodo.estagio/nivel com statusGestao/nivelAtual.
 */
export function filterMatrixRows(records, filters, periodLabelOf){
  const f = filters || {};
  const match = (v, alvo) => !alvo || normName(v) === normName(alvo);
  const labelOf = periodLabelOf || ((r, p) => p.rotulo);
  return (records || []).filter(r => {
    if(!match(r.regional, f.regional)) return false;
    if(!match(r.diretor, f.diretor)) return false;
    if(!match(r.unidade, f.unidade)) return false;
    if(!match(r.statusGestao, f.statusGestao)) return false;
    if(!match(r.cicloVida, f.cicloVida)) return false;
    if(!f.statusTrimestral && !f.nivel) return true;
    const candidatos = (r.periodos || []).filter(p => !f.periodo || labelOf(r, p) === f.periodo);
    return candidatos.some(p =>
      match(p.estagio, f.statusTrimestral) && match(p.nivel, f.nivel));
  });
}
