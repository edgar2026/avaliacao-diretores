import React,{useEffect,useMemo,useRef,useState} from 'react';
import {analyzeWorkbookBuffer} from './dataParser.js';
import {validateSpreadsheetFile} from './services/fileValidator.js';
import {loadPublishedDashboard,buildDashboardModel,regionalsOf,directorsOf,buildDirectorMonthlyEvolution,avgNumbers,recordMetric,countDistinctNames,matrixPeriodColumns,aplicarAjusteIndicadorNoModelo} from './services/dashboardService.js';
import {isSupabaseConfigured} from './services/supabaseClient.js';
import {computeSha256} from './services/hashService.js';
import {findAvaliacoesByHash} from './services/avaliacoesService.js';
import {opcoesStatus as opcoesStatusDoModelo,aplicarAjusteNoModelo,aplicarRestauracaoNoModelo} from './services/ajustesService.js';
import {aplicarPeriodoManualNoModelo} from './services/periodosManuais.js';
import ImportDialog from './components/ImportDialog.jsx';
import EditorPeriodo from './components/EditorPeriodo.jsx';
import PeriodosManuais from './components/PeriodosManuais.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import PerformanceMatrix from './components/PerformanceMatrix.jsx';
import Pareceres from './components/Pareceres.jsx';
import {MonthlyEvolutionChart,RadarChart} from './components/Charts.jsx';
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

