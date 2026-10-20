/* Exportação da “Matriz histórica de desempenho” (Excel e PDF), gerada INTEIRA
   no navegador, a partir de UM ÚNICO conjunto de linhas filtradas — exatamente
   o mesmo `rows` usado pela matriz na tela e pelo contador de registros. Aqui
   NENHUM filtro é reaplicado nem removido: o payload já chega pronto.

   - Excel: ExcelJS (xlsx), com cabeçalho destacado, congelamento, autofiltro,
     larguras legíveis e valores reais (notas/percentuais numéricos com formato).
   - PDF: jsPDF + jspdf-autotable, em paisagem, cabeçalho repetido, quebra entre
     páginas, numeração e divisão em partes quando há muitas colunas. */

import { formatMetricCell, recordMetric, MATRIX_INDICATORS } from './dashboardService.js';

const semAcento = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const pad = n => String(n).padStart(2, '0');
const AUSENCIA_EXCEL = 'Não informado';

function carimboArquivo(){ const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function dataHoraBR(){ const d = new Date(); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

/** Nome do arquivo: base fixa + identificação SEGURA do filtro principal. */
export function nomeArquivoMatriz(f, ext){
  const s = semAcento(f?.statusGestao || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${s ? `matriz-historica-${s}` : 'matriz-historica-diretores'}-${carimboArquivo()}.${ext}`;
}

/** Resumo dos filtros ativos (idêntico para Excel e PDF). */
export function resumoFiltros(f, showHistory){
  const itens = [
    ['Regional', f.regional || 'Todas'],
    ['Diretor', f.diretor || 'Todos'],
    ['Unidade', f.unidade || 'Todas'],
    ['Período', f.periodo || (showHistory ? 'Histórico completo' : 'Último período')],
    ['Status trimestral', f.statusTrimestral || 'Todos'],
    ['Nível', f.nivel || 'Todos'],
    ['Status de Gestão', f.statusGestao || 'Todos'],
    ['Ciclo de Vida', f.cicloVida || 'Todos']
  ];
  const algumAtivo = Object.values(f || {}).some(Boolean);
  return {
    algumAtivo,
    itens,
    texto: algumAtivo ? itens.map(([k, v]) => `${k}: ${v}`).join(' · ') : 'Todos os registros'
  };
}

/**
 * ÚNICA fonte de dados das exportações: recebe as mesmas `rows`, `shownCols`,
 * `cellsOfCache`, `extras` e `extraValue` da matriz desenhada na tela.
 * `ausencia` controla apenas o texto de célula vazia (Excel: “Não informado”;
 * PDF: o mesmo “—” exibido na tela).
 */
export function buildMatrixExportPayload({ rows, cellsOfCache, shownCols, extras, extraValue, f, showHistory, totalRegistros, ausencia }){
  const vazio = x => (x == null || String(x).trim() === '') ? ausencia : x;
  const colunas = [
    { grupo: 'Identificação', label: 'Regional', width: 16 },
    { grupo: 'Identificação', label: 'Diretor', width: 26 },
    { grupo: 'Identificação', label: 'Unidade', width: 30 }
  ];
  for(const lab of shownCols){
    colunas.push({ grupo: lab, label: 'Status', width: 22 });
    colunas.push({ grupo: lab, label: 'Nível', width: 10 });
  }
  colunas.push({ grupo: 'Situação atual', label: 'Status de gestão', width: 18 });
  colunas.push({ grupo: 'Situação atual', label: 'Ciclo de vida', width: 18 });
  colunas.push({ grupo: 'Situação atual', label: 'Nível da unidade', width: 16 });
  for(const m of MATRIX_INDICATORS) colunas.push({ grupo: 'Indicadores', label: m.label, width: Math.max(12, Math.min(30, m.label.length * 0.75)) });
  for(const name of extras) colunas.push({ grupo: 'Indicadores', label: name, width: Math.max(12, Math.min(30, String(name).length * 0.75)) });
  colunas.forEach((c, i) => { c.i = i; });

  const linhas = (rows || []).map(r => {
    const cells = cellsOfCache.get(r.id) || new Map();
    const row = [vazio(r.regional), vazio(r.diretor), vazio(r.unidade)];
    for(const lab of shownCols){
      const c = cells.get(lab);
      row.push(vazio(c?.estagio));
      row.push(vazio(c?.nivel));
    }
    row.push(vazio(r.statusGestao), vazio(r.cicloVida), vazio(r.nivelAtual));
    for(const m of MATRIX_INDICATORS){
      const t = formatMetricCell(recordMetric(r, m.key), m.key);
      row.push(t === '—' ? ausencia : t);
    }
    for(const name of extras){
      const t = extraValue(r, name);
      row.push(t == null || t === '—' ? ausencia : t);
    }
    return row;
  });

  return {
    titulo: 'Matriz histórica de desempenho',
    dataHora: dataHoraBR(),
    contagem: `${linhas.length} de ${totalRegistros} registros`,
    resumo: resumoFiltros(f, showHistory),
    colunas,
    linhas
  };
}

/* ------------------------------------------------------------------ Excel */

const ARGB = {
  titulo: 'FF0E2F3B', info: 'FF5B7C88', texto: 'FF153744',
  grupoBg: 'FFE2EEF1', grupoFg: 'FF126578',
  subBg: 'FFEEF4F6', subFg: 'FF3C5560',
  borda: 'FFD7E2E7', zebra: 'FFF6FAFB'
};
const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const borda = () => ({ top: { style: 'thin', color: { argb: ARGB.borda } }, left: { style: 'thin', color: { argb: ARGB.borda } }, bottom: { style: 'thin', color: { argb: ARGB.borda } }, right: { style: 'thin', color: { argb: ARGB.borda } } });

/** Texto pt-BR → número real (notas) ou fração (percentuais), sem fórmulas. */
function celulaExcel(v){
  const s = String(v ?? '').trim();
  const pct = /^(-?\d{1,3}(?:\.\d{3})*,\d+)%$/.exec(s) || /^(-?\d+,\d+)%$/.exec(s);
  if(pct){
    const frac = Number(pct[1].replace(/\./g, '').replace(',', '.')) / 100;
    if(Number.isFinite(frac)) return { value: frac, numFmt: '0.0%' };
  }
  const num = /^-?\d{1,3}(?:\.\d{3})*,\d{1,2}$/.exec(s) || /^-?\d+,\d{1,2}$/.exec(s);
  if(num){
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    if(Number.isFinite(n)) return { value: n, numFmt: s.includes(',') && /,\d{1,2}$/.test(s) ? (s.split(',')[1].length > 2 ? '#,##0.000' : '#,##0.00') : '#,##0' };
  }
  return { value: s, numFmt: null };
}

function baixarBlob(blob, nome){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function exportMatrixExcel(payload, nomeArquivo){
  const mod = await import('exceljs');
  const ExcelJS = mod.default || mod.ExcelJS || mod;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Matriz histórica');

  const cols = payload.colunas;
  const n = cols.length;
  const R = { titulo: 1, info: 2, filtros: 3, sep: 4, grupo: 5, sub: 6 };
  const firstData = R.sub + 1;
  const lastRow = firstData + payload.linhas.length - 1;

  ws.columns = cols.map(c => ({ width: Math.max(10, Math.min(38, c.width || 14)) }));

  ws.getCell(R.titulo, 1).value = payload.titulo;
  ws.getCell(R.titulo, 1).font = { name: 'Calibri', size: 16, bold: true, color: { argb: ARGB.titulo } };
  ws.getCell(R.titulo, 1).alignment = { vertical: 'middle' };
  ws.getRow(R.titulo).height = 26;
  if(n > 1) ws.mergeCells(R.titulo, 1, R.titulo, n);

  ws.getCell(R.info, 1).value = `Exportado em ${payload.dataHora} · ${payload.contagem}`;
  ws.getCell(R.info, 1).font = { name: 'Calibri', size: 10, italic: true, color: { argb: ARGB.info } };
  ws.getCell(R.info, 1).alignment = { vertical: 'middle' };
  ws.getRow(R.info).height = 18;
  if(n > 1) ws.mergeCells(R.info, 1, R.info, n);

  ws.getCell(R.filtros, 1).value = `Filtros aplicados: ${payload.resumo.texto}`;
  ws.getCell(R.filtros, 1).font = { name: 'Calibri', size: 10, bold: payload.resumo.algumAtivo, color: { argb: ARGB.texto } };
  ws.getCell(R.filtros, 1).alignment = { vertical: 'middle', wrapText: true };
  ws.getCell(R.filtros, 1).fill = fill('FFF7FAFB');
  ws.getRow(R.filtros).height = 30;
  if(n > 1) ws.mergeCells(R.filtros, 1, R.filtros, n);

  ws.getRow(R.sep).height = 8;

  // Cabeçalho em duas linhas: grupos (mesclados) + colunas.
  cols.forEach((c, i) => {
    ws.getCell(R.grupo, i + 1).value = c.grupo;
    ws.getCell(R.sub, i + 1).value = c.label;
    for(const r of [R.grupo, R.sub]){
      const cell = ws.getCell(r, i + 1);
      cell.border = borda();
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.font = r === R.grupo
        ? { name: 'Calibri', size: 10, bold: true, color: { argb: ARGB.grupoFg } }
        : { name: 'Calibri', size: 9, bold: true, color: { argb: ARGB.subFg } };
      cell.fill = fill(r === R.grupo ? ARGB.grupoBg : ARGB.subBg);
    }
  });
  ws.getRow(R.grupo).height = 20;
  ws.getRow(R.sub).height = 30;
  // Mescla somente no eixo horizontal (linhas do autofilter permanecem intactas).
  let i = 0;
  while(i < n){
    let j = i;
    while(j + 1 < n && cols[j + 1].grupo === cols[i].grupo) j++;
    if(j > i) ws.mergeCells(R.grupo, i + 1, R.grupo, j + 1);
    i = j + 1;
  }

  // Linhas filtradas — exatamente as exibidas na matriz.
  payload.linhas.forEach((vals, rIdx) => {
    const row = ws.getRow(firstData + rIdx);
    const zebra = rIdx % 2 === 1;
    vals.forEach((v, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      const c = celulaExcel(v);
      cell.value = c.value;
      if(c.numFmt) cell.numFmt = c.numFmt;
      cell.alignment = { vertical: 'middle' };
      cell.font = { name: 'Calibri', size: 10, color: { argb: ARGB.texto } };
      if(zebra) cell.fill = fill(ARGB.zebra);
      cell.border = { bottom: { style: 'hair', color: { argb: ARGB.borda } } };
    });
    row.height = 18;
  });

  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: R.sub, activeCell: `${ws.getColumn(1).letter}${firstData}` }];
  if(payload.linhas.length){
    ws.autoFilter = { from: { row: R.sub, column: 1 }, to: { row: lastRow, column: n } };
  }

  const buffer = await wb.xlsx.writeBuffer();
  baixarBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nomeArquivo);
}

/* -------------------------------------------------------------------- PDF */

const LARGURA_PAGINA = 297, MARGEM_LATERAL = 8, MARGEM_BASE = 14;
const LARGURA_UTIL = LARGURA_PAGINA - MARGEM_LATERAL * 2;

function larguraColuna(col, valores, fonte){
  // Cabeçalho em duas linhas: a linha de grupo e a de coluna ocupam a MESMA
  // largura, então a estimativa usa o maior dos dois rótulos.
  let max = Math.max(String(col.grupo || '').length, String(col.label || '').length);
  for(const v of valores) max = Math.max(max, String(v ?? '').length);
  return Math.min(62, Math.max(13, max * fonte * 0.19 + 4));
}

/** Divide as colunas em partes que cabem em paisagem, repetindo as 3 de identificação. */
function dividirPartes(colunas, valoresPorColuna, fonte){
  const ids = colunas.slice(0, 3);
  const resto = colunas.slice(3);
  const larguras = new Map(colunas.map(c => [c, larguraColuna(c, valoresPorColuna.get(c.i) || [], fonte)]));
  const soma = lista => lista.reduce((s, c) => s + larguras.get(c), 0);
  const partes = [];
  let atual = ids.slice();
  let w = soma(atual);
  for(const c of resto){
    const cw = larguras.get(c);
    if(w + cw > LARGURA_UTIL && atual.length > ids.length){
      partes.push(atual);
      atual = [...ids, c];
      w = soma(atual);
    }else{
      atual.push(c);
      w += cw;
    }
  }
  partes.push(atual);
  return { partes, larguras };
}

export async function exportMatrixPdf(payload, nomeArquivo){
  const mod = await import('jspdf');
  const autoTableMod = await import('jspdf-autotable');
  const autoTable = autoTableMod.default || autoTableMod.autoTable;
  const doc = new mod.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const FONTE = 7.6;
  const valoresPorColuna = new Map(payload.colunas.map(c => [c.i, payload.linhas.map(r => r[c.i])]));
  const { partes, larguras } = dividirPartes(payload.colunas, valoresPorColuna, FONTE);

  const linhasFiltro = doc.splitTextToSize(payload.resumo.texto, LARGURA_UTIL);
  const temPartes = partes.length > 1;
  const topoFiltros = 28.5;
  const alturaBlocos = topoFiltros + linhasFiltro.length * 3.6;
  const marginTop = Math.ceil(alturaBlocos + (temPartes ? 9 : 7));

  const desenharCabecalho = indice => {
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(14, 47, 59);
    doc.text(payload.titulo, MARGEM_LATERAL, 14);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(91, 124, 136);
    doc.text(`Exportado em ${payload.dataHora}  ·  ${payload.contagem}`, MARGEM_LATERAL, 19.5);
    doc.setFontSize(8.5).setTextColor(21, 55, 68);
    doc.text('Filtros aplicados:', MARGEM_LATERAL, 24.5);
    doc.setFontSize(8).setTextColor(60, 85, 96);
    doc.text(linhasFiltro, MARGEM_LATERAL, topoFiltros);
    if(temPartes){
      doc.setFontSize(8).setTextColor(18, 101, 120);
      doc.text(`Parte ${indice + 1} de ${partes.length} (colunas repetidas: Regional, Diretor e Unidade)`, MARGEM_LATERAL, alturaBlocos + 4.5);
    }
  };

  partes.forEach((parte, idx) => {
    if(idx > 0) doc.addPage();
    const indices = parte.map(c => c.i);
    const head = [
      parte.map((c, i) => (i > 0 && parte[i - 1].grupo === c.grupo) ? '' : c.grupo),
      parte.map(c => c.label)
    ];
    const body = payload.linhas.map(r => indices.map(i => r[i]));
    const somaLarguras = parte.reduce((s, c) => s + larguras.get(c), 0);
    autoTable(doc, {
      head,
      body,
      startY: marginTop,
      margin: { left: MARGEM_LATERAL, right: MARGEM_LATERAL, top: marginTop, bottom: MARGEM_BASE },
      theme: 'grid',
      // Largura total EXATA das colunas da parte: nunca maior que a página e
      // sem tentativa automática de esticar/encolher (colunas já calculadas).
      tableWidth: somaLarguras,
      styles: { font: 'helvetica', fontSize: FONTE, cellPadding: 1.4, lineColor: [219, 229, 233], lineWidth: 0.1, textColor: [21, 55, 68], overflow: 'linebreak', valign: 'middle' },
      headStyles: { fillColor: [14, 47, 59], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', lineWidth: 0.1 },
      alternateRowStyles: { fillColor: [246, 250, 251] },
      columnStyles: Object.fromEntries(parte.map((c, i) => [i, { cellWidth: larguras.get(c) }])),
      didParseCell: data => {
        if(data.section === 'head' && data.row.index === 0){
          data.cell.styles.fillColor = [226, 238, 241];
          data.cell.styles.textColor = [18, 101, 120];
          data.cell.styles.fontStyle = 'bold';
        }
        if(data.section === 'body' && data.column.index < 3){
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = data.row.index % 2 === 1 ? [246, 250, 251] : [255, 255, 255];
        }
      },
      willDrawPage: () => desenharCabecalho(idx)
    });
  });

  const total = doc.internal.getNumberOfPages();
  for(let p = 1; p <= total; p++){
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(114, 133, 141);
    doc.text(payload.titulo, MARGEM_LATERAL, 205);
    doc.text(`Página ${p} de ${total}`, LARGURA_PAGINA - MARGEM_LATERAL, 205, { align: 'right' });
  }

  doc.save(nomeArquivo);
}
