/* Exportação em PDF da “Evolução mensal do Status e do Nível”.

   A página do PDF é uma FOTOGRAFIA do componente real da tela
   (MonthlyEvolutionChart + card), capturada com html2canvas e montada em
   jsPDF (A4 paisagem, UMA página por diretor, rodapé discreto
   “Página X de Y” + data + “Desenvolvido por V3LOZ”). O modo GERAL usa
   captura equilibrada (JPEG, escala 1.6) para não travar os 60 diretores;
   individual e regional mantêm PNG em escala 3, como sempre.

   Nada é redesenhado, simplificado ou reutilizado de outro sistema: cores,
   linha, pontos, rótulos de Nível, indicadores de mudança, anéis
   trimestrais, meses/anos/trimestres e legenda vêm EXATAMENTE do gráfico
   exibido no Avaliação de Diretores. O escopo (individual / regional /
   geral) nasce dos MESMOS registros filtrados da tela (ÚNICA fonte). */

import type { jsPDF } from 'jspdf';
import type { Registro } from '../types/modelo';
import type { EvolucaoMensal } from './dashboardService.ts';
import { buildDirectorMonthlyEvolution, isPresentName, nameKey, normName } from './dashboardService.ts';

/** Tipo do documento jsPDF montado pelo lote (uma página por diretor). */
export type DocEvolucaoPdf = jsPDF;

export type EscopoEvolucaoPdf = 'individual' | 'regional' | 'geral';

/** Resumo do ÚLTIMO ponto válido — mesma regra do subcard da tela. */
export interface ResumoEvolucaoPdf {
  periodo: string;
  status: string;
  nivel: string;
  ajustado: boolean;
}

/** Um diretor = UMA página do PDF. */
export interface ItemEvolucaoPdf {
  diretor: string;
  regional: string;
  unidades: string[];
  registros: Registro[];
  evolution: EvolucaoMensal | null;
  resumo: ResumoEvolucaoPdf | null;
  /** Variáveis CSS do subcard (--ev-fundo…) resolvidas pela paleta da tela. */
  estilo?: Record<string, string> | null;
}

export interface ImagemCapturada {
  dataUrl: string;
  largura: number;
  altura: number;
  /** Formato do dataUrl (PNG = individual/regional; JPEG = modo geral). */
  formato?: 'PNG' | 'JPEG';
}

/** Parâmetros de captura de UMA página (escala + formato + qualidade). */
export interface OpcoesCapturaPdf {
  escala: number;
  formato: 'PNG' | 'JPEG';
  qualidade: number;
}

/**
 * Captura do PDF GERAL: equilibrada para 60 páginas — escala 1.6 (faixa
 * 1.4–1.7), JPEG qualidade 0.88 (faixa 0.85–0.90), fundo branco. Mantém o
 * gráfico nítido sem inflar a memória do jsPDF (o PNG em escala 3 de 60
 * páginas estourava a string base64 do documento).
 */
export const CAPTURA_GERAL: OpcoesCapturaPdf = { escala: 1.6, formato: 'JPEG', qualidade: 0.88 };

/** Individual e Regional continuam exatamente como já funcionavam (PNG, escala 3). */
export function opcaoCapturaPorEscopo(escopo: EscopoEvolucaoPdf): OpcoesCapturaPdf {
  return escopo === 'geral' ? CAPTURA_GERAL : { escala: 3, formato: 'PNG', qualidade: 1 };
}

const pad = (n: number): string => String(n).padStart(2, '0');
const limpar = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (v: unknown): string => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function slug(v: unknown): string {
  return semAcento(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Pausa curta que devolve o processador ao navegador (funciona em aba oculta). */
export function dormir(ms: number): Promise<void> {
  return new Promise<void>(resolve => { window.setTimeout(resolve, Math.max(0, ms)); });
}

/**
 * Promessa com tempo limite SEGURO: rejeita após `ms` e sempre anexa os
 * handlers na promessa original (nunca deixa Promise sem resolução nem
 * rejeição não tratada). O trabalho em andamento pode continuar em segundo
 * plano, mas o lote NUNCA fica preso esperando por ele.
 */
export function comTempoLimite<T>(promessa: Promise<T>, ms: number, etapa: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tempo = Math.max(1, ms);
    const timer = window.setTimeout(
      () => reject(new Error(`Tempo limite de ${Math.round(tempo / 1000)}s excedido em: ${etapa}.`)),
      tempo
    );
    promessa.then(
      valor => { window.clearTimeout(timer); resolve(valor); },
      erro => { window.clearTimeout(timer); reject(erro); }
    );
  });
}

