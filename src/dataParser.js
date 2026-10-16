import * as XLSX from 'xlsx';

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = v => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const isNumber = v => typeof v === 'number' && Number.isFinite(v);

// Matchers dos indicadores com nome amigável — compartilhados entre o parser da
// planilha (importação) e a camada de leitura do dashboard (Supabase → EAV).
export const METRIC_MATCHERS = [
  ['Presencial', h => norm(h) === 'PRESENCIAL'],
  ['Acadêmico', h => norm(h) === 'ACADEMICO'],
  ['Pós-graduação', h => norm(h).includes('POS-GRADUACAO')],
  ['Nota geral', h => norm(h) === 'GERAL'],
  ['Ritmo de captação', h => norm(h).includes('RITMO') && norm(h).includes('CAPTACAO')],
  ['Crescimento de matrículas', h => norm(h).includes('CRESC') && norm(h).includes('MAT')],
  ['Evasão', h => norm(h).includes('EVASAO')],
  ['Avaliação institucional', h => norm(h) === 'AV.I' || norm(h).includes('AVALIACAO INSTITUCIONAL')],
  ['EBITDA', h => norm(h).includes('EBITDA')]
];

export function friendlyMetricName(label){
  const found = METRIC_MATCHERS.find(([, test]) => test(label));
  return found ? found[0] : null;
}

