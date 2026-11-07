import React,{useEffect,useMemo,useRef,useState} from 'react';
import {analyzeWorkbookBuffer} from '../lib/dataParser.ts';
import {validateSpreadsheetFile} from '../services/fileValidator.ts';
import {loadPublishedDashboard,buildDashboardModel,regionalsOf,directorsOf,buildDirectorMonthlyEvolution,avgNumbers,recordMetric,countDistinctNames,matrixPeriodColumns,aplicarAjusteIndicadorNoModelo} from '../services/dashboardService.ts';
import {isSupabaseConfigured} from '../services/supabaseClient.ts';
import {computeSha256} from '../services/hashService.ts';
import {findAvaliacoesByHash} from '../services/avaliacoesService.ts';
import {opcoesStatus as opcoesStatusDoModelo,aplicarAjusteNoModelo,aplicarRestauracaoNoModelo} from '../services/ajustesService.ts';
import {aplicarPeriodoManualNoModelo} from '../services/periodosManuais.ts';
import ImportDialog,{type AnalysisComBuffer,type RelatorioImportado} from '../features/importacao/ImportDialog.tsx';
import EditorPeriodo from '../features/dashboard/EditorPeriodo.tsx';
import PeriodosManuais from '../features/matriz/PeriodosManuais.tsx';
import ErrorBoundary from '../components/ErrorBoundary.tsx';
import PerformanceMatrix from '../features/matriz/PerformanceMatrix.tsx';
import Pareceres from '../features/pareceres/Pareceres.tsx';
import {MonthlyEvolutionChart,RadarChart} from '../features/dashboard/Charts.tsx';
import CapturaEvolucaoPdf from '../features/dashboard/CapturaEvolucaoPdf.tsx';
import ConfirmModal from '../components/ConfirmModal.tsx';
import {montarItensEvolucaoPdf,nomeArquivoEvolucaoPdf,larguraAreaCaptura,capturarAreaPdf,criarDocumentoPdf,adicionarPaginaCapturada,adicionarPaginaAvisoPdf,finalizarDocumentoPdf,comTempoLimite,dormir,opcaoCapturaPorEscopo,type EscopoEvolucaoPdf,type ItemEvolucaoPdf,type ResumoEvolucaoPdf,type ImagemCapturada,type DocEvolucaoPdf} from '../services/evolucaoPdfService.ts';
import type {DashboardModel} from '../types/modelo';
import type {AjusteRow} from '../types/supabase';
import type {AvaliacaoHashInfo} from '../services/avaliacoesService.ts';
import type {ResultadoPeriodosManuais} from '../features/matriz/PeriodosManuais.tsx';
const avg=a=>avgNumbers(a);
const fmt=(v,name='')=>v==null?'—':['Ritmo de captação','Crescimento de matrículas','Evasão','EBITDA'].includes(name)?`${(v*100).toLocaleString('pt-BR',{maximumFractionDigits:1,minimumFractionDigits:1})}%`:v.toLocaleString('pt-BR',{maximumFractionDigits:2,minimumFractionDigits:2});
const metrics=['Presencial','Acadêmico','Pós-graduação','Nota geral','Ritmo de captação','Crescimento de matrículas','Evasão','Avaliação institucional','EBITDA'];
const MESES_NOME={JAN:'janeiro',FEV:'fevereiro',MAR:'março',ABR:'abril',MAI:'maio',JUN:'junho',JUL:'julho',AGO:'agosto',SET:'setembro',OUT:'outubro',NOV:'novembro',DEZ:'dezembro'};
// Exibição amigável de erros na interface: nomes internos (aba do arquivo,
// serviços de dados, envio e regras de acesso) aparecem em linguagem simples.
const humanError=m=>String(m||'').replace(/aba chamada Planilha1/gi,'aba principal da planilha').replace(/Planilha1/gi,'planilha').replace(/VITE_SUPABASE_[A-Z_]+|SUPABASE_[A-Z_]+/gi,'a configuração').replace(/\bSupabase\b/gi,'sistema de dados').replace(/Storage/g,'o envio do arquivo').replace(/\bRLS\b/g,'as regras de acesso');
// Paleta ÚNICA do Status no resumo do card de evolução (subcard + etiqueta).
// Uma só função decide as cores: normaliza caixa e espaços extras, reconhece
// Supervisão I/II, Gestão I/II e Delegação I/II; qualquer outra classificação
// (Acompanhamento, Reposicionamento, "Não informado", etc.) fica NEUTRA — sem
// herdar vermelho, amarelo ou verde. A cor vale só para o subcard e a etiqueta.
const PALETAS_STATUS={
  'st-supervisao':{fundo:'#FEF2F2',borda:'#EF4444',etiqueta:'#EF4444',etiquetaTexto:'#FFFFFF'},
  'st-gestao':{fundo:'#FFFBEB',borda:'#FACC15',etiqueta:'#FACC15',etiquetaTexto:'#422006'},
  'st-delegacao':{fundo:'#F0FDF4',borda:'#22C55E',etiqueta:'#22C55E',etiquetaTexto:'#FFFFFF'},
  'st-neutro':{fundo:'#F1F5F9',borda:'#94A3B8',etiqueta:'#64748B',etiquetaTexto:'#FFFFFF'}
};
const paletaStatus=s=>{
  const t=String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  if(/^supervisao (i|ii)$/.test(t))return 'st-supervisao';
  if(/^gestao (i|ii)$/.test(t))return 'st-gestao';
  if(/^delegacao (i|ii)$/.test(t))return 'st-delegacao';
  return 'st-neutro';
};