/**
 * Resumo do último período válido do diretor — cópia EXATA da regra do card
 * da tela (App): último valor numérico finite; se o período for ajustado e o
 * valor ausente, exibe o período com “Não informado”. Nível em algarismo
 * romano (I…V) com vírgula para valores não inteiros.
 */
function resumoDaEvolucao(evolution: EvolucaoMensal | null): ResumoEvolucaoPdf | null {
  if(!evolution) return null;
  const valores = evolution.series?.[0]?.valores || [];
  const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V'];
  let i = -1;
  for(let k = valores.length - 1; k >= 0; k--){
    const v = valores[k];
    if(typeof v === 'number' && Number.isFinite(v)){ i = k; break; }
    if(evolution.periods?.[k]?.ajustado){ i = k; break; }
  }
  if(i < 0) return null;
  const p = evolution.periods[i] || ({} as (typeof evolution.periods)[number]);
  const v = valores[i];
  return {
    periodo: limpar(p.rotulo) || limpar(p.label) || '',
    status: limpar(p.status) || '',
    nivel: (ROMANOS[v as number] || (Number.isFinite(v as number) ? (v as number).toFixed(1).replace('.', ',') : '')),
    ajustado: !!p.ajustado
  };
}

/** Entrada de agrupamento: um diretor (ou um vínculo Diretor+Unidade) e seus registros. */
interface EntradaEvolucaoPdf {
  nome: string;
  regional: string;
  unidade?: string;
  registros: Registro[];
}

/** Comparação de texto em pt-BR: ignora caixa, espaços extras e acentuação. */
const cmpTexto = (a: string, b: string): number =>
  String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { sensitivity: 'base' });

/** Grupo de vínculos ativos sem Regional informada (sempre no FINAL do PDF geral). */
const REGIONAL_NAO_INFORMADA = 'Regional não informada';

/**
 * Monta os itens do PDF.
 *  - individual (Regional + Diretor selecionados): só aquele diretor;
 *  - regional (Regional, “Todos os diretores”): diretores ativos da
 *    Regional, em ordem alfabética;
 *  - geral (“Todas as regionais” + “Todos os diretores”): coleção própria
 *    montada a partir do conjunto COMPLETO de registros ativos recebidos
 *    (nunca a lista filtrada da tela), com UMA página por vínculo ÚNICO
 *    Diretor + Unidade, agrupada pela Regional do próprio registro e
 *    ordenada: Regionais em pt-BR e diretores em pt-BR dentro de cada
 *    Regional (“Regional não informada” por último).
 * Diretores arquivados/inativos já vêm fora do modelo; nomes vazios/técnicos
 * são descartados; registros duplicados do MESMO vínculo viram UMA página.
 */