export default function App(){
 const [model,setModel]=useState(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),
  [regional,setRegional]=useState(''),[director,setDirector]=useState(''),
  [message,setMessage]=useState(''),[pendingImport,setPendingImport]=useState(null);
  // A antiga área de OBSERVAÇÕES da lateral foi removida (título “Observação do
  // regional”, campo de texto, botão “Salvar observação”, título/lista
  // “Observações do regional” e a mensagem “Nenhuma observação registrada.”):
  // criar, consultar, editar, excluir (lógico) e ver o histórico acontecem
  // somente nos dois cards da área principal (Parecer do Regional e Parecer de
  // Operações, em src/components/Pareceres.jsx). Nenhum dado do banco foi
  // apagado e o CRUD não foi removido — apenas a interface mudou de lugar.

 const [indConsolidado,setIndConsolidado]=useState(false);
 // Edição do STATUS e do NÍVEL do ÚLTIMO PERÍODO VÁLIDO do diretor (o período
 // é sempre o identificado automaticamente — sem seletor de meses). O dado
 // importado da planilha nunca é alterado: o ajuste fica em estrutura
 // separada (avaliacoes_diretores_ajustes) e o valor vigente passa a ter
 // prioridade sobre o importado.
  const [editorAberto,setEditorAberto]=useState(false),[editorSucesso,setEditorSucesso]=useState(''),
  [periodosAberto,setPeriodosAberto]=useState(false);
 const fileRef=useRef();

 // Sem variáveis de ambiente o usuário vê uma mensagem clara de configuração
 // ausente (nunca tela branca, nunca dados de exemplo carregados sozinhos).
 async function reload(){setLoading(true);setLoadError('');try{if(!isSupabaseConfigured())throw new Error('Configuração ausente: as variáveis de ambiente do sistema de dados não foram definidas neste ambiente.');const raw=await loadPublishedDashboard();setModel(buildDashboardModel(raw));}catch(err){console.error('[avaliacao-diretores] Falha ao carregar o dashboard:', err?.message||String(err));setLoadError(err?.message||String(err));}finally{setLoading(false);}}
 useEffect(()=>{reload()},[]);

 const allRecords=model?.registros||[];
 const regionals=useMemo(()=>regionalsOf(allRecords),[model]);
 const directors=useMemo(()=>directorsOf(allRecords,regional),[model,regional]);
 const visible=useMemo(()=>allRecords.filter(r=>(!regional||r.regional===regional)&&(!director||r.diretor===director)),[model,regional,director]);
 const visibleAvaliacaoIds=useMemo(()=>{const s=new Set(visible.map(r=>r.avaliacaoId));return (model?.avaliacoes||[]).filter(a=>s.has(a.id));},[model,visible]);

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
    const p=evolution.periods[i]||{},v=valores[i];
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
    const s=new Set();
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

  // Chamado APÓS o banco confirmar a gravação: o modelo em memória recebe o
  // ajuste (resumo, último ponto do gráfico, tooltip e célula da matriz
  // atualizam na hora) e o formulário fecha. Nada é aplicado antes da
  // confirmação do banco.
  function aposSalvarAjuste(ajuste){
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
  function aposSalvarPeriodo(info){
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

 // INDICADORES: referência mais recente da avaliação = última coluna de
 // período na ordem cronológica dos dados (mesma regra da matriz). Título
 // dinâmico (ex.: "Indicadores de Setembro de 2026"); sem mês/ano fixo e
 // sem inventar mês que não esteja nos dados.
 const latestAvaliacaoId=model?.avaliacoes?.[model.avaliacoes.length-1]?.id||null;
 const refLabel=useMemo(()=>{if(!model)return null;const cols=matrixPeriodColumns(allRecords,model.avaliacoes);return cols.length?cols[cols.length-1]:null;},[model,allRecords]);
 const refNome=useMemo(()=>{
  const lab=refLabel;if(!lab)return null;
  const up=String(lab).toUpperCase();
  const mes=up.match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\b/);
  const ano=up.match(/(20\d{2})/);
  if(mes&&ano){const nome=MESES_NOME[mes[1]];return `${nome.charAt(0).toUpperCase()+nome.slice(1)} de ${ano[1]}`;}
  return String(lab);
 },[refLabel]);
 // Último período da seleção = registros da seleção pertencentes à
 // avaliação mais recente (sem simular histórico não armazenado).
 const visibleLatest=useMemo(()=>latestAvaliacaoId?visible.filter(r=>r.avaliacaoId===latestAvaliacaoId):visible,[visible,latestAvaliacaoId]);

 // Seleção da planilha: validação + análise LOCAIS (nada vai ao banco nem ao
 // Storage nesta etapa). O hash é calculado apenas para reconhecer, já na
 // prévia, um arquivo binariamente idêntico a um já importado (consulta de
 // leitura). A gravação só acontece depois de "Confirmar atualização".
 async function upload(e){
  const file=e.target.files?.[0];if(!file)return;
  try{
   const validation=validateSpreadsheetFile(file);
   if(!validation.ok)throw new Error(validation.errors.join(' '));
   const buffer=await file.arrayBuffer();
   const analysis=analyzeWorkbookBuffer(buffer,file.name);
   analysis.__buffer=buffer;
   let arquivosIguais=[];
   try{const hash=await computeSha256(buffer);arquivosIguais=await findAvaliacoesByHash(hash);}
   catch(err){console.warn('[avaliacao-diretores] Verificação de arquivo idêntico indisponível:',err?.message||String(err));}
   setPendingImport({file,analysis,arquivosIguais});
  }catch(err){setMessage(`Erro: ${humanError(err.message)}`)}
  finally{e.target.value=''}
 }
 async function finishImport(result){setPendingImport(null);setMessage('Salvando avaliação…');await reload();setMessage(`Atualização concluída com sucesso: “${result.titulo}” (${result.trimestre}º tri/${result.ano}) · arquivo ${result.arquivoNome} · ${result.totalRegistros} registros.`);}
  const title=director?'Perfil do diretor':regional?'Desempenho da regional':'Desempenho geral';
  const subtitle=director||regional||'Todas as avaliações, lado a lado';
  // Cores do SUBCARD de resumo (fundo, borda e etiqueta) resolvidas por UMA
  // única configuração — mudam automaticamente ao confirmar a edição do Status.
  const evPaleta=evResumo?PALETAS_STATUS[paletaStatus(evResumo.status)]:null;
  const evEstilo=evPaleta?{'--ev-fundo':evPaleta.fundo,'--ev-borda':evPaleta.borda,'--ev-etq':evPaleta.etiqueta,'--ev-etq-texto':evPaleta.etiquetaTexto}:null;
 // Selo “1 avaliação disponível” / “X avaliações disponíveis” REMOVIDO do
 // cabeçalho (remoção somente visual: nenhuma avaliação apagada, nenhuma
 // consulta alterada). O espaço liberado abriga a nova área de pareceres,
 // logo abaixo da identificação do diretor e antes dos cards.
 return <div className="app">
  <aside className="sidebar"><div className="brand"><img className="brand-logo" src="/assets/logo-diretores.png" alt="SER Educacional — logo da Avaliação de Diretores"/><span className="brand-title">Avaliação de Diretores</span></div><div className="sub">Avaliação de desempenho dos diretores</div>
   <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={upload}/><button className="upload" onClick={()=>fileRef.current.click()}><span>↑</span> Atualizar pela planilha</button>
   <label>Regional</label><select value={regional} onChange={e=>{setRegional(e.target.value);setDirector('')}} disabled={!model}><option value="">Todas as regionais</option>{regionals.map(x=><option key={x}>{x}</option>)}</select>
   <label>Diretor</label><select value={director} onChange={e=>setDirector(e.target.value)} disabled={!regional}><option value="">Todos os diretores</option>{directors.map(x=><option key={x}>{x}</option>)}</select>
   <div className="profile"><b>{director||regional||'Todas as regionais'}</b><span>{visible.length} registro(s) · {countDistinctNames(visible,'diretor')} diretor(es) · {visibleAvaliacaoIds.length} avaliação(ões)</span></div>
   {message&&<div className="message">{message}</div>}
  </aside>
  <ErrorBoundary>
  <main><header><div><small>Avaliação colegiada de performance</small><h1>{title}</h1><p>{subtitle}</p></div></header>
   {loading&&<section className="empty-state"><h2>Carregando avaliações…</h2><p>Aguarde um instante.</p></section>}
   {!loading&&loadError&&<section className="empty-state"><h2>Não foi possível carregar as avaliações</h2><p>Tente novamente em instantes.</p><button className="save" onClick={reload}>Tentar novamente</button></section>}
   {!loading&&!loadError&&model&&model.avaliacoes.length===0&&<section className="empty-state"><h2>Nenhuma avaliação disponível ainda</h2><p>Use “Atualizar pela planilha” para importar um arquivo. As avaliações importadas ficam disponíveis automaticamente e permanecem após recarregar a página.</p></section>}
   {!loading&&!loadError&&model&&model.avaliacoes.length>0&&<>
     <Pareceres regional={regional} diretor={director} registros={model.registros} avaliacoes={model.avaliacoes}/>
     <section className="kpis">{[['Diretores',countDistinctNames(visible,'diretor')],['Unidades',countDistinctNames(visible,'unidade')],['Nota geral',fmt(avg(visible.map(r=>recordMetric(r,'Nota geral'))))],['Avaliações',visibleAvaliacaoIds.length]].map(([a,b])=><article key={a}><span>{a}</span><strong>{b}</strong></article>)}</section>
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
         const vUlt=avg(visibleLatest.map(r=>recordMetric(r,n)));
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
      {evolution&&<section className="card evolution-card"><div className="ev-topo"><div className="ev-textos"><h2>Evolução mensal do nível de desenvolvimento</h2><p className="ev-sub">Progressão do diretor entre os níveis I e V ao longo dos meses avaliados.</p></div>{evResumo&&<div className="ev-resumo" style={evEstilo}><div className="ev-linha"><b>Período:</b> <span className="ev-valor">{evResumo.periodo||'Não informado'}</span></div><div className="ev-linha ev-linha-status"><b>Status:</b> <span className="ev-badge">{evResumo.status||'Não informado'}</span></div><div className="ev-linha"><b>Nível:</b> <span className="ev-nivel">{evResumo.nivel||'Não informado'}</span></div>{evResumo.ajustado&&<div className="ev-ajuste">Atualizado no sistema</div>}{evResumo.periodoId&&<button type="button" className="ev-editar" onClick={()=>{setEditorSucesso('');setEditorAberto(true);}}>Editar</button>}{editorSucesso&&<div className="ev-sucesso" role="status">{editorSucesso}</div>}</div>}</div><ErrorBoundary titulo="Não foi possível desenhar o gráfico de evolução"><div className="chart"><MonthlyEvolutionChart periods={evolution.periods} series={evolution.series}/></div></ErrorBoundary><div className="legend"><i className="sel"/>Período mensal<i className="quarter"/>Fechamento trimestral</div></section>}
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
 </div>
}