// Pendência de importação em diálogo: arquivo escolhido, análise local (com o
// buffer binário anexado) e o resultado da comparação de hash.
interface PendenteImport {
  file: File;
  analysis: AnalysisComBuffer;
  arquivosIguais: AvaliacaoHashInfo[];
}

// Exportação em lote do PDF da evolução: tempo limite por PÁGINA (renderização
// + captura juntas) e pausa curta entre páginas para o navegador processar a
// fila de eventos e liberar a interface.
const TEMPO_PAGINA_MS=15000;
const PAUSA_ENTRE_PAGINAS_MS=50;

export default function App(){
 const [model,setModel]=useState<DashboardModel|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),
  [regional,setRegional]=useState(''),[director,setDirector]=useState(''),
  [message,setMessage]=useState(''),[pendingImport,setPendingImport]=useState<PendenteImport|null>(null);
  // A antiga área de OBSERVAÇÕES da lateral foi removida (título “Observação do
  // regional”, campo de texto, botão “Salvar observação”, título/lista
  // “Observações do regional” e a mensagem “Nenhuma observação registrada.”):
  // criar, consultar, editar, excluir (lógico) e ver o histórico acontecem
  // somente nos dois cards da área principal (Parecer do Regional e Parecer de
  // Operações, em src/components/Pareceres.tsx). Nenhum dado do banco foi
  // apagado e o CRUD não foi removido — apenas a interface mudou de lugar.

 const [indConsolidado,setIndConsolidado]=useState(false);
 // Edição do STATUS e do NÍVEL do ÚLTIMO PERÍODO VÁLIDO do diretor (o período
 // é sempre o identificado automaticamente — sem seletor de meses). O dado
 // importado da planilha nunca é alterado: o ajuste fica em estrutura
 // separada (avaliacoes_diretores_ajustes) e o valor vigente passa a ter
 // prioridade sobre o importado.
  const [editorAberto,setEditorAberto]=useState(false),[editorSucesso,setEditorSucesso]=useState(''),
  [periodosAberto,setPeriodosAberto]=useState(false);
 const fileRef=useRef<HTMLInputElement>(null);

 // Exportação em PDF da “Evolução mensal do Status e do Nível”: confirmação
 // compacta (escopo, Regional, diretores, páginas) e execução em lote com
 // UMA página por diretor, capturando a área isolada (fora da tela) sem
 // alterar os filtros nem a seleção visível da aplicação.
  const [pdfPreparo,setPdfPreparo]=useState<{escopo:EscopoEvolucaoPdf;itens:ItemEvolucaoPdf[];nome:string;regionais:number;diretores:number}|null>(null),
  [pdfExecucao,setPdfExecucao]=useState<{itens:ItemEvolucaoPdf[];indice:number;nome:string;escopo:EscopoEvolucaoPdf}|null>(null),
  [pdfProgresso,setPdfProgresso]=useState('');
 const captureRef=useRef<HTMLDivElement|null>(null);
 const pdfDocRef=useRef<DocEvolucaoPdf|null>(null);

 // Sem variáveis de ambiente o usuário vê uma mensagem clara de configuração
 // ausente (nunca tela branca, nunca dados de exemplo carregados sozinhos).
 async function reload(){setLoading(true);setLoadError('');try{if(!isSupabaseConfigured())throw new Error('Configuração ausente: as variáveis de ambiente do sistema de dados não foram definidas neste ambiente.');const raw=await loadPublishedDashboard();setModel(buildDashboardModel(raw) as DashboardModel);}catch(err){console.error('[avaliacao-diretores] Falha ao carregar o dashboard:', err?.message||String(err));setLoadError(err?.message||String(err));}finally{setLoading(false);}}
 useEffect(()=>{reload()},[]);

 const allRecords=model?.registros||[];
 const regionals=useMemo(()=>regionalsOf(allRecords),[model]);
 const directors=useMemo(()=>directorsOf(allRecords,regional),[model,regional]);
  const visible=useMemo(()=>allRecords.filter(r=>(!regional||r.regional===regional)&&(!director||r.diretor===director)),[model,regional,director]);
  // Registros são ENTIDADES reutilizadas entre importações (avaliacao_id = da
  // criação) — a contagem de "avaliações disponíveis" é sempre o total
  // publicado, nunca derivado do avaliacao_id dos registros visíveis.

 // Evolução MENSAL: ANÁLISE INDIVIDUAL de um diretor. Só existe card quando
 // um diretor específico está selecionado (sem diretor = evolution null = card
 // fora do DOM, sem espaço vazio). Uma única série — o próprio diretor — sem
 // consolidado regional nem consolidado geral. O eixo usa os meses REAIS dos
 // cabeçalhos da planilha, iniciando no primeiro mês com status ou nível
 // válido daquele diretor e seguindo até o último período da avaliação;
 // lacunas ficam no eixo sem ponto e sem zero (linha interrompida).
  const evolution=useMemo(()=>{
    if(!model||!director)return null;
    return buildDirectorMonthlyEvolution(visible,model.avaliacoes,director);
  },[model,director,visible]);

  // Unidades do diretor selecionado na seleção atual (sem inventar unidade
  // principal): lista compacta exibida abaixo do título do gráfico de
  // evolução. Se houver mais de uma unidade, aparecem unidas por "·".
  const evUnidades=useMemo(()=>{
    const s=new Set();
    for(const r of visible){const u=String(r.unidade||'').replace(/\s+/g,' ').trim();if(u)s.add(u);}
    return [...s];
  },[visible]);

  // Resumo do ÚLTIMO PONTO VÁLIDO da linha (o mesmo ponto que o gráfico
  // desenha): rótulo ORIGINAL do período, status daquele período e nível
  // plotado. Sem informação válida a interface mostra "Não informado" — nunca
  // usa status de gestão, ciclo de vida, nível atual da unidade, indicadores
  // nem pareceres. Exibido no canto superior direito do card, ao lado do
  // título e dos textos explicativos, fora da área de desenho.
  const evResumo=useMemo(()=>{
    if(!evolution)return null;
    const valores=evolution.series?.[0]?.valores||[];
    const ROMANOS=['','I','II','III','IV','V'];
    let i=-1;
    for(let k=valores.length-1;k>=0;k--){const v=valores[k];if(typeof v==='number'&&Number.isFinite(v)){i=k;break;}if(evolution.periods?.[k]?.ajustado){i=k;break;}}
    if(i<0)return null;
    const p=evolution.periods[i]||{} as (typeof evolution.periods)[number],v=valores[i];
    const txt=x=>String(x??'').replace(/\s+/g,' ').trim();
    return {periodo:txt(p.rotulo)||txt(p.label)||'',status:txt(p.status)||'',nivel:ROMANOS[v]||(Number.isFinite(v)?v.toFixed(1).replace('.',','):''),
      // Único período editável: identificadores reais + situação do ajuste.
      periodoId:p.periodoId||null,registroId:p.registroId||null,avaliacaoId:p.avaliacaoId||null,
      ajustado:!!p.ajustado,statusOriginal:txt(p.statusOriginal)||'',nivelOriginal:p.nivelOriginal??null};
  },[evolution]);

  // Opções do formulário de edição: classificações do sistema (base) + valores
  // válidos distintos já existentes nos períodos importados de TODOS os
  // diretores. Nunca mistura ciclo de vida, status de gestão da unidade,
  // pareceres, aprovação ou indicadores.
  const estagiosImportados=useMemo(()=>{
    const s=new Set<string>();
    for(const r of allRecords)for(const p of r.periodos||[]){const t=String(p.estagio??'').replace(/\s+/g,' ').trim();if(t)s.add(t);}
    return [...s];
  },[model]);
  const statusOpcoes=useMemo(()=>opcoesStatusDoModelo(estagiosImportados),[estagiosImportados]);

  // Sucesso é exibido no resumo e some sozinho (mensagem curta, sem novo card).
  useEffect(()=>{
    if(!editorSucesso)return;
    const t=setTimeout(()=>setEditorSucesso(''),6000);
    return ()=>clearTimeout(t);
  },[editorSucesso]);

  // Motor da exportação em PDF: UM diretor por vez, de forma SEQUENCIAL e
  // com TEMPO LIMITE por página. A área isolada é renderizada pelo React
  // (pdfExecucao) e só é fotografada depois de confirmada (data-indice +
  // dimensões). Cada captura entra no jsPDF e é descartada na hora; o
  // canvas é zerado pelo serviço. Falha ou timeout de UM diretor vira
  // página de aviso e o lote CONTINUA — nenhum diretor bloqueia os demais.
  // No fim: rodapé em todas as páginas + download (Blob no modo geral) e
  // liberação do botão e dos elementos temporários.
  const loteTokenRef=useRef(0);
  const loteAtivoRef=useRef(false);

  // Cancela um lote em andamento somente se a aplicação for desmontada.
  useEffect(()=>()=>{loteTokenRef.current++;loteAtivoRef.current=false;},[]);

  // Espera a área isolada estar renderizada COM o diretor do índice atual.
  // Usa polling curto (setTimeout — funciona mesmo com a aba em segundo
  // plano); nunca usa requestAnimationFrame nem espera infinita.
  function aguardarCapturaPronta(indice:number,prazoMs:number,ativo:()=>boolean):Promise<HTMLElement>{
    return new Promise<HTMLElement>((resolve,reject)=>{
      const prazo=Date.now()+Math.max(1,prazoMs);
      let largAnt=-1,altAnt=-1;
      const checar=()=>{
        if(!ativo()){reject(new Error('Exportação de PDF cancelada.'));return;}
        const node=captureRef.current;
        if(node&&node.isConnected&&node.dataset.indice===String(indice)&&node.scrollWidth>0&&node.scrollHeight>0){
          // Só considera pronta quando as dimensões estão ESTÁVEIS (duas
          // leituras iguais seguidas): o ResizeObserver do gráfico já aplicou.
          const w=node.scrollWidth,h=node.scrollHeight;
          if(w===largAnt&&h===altAnt){resolve(node);return;}
          largAnt=w;altAnt=h;
        }else{largAnt=-1;altAnt=-1;}
        if(Date.now()>=prazo){reject(new Error(`Tempo esgotado aguardando a renderização do gráfico (página ${indice+1}).`));return;}
        window.setTimeout(checar,20);
      };
      checar();
    });
  }

  async function executarLotePdf(preparo:{itens:ItemEvolucaoPdf[];nome:string;escopo:EscopoEvolucaoPdf}){
    const {itens,nome,escopo}=preparo;
    const token=++loteTokenRef.current;
    const ativo=()=>loteTokenRef.current===token;
    const total=itens.length;
    const opcoes=opcaoCapturaPorEscopo(escopo);
    const inicioLote=Date.now();
    let geradas=0,avisos=0;
    let etapa='início',pagina=0,regionalAtual='',diretorAtual='';
    try{
      console.info(`[avaliacao-diretores] PDF da evolução: iniciando modo ${escopo} com ${total} página(s).`);
      etapa='criação do documento';
      setPdfProgresso(`Preparando ${total} página(s)…`);
      const doc=await criarDocumentoPdf();
      pdfDocRef.current=doc;
      etapa='carregamento de fontes';
      if(document.fonts&&document.fonts.ready){
        try{await comTempoLimite(document.fonts.ready,5000,'carregamento de fontes');}catch{/* fontes atuais já servem */}
      }
      for(let indice=0;indice<total;indice++){
        if(!ativo())break;
        const atual=itens[indice];
        pagina=indice+1;regionalAtual=atual.regional;diretorAtual=atual.diretor;
        setPdfExecucao({itens,indice,nome,escopo});
        setPdfProgresso(escopo==='geral'
          ? `Gerando página ${pagina} de ${total}: ${atual.regional} · ${atual.diretor}`
          : `Gerando página ${pagina} de ${total}`);
        // Tempo limite SEGURO por página (renderização + captura juntas).
        const limitePagina=Date.now()+TEMPO_PAGINA_MS;
        const restante=()=>Math.max(500,limitePagina-Date.now());
        let falha='';
        let img:ImagemCapturada|null=null;
        try{
          etapa='renderização do gráfico';
          const node=await comTempoLimite(aguardarCapturaPronta(indice,restante(),ativo),restante(),`renderização do gráfico (página ${pagina})`);
          await dormir(60);
          if(!ativo())break;
          etapa='captura do gráfico';
          img=await comTempoLimite(capturarAreaPdf(node,opcoes.escala,opcoes),restante(),`captura do gráfico (página ${pagina})`);
          if(!ativo())break;
          etapa='adição da página ao PDF';
          adicionarPaginaCapturada(doc,img,indice);
          geradas++;
        }catch(err){
          if(!ativo())break;
          falha=String(err?.message||err);
          console.error(`[avaliacao-diretores] PDF da evolução: etapa=${etapa}, página=${pagina} de ${total}, regional=${regionalAtual}, diretor=${diretorAtual}, erro=${falha}`);
        }finally{
          img=null;
        }
        if(falha&&ativo()){
          etapa='página de aviso';
          try{
            adicionarPaginaAvisoPdf(doc,indice,regionalAtual,diretorAtual,`Não foi possível gerar o gráfico deste diretor. ${falha}`);
            avisos++;
          }catch(errAviso){
            console.error(`[avaliacao-diretores] PDF da evolução: falha ao montar a página de aviso ${pagina} (${diretorAtual}):`,errAviso?.message||String(errAviso));
          }
        }
        etapa='pausa entre páginas';
        await dormir(PAUSA_ENTRE_PAGINAS_MS);
      }
      if(!ativo())return;
      etapa='finalização do PDF';
      setPdfProgresso('Finalizando PDF...');
      const paginas=doc.getNumberOfPages();
      if(paginas<1)throw new Error('O PDF não possui páginas após o processamento dos diretores.');
      await comTempoLimite(
        finalizarDocumentoPdf(doc,nome,escopo==='geral'?itens.map(i=>i.regional):undefined,{viaBlob:escopo==='geral'}),
        60000,
        'finalização e download do PDF'
      );
      etapa='download concluído';
      const duracao=Math.round((Date.now()-inicioLote)/1000);
      if(escopo==='geral'){
        setMessage(avisos===0
          ? `PDF gerado com sucesso: ${paginas} páginas.`
          : `PDF gerado com ${geradas} páginas e ${avisos} página${avisos>1?'s':''} de aviso${avisos>1?'s':''}.`);
      }else{
        setMessage(`PDF gerado com sucesso: “${nome}” — ${paginas} página(s).`);
      }
      console.info(`[avaliacao-diretores] PDF da evolução concluído: ${nome} — ${paginas} página(s) (${geradas} gráfica(s), ${avisos} de aviso) em ${duracao}s.`);
    }catch(err){
      const msg=String(err?.message||err);
      console.error('[avaliacao-diretores] Falha ao gerar o PDF da evolução:',{etapa,pagina,regional:regionalAtual,diretor:diretorAtual,erro:msg});
      setMessage(`Erro ao gerar o PDF (etapa: ${etapa}${diretorAtual?`, página ${pagina} — ${diretorAtual}`:''}): ${humanError(msg)}`);
    }finally{
      loteAtivoRef.current=false;
      pdfDocRef.current=null;
      setPdfExecucao(null);
      setPdfProgresso('');
    }
  }

  // Chamado APÓS o banco confirmar a gravação: o modelo em memória recebe o
  // ajuste (resumo, último ponto do gráfico, tooltip e célula da matriz
  // atualizam na hora) e o formulário fecha. Nada é aplicado antes da
  // confirmação do banco.
  function aposSalvarAjuste(ajuste: AjusteRow){
    setModel(m=>m?aplicarAjusteNoModelo(m,ajuste):m);
    setEditorAberto(false);
    setEditorSucesso('Status e nível atualizados com sucesso.');
  }

  // Painel "Atualizar dados" da Matriz: cadastro manual de período novo
  // (linha com origem "cadastro manual"), ajuste de Status/Nível de um
  // período existente (edição na própria linha da tabela) ou atualização de
  // pontuações/indicadores (painel dedicado). O modelo é atualizado APÓS a
  // confirmação do banco — cards, radar, matriz e gráfico mensal mudam na
  // hora, sem F5; o painel permanece aberto para conferência (a tabela de
  // períodos e a origem de cada linha são recalculadas pelo modelo novo).
  function aposSalvarPeriodo(info: ResultadoPeriodosManuais){
    if(info?.tipo==='cadastro'){
      setModel(m=>m?aplicarPeriodoManualNoModelo(m,info):m);
      setMessage(`Período ${info.rotulo} cadastrado com sucesso.`);
    }else if(info?.tipo==='indicadores'){
      setModel(m=>m?aplicarAjusteIndicadorNoModelo(m,info?.ajustes||[]):m);
      setMessage(`Pontuações e indicadores atualizados com sucesso (${info?.total||0} campo(s)).`);
    }else if(info?.tipo==='restaurar'){
      setModel(m=>m?aplicarRestauracaoNoModelo(m,info):m);
      setMessage('Valor importado restaurado (ajuste manual removido).');
    }else{
      setModel(m=>m?aplicarAjusteNoModelo(m,info?.ajuste):m);
      setMessage('Status e nível atualizados com sucesso.');
    }
  }

  // Paleta do subcard do resumo (PALETAS_STATUS da tela) para a área isolada
  // de captura: as MESMAS variáveis --ev-* do card exibido, sem tocar no
  // componente nem no layout da aplicação.
  const estiloDoResumo=(r:ResumoEvolucaoPdf|null):Record<string,string>|null=>{
    if(!r)return null;
    const p=PALETAS_STATUS[paletaStatus(r.status)];
    return {'--ev-fundo':p.fundo,'--ev-borda':p.borda,'--ev-etq':p.etiqueta,'--ev-etq-texto':p.etiquetaTexto};
  };

  // “Baixar PDF”: monta o escopo a partir dos MESMOS registros da tela e abre
  // a confirmação compacta antes de gerar. No modo GERAL (Todas as regionais +
  // Todos os diretores) a coleção nasce do conjunto COMPLETO de registros
  // ativos do modelo (allRecords) — nunca da lista filtrada de uma Regional.
  function abrirConfirmacaoPdf(){
    if(!model||loading||loteAtivoRef.current)return;
    try{
      const escopoGeral=!regional&&!director;
      const base=escopoGeral?allRecords:visible;
      const {escopo,itens}=montarItensEvolucaoPdf({registros:base,avaliacoes:model.avaliacoes,regional,diretor:director});
      if(!itens.length){setMessage('Nenhum diretor visível para gerar o PDF.');return;}
      const regionais=new Set(itens.map(i=>i.regional)).size;
      const diretores=countDistinctNames(base,'diretor');
      setPdfPreparo({escopo,itens:itens.map(it=>({...it,estilo:estiloDoResumo(it.resumo)})),nome:nomeArquivoEvolucaoPdf(escopo,{diretor:director,regional}),regionais,diretores});
    }catch(err){setMessage(`Erro: ${humanError(err?.message||String(err))}`);}
  }
  function gerarPdfConfirmado(){
    if(!pdfPreparo||loteAtivoRef.current)return;
    loteAtivoRef.current=true;
    pdfDocRef.current=null;
    const preparo={itens:pdfPreparo.itens,nome:pdfPreparo.nome,escopo:pdfPreparo.escopo};
    setPdfProgresso('Preparando…');
    // A área isolada do PRIMEIRO diretor é renderizada já nesta atualização;
    // o lote sequencial aguarda a confirmação (data-indice) antes de capturar.
    setPdfExecucao({itens:preparo.itens,indice:0,nome:preparo.nome,escopo:preparo.escopo});
    setPdfPreparo(null);
    void executarLotePdf(preparo);
  }

 // INDICADORES: referência mais recente da avaliação = última coluna de
 // período na ordem cronológica dos dados (mesma regra da matriz). Título
 // dinâmico (ex.: "Indicadores de Setembro de 2026"); sem mês/ano fixo e
 // sem inventar mês que não esteja nos dados.
  const refLabel=useMemo(()=>{if(!model)return null;const cols=matrixPeriodColumns(allRecords,model.avaliacoes);return cols.length?cols[cols.length-1]:null;},[model,allRecords]);
 const refNome=useMemo(()=>{
  const lab=refLabel;if(!lab)return null;
  const up=String(lab).toUpperCase();
  const mes=up.match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\b/);
  const ano=up.match(/(20\d{2})/);
  if(mes&&ano){const nome=MESES_NOME[mes[1]];return `${nome.charAt(0).toUpperCase()+nome.slice(1)} de ${ano[1]}`;}
  return String(lab);
  },[refLabel]);


 // Seleção da planilha: validação + análise LOCAIS (nada vai ao banco nem ao
 // Storage nesta etapa). O hash é calculado apenas para reconhecer, já na
 // prévia, um arquivo binariamente idêntico a um já importado (consulta de
 // leitura). A gravação só acontece depois de "Confirmar atualização".
 async function upload(e: React.ChangeEvent<HTMLInputElement>){
  const file=e.target.files?.[0];if(!file)return;
  try{
   const validation=validateSpreadsheetFile(file);
   if(!validation.ok)throw new Error(validation.errors.join(' '));
   const buffer=await file.arrayBuffer();
   const analysis=analyzeWorkbookBuffer(buffer,file.name) as AnalysisComBuffer;
   analysis.__buffer=buffer;
   let arquivosIguais: AvaliacaoHashInfo[]=[];
   try{const hash=await computeSha256(buffer);arquivosIguais=await findAvaliacoesByHash(hash);}
   catch(err){console.warn('[avaliacao-diretores] Verificação de arquivo idêntico indisponível:',err?.message||String(err));}
   setPendingImport({file,analysis,arquivosIguais});
  }catch(err){setMessage(`Erro: ${humanError(err.message)}`)}
  finally{e.target.value=''}
 }
 async function finishImport(result: RelatorioImportado){setPendingImport(null);setMessage('Salvando avaliação…');await reload();setMessage(`Atualização concluída com sucesso: “${result.titulo}” (${result.trimestre}º tri/${result.ano}) · arquivo ${result.arquivoNome} · ${result.totalRegistros} registros.`);}
  const title=director?'Perfil do diretor':regional?'Desempenho da regional':'Desempenho geral';
  const subtitle=director||regional||'Todas as avaliações, lado a lado';
  // Cores do SUBCARD de resumo (fundo, borda e etiqueta) resolvidas por UMA
  // única configuração — mudam automaticamente ao confirmar a edição do Status.
  const evPaleta=evResumo?PALETAS_STATUS[paletaStatus(evResumo.status)]:null;
  const evEstilo=evPaleta?({'--ev-fundo':evPaleta.fundo,'--ev-borda':evPaleta.borda,'--ev-etq':evPaleta.etiqueta,'--ev-etq-texto':evPaleta.etiquetaTexto} as React.CSSProperties):null;
  // Item atual da captura isolada do PDF (UM diretor por vez, fora da tela).
  const itemCaptura=pdfExecucao?(pdfExecucao.itens[pdfExecucao.indice]||null):null;
  // Selo “1 avaliação disponível” / “X avaliações disponíveis” REMOVIDO do
  // cabeçalho (remoção somente visual: nenhuma avaliação apagada, nenhuma
  // consulta alterada). Os cards de pareceres ocupam a área entre o último
  // gráfico (Evolução mensal) e a Matriz histórica de desempenho.
  return <div className="app">
  <aside className="sidebar"><div className="brand"><img className="brand-logo" src="/assets/logo-diretores.png" alt="SER Educacional — logo da Avaliação de Diretores"/><span className="brand-title">Avaliação de Diretores</span></div><div className="sub">Avaliação de desempenho dos diretores</div>
   <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={upload}/><button className="upload" onClick={()=>fileRef.current.click()}><span>↑</span> Atualizar pela planilha</button>
   <label>Regional</label><select value={regional} onChange={e=>{setRegional(e.target.value);setDirector('')}} disabled={!model}><option value="">Todas as regionais</option>{regionals.map(x=><option key={x}>{x}</option>)}</select>
   <label>Diretor</label><select value={director} onChange={e=>setDirector(e.target.value)} disabled={!regional}><option value="">Todos os diretores</option>{directors.map(x=><option key={x}>{x}</option>)}</select>
   <button type="button" className="upload baixar-pdf" onClick={abrirConfirmacaoPdf} disabled={!model||loading||!!pdfExecucao||countDistinctNames(visible,'diretor')===0}>Baixar PDF</button>
    <div className="profile"><b>{director||regional||'Todas as regionais'}</b><span>{visible.length} registro(s) · {countDistinctNames(visible,'diretor')} diretor(es) · {(model?.avaliacoes?.length)||0} avaliação(ões)</span></div>
   {message&&<div className="message">{message}</div>}
  </aside>
  <ErrorBoundary>
  <main><header><div><small>Avaliação colegiada de performance</small><h1>{title}</h1><p>{subtitle}</p></div></header>
   {loading&&<section className="empty-state"><h2>Carregando avaliações…</h2><p>Aguarde um instante.</p></section>}
   {!loading&&loadError&&<section className="empty-state"><h2>Não foi possível carregar as avaliações</h2><p>Tente novamente em instantes.</p><button className="save" onClick={reload}>Tentar novamente</button></section>}
   {!loading&&!loadError&&model&&model.avaliacoes.length===0&&<section className="empty-state"><h2>Nenhuma avaliação disponível ainda</h2><p>Use “Atualizar pela planilha” para importar um arquivo. As avaliações importadas ficam disponíveis automaticamente e permanecem após recarregar a página.</p></section>}
   {!loading&&!loadError&&model&&model.avaliacoes.length>0&&<>
      <section className="kpis">{[['Diretores',countDistinctNames(visible,'diretor')],['Unidades',countDistinctNames(visible,'unidade')],['Nota geral',fmt(avg(visible.map(r=>recordMetric(r,'Nota geral'))))],['Avaliações',model.avaliacoes.length]].map(([a,b])=><article key={a}><span>{a}</span><strong>{b}</strong></article>)}</section>
     <div className="stack">
       <section className="card">
        <div className="ind-head">
         <div>
          <h2>{indConsolidado?'Indicadores consolidados':(refNome?`Indicadores de ${refNome}`:'Indicadores')}</h2>
          <p>{indConsolidado?'Resultados consolidados das avaliações disponíveis.':'Resultados da referência mais recente da avaliação.'}</p>
         </div>
         <button className="mx-btn" type="button" onClick={()=>setIndConsolidado(v=>!v)}>{indConsolidado?'Ver último período':'Ver consolidado'}</button>
        </div>
        <div className="metric-grid">{metrics.map(n=>{
         const txt=v=>v==null?'Não informado':fmt(v,n);
         const vUlt=avg(visible.map(r=>recordMetric(r,n)));
         const vSel=avg(visible.map(r=>recordMetric(r,n)));
         const vGeral=avg(allRecords.map(r=>recordMetric(r,n)));
         return <div className="metric" key={n}><span>{n}</span><strong>{txt(indConsolidado?vSel:vUlt)}</strong>{indConsolidado&&<small>Consolidado: {txt(vGeral)}</small>}</div>;
        })}</div>
       </section>
      <section className="card radar-card"><h2>Comparação de desempenho</h2><p>Seleção atual versus média geral.</p><ErrorBoundary titulo="Não foi possível desenhar o gráfico de indicadores"><div className="chart"><RadarChart records={visible} allRecords={allRecords}/></div></ErrorBoundary><div className="legend center"><i className="sel"/>Seleção atual <i className="all"/>Média geral</div></section>
      {/* Ordem dos gráficos: primeiro a Comparação de desempenho, depois a
          Evolução mensal do nível de desenvolvimento (apenas movimentação —
          nenhum gráfico, dimensão, dado ou regra foi alterado). O resumo do
          último período válido ocupa o canto superior direito do card, ao lado
          do título e dos textos — nunca dentro da área do gráfico. */}
      {evolution&&<section className="card evolution-card"><div className="ev-topo"><div className="ev-textos"><h2>Evolução mensal do Status e do Nível</h2><div className="ev-diretor"><div className="ev-diretor-linha"><b>Diretor:</b> <span className="ev-diretor-nome">{director}</span></div><div className="ev-diretor-linha"><b>Unidade:</b> <span className="ev-diretor-unidade">{evUnidades.join(' · ')||'Não informado'}</span></div></div></div>{evResumo&&<div className="ev-resumo" style={evEstilo}><div className="ev-linha"><b>Período:</b> <span className="ev-valor">{evResumo.periodo||'Não informado'}</span></div><div className="ev-linha ev-linha-sn"><span className="ev-par"><b>Status:</b> <span className="ev-badge">{evResumo.status||'Não informado'}</span></span><span className="ev-par"><b>Nível:</b> <span className="ev-nivel">{evResumo.nivel||'Não informado'}</span></span></div><div className="ev-linha ev-linha-acoes">{evResumo.ajustado&&<div className="ev-ajuste">Atualizado no sistema</div>}{evResumo.periodoId&&<button type="button" className="ev-editar" onClick={()=>{setEditorSucesso('');setEditorAberto(true);}}>Editar</button>}</div>{editorSucesso&&<div className="ev-sucesso" role="status">{editorSucesso}</div>}</div>}</div><ErrorBoundary titulo="Não foi possível desenhar o gráfico de evolução"><div className="chart"><MonthlyEvolutionChart periods={evolution.periods} series={evolution.series}/></div></ErrorBoundary></section>}
      {/* Pareceres (JUSTIFICATIVA + Parecer de Operações) entre o último
          gráfico e a Matriz histórica — apenas mudança de posição na página. */}
      <Pareceres regional={regional} diretor={director} registros={model.registros} avaliacoes={model.avaliacoes}/>
      <section className="card"><h2>Matriz histórica de desempenho</h2><p>Reprodução da planilha original: histórico por período, situação atual e indicadores.</p><PerformanceMatrix records={visible} allRecords={allRecords} avaliacoes={model.avaliacoes} podeAtualizarDados={!!director} onAtualizarDados={()=>setPeriodosAberto(true)}/></section>
    </div>
   </>}
  <footer className="page-footer">Desenvolvido por V3LOZ</footer>
  </main>
  </ErrorBoundary>
  {pendingImport&&<ImportDialog file={pendingImport.file} analysis={pendingImport.analysis} model={model} arquivosIguais={pendingImport.arquivosIguais} onCancel={()=>setPendingImport(null)} onImported={finishImport}/>}
  {/* Edição do Status/Nível do último período válido (só com diretor
      específico selecionado — sem diretor não há resumo nem botão). */}
  {editorAberto&&evResumo&&evResumo.periodoId&&<EditorPeriodo resumo={evResumo} opcoesStatus={statusOpcoes} onSalvo={aposSalvarAjuste} onFechar={()=>setEditorAberto(false)}/>}
  {/* Cadastro/edição manual de períodos pela Matriz (somente com diretor
      específico selecionado). */}
  {periodosAberto&&director&&model&&<PeriodosManuais registros={visible} avaliacoes={model.avaliacoes} statusOpcoes={statusOpcoes} onSalvo={aposSalvarPeriodo} onFechar={()=>setPeriodosAberto(false)}/>}
  {/* Confirmação ANTES de gerar o PDF: escopo, Regional, quantidade de
      diretores e páginas previstas (mesma quantidade), Cancelar / Gerar PDF. */}
  {pdfPreparo&&<ConfirmModal aberto titulo="Gerar PDF da evolução"
    mensagem="Confira o escopo antes de gerar. Cada diretor ocupa exatamente uma página."
    detalhe={pdfPreparo.escopo==='geral'
      ? `Escopo: Geral\nRegionais: ${pdfPreparo.regionais}\nDiretores: ${pdfPreparo.diretores}\nPáginas previstas: ${pdfPreparo.itens.length}`
      : `Escopo: ${pdfPreparo.escopo==='individual'?'Individual':'Regional'}\nRegional: ${regional||'Todas'}\nDiretores: ${pdfPreparo.itens.length}\nPáginas previstas: ${pdfPreparo.itens.length}`}
    textoConfirmar="Gerar PDF" textoCancelar="Cancelar"
    onConfirm={gerarPdfConfirmado} onCancel={()=>setPdfPreparo(null)}/>}
  {/* Progresso do lote + área de captura isolada (UM diretor por vez). */}
  {pdfExecucao&&<div className="pdf-progresso" role="status">{pdfProgresso||'Preparando…'}</div>}
  {itemCaptura&&pdfExecucao&&<CapturaEvolucaoPdf item={itemCaptura} indice={pdfExecucao.indice} largura={larguraAreaCaptura(itemCaptura.evolution?.periods.length||0)} captureRef={captureRef}/>}
 </div>
}