export function montarItensEvolucaoPdf(params: {
  registros: readonly Registro[];
  avaliacoes: readonly { id: string }[];
  regional: string;
  diretor: string;
}): { escopo: EscopoEvolucaoPdf; itens: ItemEvolucaoPdf[] } {
  const { registros, avaliacoes, regional, diretor } = params;
  const escopo: EscopoEvolucaoPdf = diretor ? 'individual' : (regional ? 'regional' : 'geral');

  let lista: EntradaEvolucaoPdf[];

  if(escopo === 'geral'){
    // MODO GERAL: vínculo ÚNICO Diretor + Unidade (a mesma chave não gera
    // duas páginas). A Regional vem do registro operacional daquele vínculo
    // — nunca da posição da linha, de outro diretor nem de filtro antigo.
    const vinculos = new Map<string, EntradaEvolucaoPdf>();
    for(const r of registros || []){
      if(r?.arquivado) continue;
      if(!isPresentName(r?.diretor)) continue;
      const nome = normName(r.diretor);
      const unidade = limpar(r.unidade);
      const chave = `${nameKey(nome)}|${nameKey(unidade)}`;
      const existente = vinculos.get(chave);
      if(existente){
        if(!existente.regional && limpar(r.regional)) existente.regional = limpar(r.regional);
        existente.registros.push(r);
      }else{
        vinculos.set(chave, { nome, regional: limpar(r.regional), unidade, registros: [r] });
      }
    }
    lista = [...vinculos.values()];
    for(const e of lista){
      if(!e.regional){
        console.warn(`[avaliacao-diretores] Diretor ativo sem Regional no PDF geral: ${e.nome} — agrupado em “${REGIONAL_NAO_INFORMADA}”.`);
        e.regional = REGIONAL_NAO_INFORMADA;
      }
    }
    const ultima = (e: EntradaEvolucaoPdf): number => (e.regional === REGIONAL_NAO_INFORMADA ? 1 : 0);
    lista.sort((a, b) =>
      (ultima(a) - ultima(b)) ||
      cmpTexto(a.regional, b.regional) ||
      cmpTexto(a.nome, b.nome) ||
      cmpTexto(a.unidade || '', b.unidade || ''));
  }else{
    const porDiretor = new Map<string, EntradaEvolucaoPdf>();
    for(const r of registros || []){
      if(!isPresentName(r?.diretor)) continue;
      const k = nameKey(r.diretor);
      let entry = porDiretor.get(k);
      if(!entry){
        entry = { nome: normName(r.diretor), regional: limpar(r.regional), registros: [] };
        porDiretor.set(k, entry);
      }
      entry.registros.push(r);
    }
    lista = [...porDiretor.values()];
    if(escopo === 'individual'){
      const alvo = nameKey(diretor);
      lista = lista.filter(e => nameKey(e.nome) === alvo);
    }
    lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  const itens: ItemEvolucaoPdf[] = lista.map(e => {
    const evolution = buildDirectorMonthlyEvolution(e.registros, avaliacoes, e.nome);
    const unidades = [...new Set(e.registros.map(r => limpar(r.unidade)).filter(Boolean))];
    return {
      diretor: e.nome,
      regional: e.regional,
      unidades,
      registros: e.registros,
      evolution,
      resumo: resumoDaEvolucao(evolution)
    };
  });
  return { escopo, itens };
}

/** Nome do arquivo: evolucao-…-AAAA-MM-DD.pdf (data local de geração). */
export function nomeArquivoEvolucaoPdf(
  escopo: EscopoEvolucaoPdf,
  filtros: { diretor?: string; regional?: string },
  hoje: Date = new Date()
): string {
  const data = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
  if(escopo === 'individual') return `evolucao-diretor-${slug(filtros.diretor) || 'diretor'}-${data}.pdf`;
  if(escopo === 'regional') return `evolucao-diretores-regional-${slug(filtros.regional) || 'regional'}-${data}.pdf`;
  return `evolucao-diretores-geral-${data}.pdf`;
}

/**
 * Largura da área de captura: largura base do card + espaço para TODOS os
 * períodos (mesma regra do gráfico: gap mínimo de 96px acima de 18 períodos
 * somado a padding + eixo Y), para que nenhum mês seja cortado no PDF.
 */
export function larguraAreaCaptura(totalPeriodos: number): number {
  const n = Math.max(0, Math.floor(totalPeriodos));
  return Math.max(1180, 236 + 96 * Math.max(0, n - 1));
}

/**
 * Captura a área isolada (fora da tela) em alta resolução. Fundo branco;
 * cores, transparências, bordas, arredondamentos e textos preservados.
 * `width`/`height` vêm do próprio elemento (as media queries continuam
 * respondendo à janela real do usuário, igual à tela). O canvas é liberado
 * (largura/altura = 0) logo após a leitura do dataUrl, página a página.
 */
export async function capturarAreaPdf(
  node: HTMLElement,
  escala = 3,
  opcoes?: { formato?: 'PNG' | 'JPEG'; qualidade?: number }
): Promise<ImagemCapturada> {
  const mod = await import('html2canvas');
  const html2canvas = mod.default;
  const formato: 'PNG' | 'JPEG' = opcoes?.formato || 'PNG';
  const qualidade = opcoes?.qualidade ?? 1;
  const largura = Math.max(1, Math.round(node.scrollWidth));
  const altura = Math.max(1, Math.round(node.scrollHeight));
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = await html2canvas(node, {
      backgroundColor: '#ffffff',
      scale: escala,
      logging: false,
      useCORS: true,
      width: largura,
      height: altura
    });
    const dataUrl = formato === 'JPEG'
      ? canvas.toDataURL('image/jpeg', qualidade)
      : canvas.toDataURL('image/png');
    return { dataUrl, largura: canvas.width, altura: canvas.height, formato };
  } finally {
    if(canvas){
      canvas.width = 0;
      canvas.height = 0;
      canvas = null;
    }
  }
}

/* ------------------------------------------------------- montagem jsPDF */

export async function criarDocumentoPdf(): Promise<jsPDF> {
  const mod = await import('jspdf');
  return new mod.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
}