// Converte "(III)" / "III" → 3; retorna null quando não é algarismo romano I–V.
// Correspondência EXATA: limpa parênteses/espaços e faz lookup no mapa — nunca
// reconhece "I" dentro de "II"/"III"/"IV" nem "V" dentro de "IV".
const ROMAN_MAP = { I:1, II:2, III:3, IV:4, V:5 };
export function romanLevel(v){
  if(v == null) return null;
  const clean = String(v).replace(/[()\s]/g, '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(ROMAN_MAP, clean) ? ROMAN_MAP[clean] : null;
}

function formatHeader(value, index){
  if (value instanceof Date) return value.toLocaleDateString('pt-BR',{month:'short',year:'numeric'}).replace('.','').toUpperCase();
  if (typeof value === 'number' && value > 25000 && value < 80000){
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return `${String(d.m).padStart(2,'0')}/${d.y}`;
  }
  return clean(value) || `Período ${index+1}`;
}

function locateHeaderRow(rows){
  return rows.findIndex(row => row.some(v => norm(v)==='DIRETOR') && row.some(v => norm(v)==='UNIDADE'));
}

// Pares período + NÍVEL detectados dinamicamente (a planilha cresce na horizontal).
function detectPeriods(headers, unitCol, periodEnd){
  const periods = [];
  for(let i=unitCol+1;i<periodEnd-1;i++){
    if(norm(headers[i+1])==='NIVEL' && norm(headers[i])!=='NIVEL'){
      periods.push({valueCol:i,levelCol:i+1,label:formatHeader(headers[i],periods.length)});
    }
  }
  return periods;
}

function detectIndicators(headers, consumed){
  const indicators = [];
  for(let i=0;i<headers.length;i++){
    if(consumed.has(i)) continue;
    const label = clean(headers[i]);
    if(!label || norm(headers[i])==='NIVEL') continue;
    indicators.push({ name: label, column: i, ordem: indicators.length });
  }
  return indicators;
}

/**
 * Análise completa da Planilha1: prévia + registros estruturados.
 * Não lança exceção por campo ausente: devolve `missingRequired` para a prévia.
 * Lança exceção apenas quando a aba/cabeçalho/registros são impossíveis de ler.
 */
export function analyzeRows(rows, sourceName='Planilha1'){
  if(!Array.isArray(rows) || rows.length < 3) throw new Error('A Planilha1 não possui linhas suficientes.');
  const headerIndex = locateHeaderRow(rows);
  if(headerIndex < 0) throw new Error('Não localizei a linha de cabeçalho com DIRETOR e UNIDADE.');
  const headers = rows[headerIndex];
  const col = label => headers.findIndex(v => norm(v) === label);

  const regionalCodeCol = col('REGIONALL');
  const regionalCol = col('REGIONAL');
  const directorCol = col('DIRETOR');
  const unitCol = col('UNIDADE');
  const statusCol = headers.findIndex(v => norm(v).includes('STATUS DE GESTAO'));
  const lifeCol = headers.findIndex(v => norm(v).includes('CICLO DE VIDA'));
  const metricStart = headers.findIndex(v => norm(v)==='PRESENCIAL');

  const fields = [
    { key:'regional',      label:'REGIONAL',           required:true,  found:regionalCol >= 0 },
    { key:'diretor',       label:'DIRETOR',            required:true,  found:directorCol >= 0 },
    { key:'unidade',       label:'UNIDADE',            required:true,  found:unitCol >= 0 },
    { key:'codigoRegional',label:'REGIONALL',          required:false, found:regionalCodeCol >= 0 },
    { key:'statusGestao',  label:'STATUS DE GESTÃO',   required:false, found:statusCol >= 0 },
    { key:'cicloVida',     label:'CICLO DE VIDA',      required:false, found:lifeCol >= 0 }
  ];
  const missingRequired = fields.filter(f => f.required && !f.found);
  const missingOptional = fields.filter(f => !f.required && !f.found);

  const periodEnd = statusCol > 0 ? statusCol : metricStart;
  const periods = (unitCol >= 0 && periodEnd > unitCol) ? detectPeriods(headers, unitCol, periodEnd) : [];
  const currentLevelCol = statusCol >= 0 ? headers.findIndex((v,i)=>i>lifeCol && norm(v)==='NIVEL') : -1;
  fields.push({ key:'nivelAtual', label:'NÍVEL (atual)', required:false, found:currentLevelCol >= 0 });

  const metricMap = METRIC_MATCHERS.map(([name,test])=>({name,index:headers.findIndex(test)}));

  // Indicadores dinâmicos (EAV): qualquer coluna não consumida depois da identificação.
  const consumed = new Set([regionalCodeCol, regionalCol, directorCol, unitCol, statusCol, lifeCol, currentLevelCol].filter(i => i >= 0));
  periods.forEach(p => { consumed.add(p.valueCol); consumed.add(p.levelCol); });
  const indicatorColumns = detectIndicators(headers, consumed);

  const dataRows = rows.slice(headerIndex + 1);
  const nonEmptyRows = dataRows.filter(row => row.some(v => clean(v) !== ''));
  const usableRows = (unitCol >= 0 && directorCol >= 0 && regionalCol >= 0 && missingRequired.length === 0)
    ? nonEmptyRows
    : [];

  const rowsWithoutDirector = nonEmptyRows.filter(row => !clean(row[directorCol])).length;

  const keyCounts = new Map();
  const invalidMetricCells = [];
  const records = usableRows.map((row,idx)=>{
    const director=clean(row[directorCol]) || 'Diretor não informado';
    const unit=clean(row[unitCol]) || 'Unidade não informada';
    const regional=clean(row[regionalCol]) || 'Sem regional';
    const key=`${regional}|${director}|${unit}`;
    keyCounts.set(key,(keyCounts.get(key)||0)+1);
    const history=periods.map(p=>({period:p.label,stage:clean(row[p.valueCol])||'Não informado',level:clean(row[p.levelCol])||'Não informado'}));
    const metrics={}; metricMap.forEach(m=>{
      const rawv=m.index>=0?row[m.index]:null;
      const presente=rawv!==null&&rawv!==undefined&&(typeof rawv==='string'?rawv.trim()!=='':true);
      if(presente&&!isNumber(rawv))invalidMetricCells.push({diretor:director,unidade:unit,indicador:m.name,valor:clean(rawv)});
      metrics[m.name]=m.index>=0 && isNumber(row[m.index]) ? row[m.index] : null;
    });
    const indicators=indicatorColumns.map(ic=>{
      const value=row[ic.column];
      const numeric=isNumber(value)?value:null;
      const text=numeric===null?(clean(value)||null):null;
      return { name:ic.name, ordem:ic.ordem, valor_numerico:numeric, valor_texto:text,
               unidade_medida: ic.name.includes('%') ? '%' : null };
    }).filter(x => x.valor_numerico !== null || x.valor_texto !== null);
    return {id:`${sourceName}-${idx}`,regionalCode:clean(row[regionalCodeCol]),regional,director,unit,history,currentStage:clean(row[statusCol])||'Não informado',lifeCycle:clean(row[lifeCol])||'Não informado',currentLevel:clean(row[currentLevelCol])||'Não informado',metrics,indicators};
  });

  const duplicates = [...keyCounts.entries()].filter(([,count])=>count>1)
    .map(([key,count])=>{const [regional,director,unit]=key.split('|');return {regional,director,unit,count};});

  const uniqSorted = arr => [...new Set(arr.filter(Boolean))].sort((x,y)=>x.localeCompare(y,'pt-BR'));

  return {
    ok: missingRequired.length === 0 && records.length > 0,
    sourceName,
    sheetName: 'Planilha1',
    headerRow: headerIndex + 1,
    totalRows: rows.length,
    dataRowCount: nonEmptyRows.length,
    columnCount: headers.length,
    fields,
    missingRequired,
    missingOptional,
    periods,
    periodLabels: periods.map(p=>p.label),
    indicatorColumns: indicatorColumns.map(({name,ordem})=>({name,ordem})),
    regionals: uniqSorted(records.map(r=>r.regional)),
    directors: uniqSorted(records.map(r=>r.director)),
    units: uniqSorted(records.map(r=>r.unit)),
    rowsWithoutDirector,
    duplicates,
    invalidMetricCells,
    records,
    importedAt: new Date().toISOString()
  };
}

export function analyzeWorkbookBuffer(buffer, fileName){
  let workbook;
  try{
    workbook = XLSX.read(buffer, { type:'array', cellDates:true });
  }catch{
    throw new Error('Não consegui ler o arquivo como planilha Excel (.xlsx/.xls).');
  }
  const target = workbook.SheetNames.find(n => norm(n) === 'PLANILHA1');
  if(!target) throw new Error('O arquivo precisa possuir uma aba chamada Planilha1.');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[target], { header:1, defval:null, raw:true });
  const analysis = analyzeRows(rows, fileName);
  analysis.sheetNames = workbook.SheetNames;
  return analysis;
}

export function analysisToDataset(analysis){
  return { records:analysis.records, periods:analysis.periodLabels, sourceName:analysis.sourceName, importedAt:analysis.importedAt };
}

export function parseRows(rows, sourceName='Planilha1'){
  const analysis = analyzeRows(rows, sourceName);
  if(!analysis.records.length) throw new Error('Nenhum registro válido foi encontrado na Planilha1.');
  return analysisToDataset(analysis);
}

export function parseWorkbookBuffer(buffer,fileName){
  return analysisToDataset(analyzeWorkbookBuffer(buffer,fileName));
}