/** Adiciona UMA página (paisagem A4) com a captura centralizada, sem deformar. */
export function adicionarPaginaCapturada(doc: jsPDF, img: ImagemCapturada, indice: number): void {
  const PW = 297, PH = 210, MARGEM = 8, RODAPE = 8;
  const dispW = PW - MARGEM * 2;
  const dispH = PH - MARGEM * 2 - RODAPE;
  const aspect = img.altura / Math.max(1, img.largura);
  let w = dispW;
  let h = w * aspect;
  if(h > dispH){ h = dispH; w = h / aspect; }
  const x = MARGEM + (dispW - w) / 2;
  const y = MARGEM + (dispH - h) / 2;
  // O jsPDF já nasce com 1 página vazia: a primeira captura OCUPA essa página
  // e as demais abrem página nova (uma página por diretor, sem página em branco).
  if(indice > 0) doc.addPage();
  doc.addImage(img.dataUrl, img.formato === 'JPEG' ? 'JPEG' : 'PNG', x, y, w, h);
}

/**
 * Página de AVISO no lugar de um gráfico que não pôde ser gerado (tempo
 * limite/renderização): mantém “uma página por diretor” e o rodapé
 * “Página X de Y” continua correto. Só é chamada quando a página daquele
 * índice ainda não recebeu imagem.
 */
export function adicionarPaginaAvisoPdf(
  doc: jsPDF,
  indice: number,
  regional: string,
  diretor: string,
  motivo: string
): void {
  const PW = 297, PH = 210;
  let total = doc.getNumberOfPages();
  while(total <= indice){ doc.addPage(); total++; }
  doc.setPage(indice + 1);
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(30, 41, 59);
  doc.text('Gráfico não pôde ser gerado', PW / 2, 84, { align: 'center' });
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(71, 85, 105);
  doc.text(`Regional: ${regional || 'Não informada'}`, PW / 2, 100, { align: 'center' });
  doc.text(`Diretor: ${diretor}`, PW / 2, 110, { align: 'center' });
  doc.setFontSize(9).setTextColor(100, 116, 139);
  doc.text(String(motivo || '').slice(0, 240), PW / 2, 124, { align: 'center', maxWidth: PW - 40 });
}

/**
 * Download por Blob + âncora <a download>: gera o arquivo DEPOIS do lote,
 * cria URL temporária, dispara o clique, remove a âncora e revoga a URL.
 * Evita depender do comportamento interno de pdf.save() em documentos grandes.
 */
export function baixarDocumentoPdf(doc: jsPDF, nomeArquivo: string): void {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const ancora = document.createElement('a');
  ancora.href = url;
  ancora.download = nomeArquivo;
  ancora.rel = 'noopener';
  ancora.style.display = 'none';
  document.body.appendChild(ancora);
  ancora.click();
  document.body.removeChild(ancora);
  // A URL é revogada DEPOIS do download iniciado (nunca antes, para não
  // abortar o arquivo) e o Blob deixa de ser referenciado em seguida.
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Rodapé em TODAS as páginas + download. Em modo geral, `regionais` traz a
 * Regional de CADA página (mesma ordem dos itens) e um rótulo discreto
 * “Regional: NOME” aparece no cabeçalho — sem tocar no gráfico capturado.
 * `opcoes.viaBlob` (modo GERAL) baixa via Blob + âncora; os demais escopos
 * continuam usando pdf.save(), exatamente como sempre funcionaram.
 */
export async function finalizarDocumentoPdf(
  doc: jsPDF,
  nomeArquivo: string,
  regionais?: readonly (string | null)[],
  opcoes?: { viaBlob?: boolean }
): Promise<void> {
  const PW = 297, PH = 210, MARGEM = 8;
  const total = doc.getNumberOfPages();
  const agora = new Date();
  const data = `${pad(agora.getDate())}/${pad(agora.getMonth() + 1)}/${agora.getFullYear()}`;
  const hora = `${pad(agora.getHours())}:${pad(agora.getMinutes())}`;
  for(let p = 1; p <= total; p++){
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(114, 133, 141);
    const regional = regionais?.[p - 1];
    if(regional) doc.text(`Regional: ${regional}`, MARGEM, 5);
    doc.text('Desenvolvido por V3LOZ', MARGEM, PH - 4.5);
    doc.text(`Página ${p} de ${total}`, PW / 2, PH - 4.5, { align: 'center' });
    doc.text(`Gerado em ${data} às ${hora}`, PW - MARGEM, PH - 4.5, { align: 'right' });
  }
  if(opcoes?.viaBlob) baixarDocumentoPdf(doc, nomeArquivo);
  else doc.save(nomeArquivo);
}
