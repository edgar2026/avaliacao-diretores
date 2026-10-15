import React,{useEffect,useMemo,useRef,useState} from 'react';
import {analyzeWorkbookBuffer} from './dataParser.js';
import {validateSpreadsheetFile} from './services/fileValidator.js';
import {loadPublishedDashboard,buildDashboardModel,regionalsOf,directorsOf,buildDirectorMonthlyEvolution,avgNumbers,recordMetric,countDistinctNames,matrixPeriodColumns,avaliacaoLabel} from './services/dashboardService.js';
import {createObservacao,listObservacoesDiretor,updateObservacao,archiveObservacao,resolveObservacaoVinculo,formatarDataHora} from './services/observacoesService.js';
import {isSupabaseConfigured} from './services/supabaseClient.js';
import ImportDialog from './components/ImportDialog.jsx';
import ConfirmModal from './components/ConfirmModal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import PerformanceMatrix from './components/PerformanceMatrix.jsx';
import {MonthlyEvolutionChart,RadarChart} from './components/Charts.jsx';
const avg=a=>avgNumbers(a);
const fmt=(v,name='')=>v==null?'—':['Ritmo de captação','Crescimento de matrículas','Evasão','EBITDA'].includes(name)?`${(v*100).toLocaleString('pt-BR',{maximumFractionDigits:1,minimumFractionDigits:1})}%`:v.toLocaleString('pt-BR',{maximumFractionDigits:2,minimumFractionDigits:2});
const metrics=['Presencial','Acadêmico','Pós-graduação','Nota geral','Ritmo de captação','Crescimento de matrículas','Evasão','Avaliação institucional','EBITDA'];
const MESES_NOME={JAN:'janeiro',FEV:'fevereiro',MAR:'março',ABR:'abril',MAI:'maio',JUN:'junho',JUL:'julho',AGO:'agosto',SET:'setembro',OUT:'outubro',NOV:'novembro',DEZ:'dezembro'};
// Exibição amigável de erros na interface: nomes internos (aba do arquivo,
// serviços de dados, envio e regras de acesso) aparecem em linguagem simples.
const humanError=m=>String(m||'').replace(/aba chamada Planilha1/gi,'aba principal da planilha').replace(/Planilha1/gi,'planilha').replace(/VITE_SUPABASE_[A-Z_]+|SUPABASE_[A-Z_]+/gi,'a configuração').replace(/\bSupabase\b/gi,'sistema de dados').replace(/Storage/g,'o envio do arquivo').replace(/\bRLS\b/g,'as regras de acesso');

export default function App(){
 const [model,setModel]=useState(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),
  [regional,setRegional]=useState(''),[director,setDirector]=useState(''),
  [message,setMessage]=useState(''),[pendingImport,setPendingImport]=useState(null);
 const [obsList,setObsList]=useState([]),[obsText,setObsText]=useState(''),[obsSaving,setObsSaving]=useState(false),
  [obsLoading,setObsLoading]=useState(false),[editingId,setEditingId]=useState(null),[editText,setEditText]=useState(''),
  [showAllObs,setShowAllObs]=useState(false);
 // Modal de confirmação do app (no lugar do window.confirm do navegador):
 // usado para Salvar alterações (edição) e Excluir. Guarda a ação a executar.
 const [confirmacao,setConfirmacao]=useState(null),[confirmErro,setConfirmErro]=useState('');
 const [indConsolidado,setIndConsolidado]=useState(false);
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

 // Observação do regional: registro INDIVIDUAL vinculado ao diretor
 // selecionado (escopo 'diretor' + avaliação + registro). Sem regional e
 // diretor não há formulário nem lista. A troca de regional/diretor limpa a
 // lista na hora (nada do diretor anterior permanece na tela) e recarrega
 // pelo novo vínculo. Um token descarta respostas atrasadas: a resposta da
 // troca anterior nunca sobrescreve a lista do diretor atual.
 const obsReqRef=useRef(0);
 const obsVinculo=useMemo(()=>(!regional||!director)?null:resolveObservacaoVinculo(allRecords,model?.avaliacoes||[],{regional,diretor:director}),[model,allRecords,regional,director]);
 const obsDisponivel=Boolean(regional&&director);
 const avalObs=id=>{const a=(model?.avaliacoes||[]).find(x=>x.id===id);return a?avaliacaoLabel(a):'—';};
 async function loadObs(){
  const reqId=++obsReqRef.current;
  setObsList([]);
  if(!obsDisponivel)return;
  setObsLoading(true);
  try{
   const rows=await listObservacoesDiretor({registroId:obsVinculo?.registroId||null,avaliacaoId:obsVinculo?.avaliacaoId||null,regional,diretor:director});
   if(reqId!==obsReqRef.current)return;
   setObsList(rows);
  }catch(err){if(reqId!==obsReqRef.current)return;console.error('[avaliacao-diretores] Falha ao carregar observações:',err?.message||String(err));setObsList([]);}
  finally{if(reqId===obsReqRef.current)setObsLoading(false);}
 }
 useEffect(()=>{
  setEditingId(null);setEditText('');setShowAllObs(false);setObsText('');
  loadObs();
 },[regional,director,obsVinculo?.avaliacaoId]);

 async function saveObs(){
  if(obsSaving)return;
  const texto=obsText.trim();
  if(!regional){setMessage('Selecione uma regional e um diretor para registrar ou consultar observações.');return;}
  if(!director){setMessage('Selecione um diretor para registrar ou consultar observações.');return;}
  if(!texto){setMessage('A observação não pode ficar vazia.');return;}
  if(!obsVinculo?.avaliacaoId){setMessage('Erro: não foi possível identificar a avaliação do diretor selecionado.');return;}
  setObsSaving(true);setMessage('');
  try{
   await createObservacao({avaliacaoId:obsVinculo.avaliacaoId,registroId:obsVinculo.registroId||null,regional,diretor:director,observacao:texto});
   setObsText('');setMessage('Observação salva com sucesso.');await loadObs();
  }catch(err){setMessage(`Erro: ${humanError(err.message)}`);}
  finally{setObsSaving(false);}
 }
 // Editar: abre o modal de confirmação; a atualização (só texto, vínculo
 // preservado) só acontece após a confirmação.
 function pedirEdicao(){
  if(obsSaving)return;
  const texto=editText.trim();
  if(!texto){setMessage('A observação não pode ficar vazia.');return;}
  setMessage('');
  setConfirmErro('');
  setConfirmacao({
   perigo:false,titulo:'Salvar alterações',textoConfirmar:'Salvar',
   mensagem:'Confirmar as alterações nesta observação?',
   executar:async()=>{
    await updateObservacao({id:editingId,observacao:texto});
    setEditingId(null);setEditText('');setMessage('Observação atualizada com sucesso.');await loadObs();
   }
  });
 }
 // Excluir: abre o modal de confirmação (exclusão lógica após confirmar).
 function pedirExclusao(o){
  if(obsSaving)return;
  setMessage('');
  setConfirmErro('');
  setConfirmacao({
   perigo:true,titulo:'Excluir observação',textoConfirmar:'Excluir',
   mensagem:'Excluir esta observação do diretor? Ela deixará de aparecer na lista.',
   detalhe:[o?.diretor,o?.regional].filter(Boolean).join(' · ')+(o?.observacao?`\n“${o.observacao}”`:''),
   executar:async()=>{
    await archiveObservacao(o.id);
    setMessage('Observação excluída com sucesso.');await loadObs();
   }
  });
 }
 async function executarConfirmacao(){
  if(!confirmacao||obsSaving)return;
  setObsSaving(true);setConfirmErro('');
  try{await confirmacao.executar();setConfirmacao(null);}
  catch(err){setConfirmErro(`Erro: ${humanError(err.message)}`);}
  finally{setObsSaving(false);}
 }
 function fecharConfirmacao(){if(!obsSaving)setConfirmacao(null);}

 async function upload(e){const file=e.target.files?.[0];if(!file)return;try{const validation=validateSpreadsheetFile(file);if(!validation.ok)throw new Error(validation.errors.join(' '));const buffer=await file.arrayBuffer();const analysis=analyzeWorkbookBuffer(buffer,file.name);analysis.__buffer=buffer;setPendingImport({file,analysis})}catch(err){setMessage(`Erro: ${humanError(err.message)}`)}finally{e.target.value=''}}
 async function finishImport(result){setPendingImport(null);setMessage('Salvando avaliação…');await reload();setMessage(`Avaliação registrada: “${result.titulo}” (${result.trimestre}º tri/${result.ano}) · arquivo ${result.arquivoNome} · ${result.totalRegistros} registros.`);}
 const title=director?'Perfil do diretor':regional?'Desempenho da regional':'Desempenho geral';
 const subtitle=director||regional||'Todas as avaliações, lado a lado';
 const nAval=model?.avaliacoes.length||0;
 const badge=loading?'Carregando…':nAval===1?'1 avaliação disponível':`${nAval} avaliações disponíveis`;
 return <div className="app">
  <aside className="sidebar"><div className="brand"><img className="brand-logo" src="/assets/logo-diretores.png" alt="SER Educacional — logo da Avaliação de Diretores"/><span className="brand-title">Avaliação de Diretores</span></div><div className="sub">Avaliação de desempenho dos diretores</div>
   <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={upload}/><button className="upload" onClick={()=>fileRef.current.click()}><span>↑</span> Atualizar pela planilha</button>
   <label>Regional</label><select value={regional} onChange={e=>{setRegional(e.target.value);setDirector('')}} disabled={!model}><option value="">Todas as regionais</option>{regionals.map(x=><option key={x}>{x}</option>)}</select>
   <label>Diretor</label><select value={director} onChange={e=>setDirector(e.target.value)} disabled={!regional}><option value="">Todos os diretores</option>{directors.map(x=><option key={x}>{x}</option>)}</select>
   <div className="profile"><b>{director||regional||'Todas as regionais'}</b><span>{visible.length} registro(s) · {countDistinctNames(visible,'diretor')} diretor(es) · {visibleAvaliacaoIds.length} avaliação(ões)</span></div>
   <label>Observação do regional</label>
   <textarea id="note" value={obsText} onChange={e=>setObsText(e.target.value)} placeholder="Registre uma observação..." disabled={!obsDisponivel}/>
   {!regional&&<div className="obs-hint">Selecione uma regional e um diretor para registrar ou consultar observações.</div>}
   {regional&&!director&&<div className="obs-hint">Selecione um diretor para registrar ou consultar observações.</div>}
   <button className="save" onClick={saveObs} disabled={obsSaving||!obsDisponivel}>{obsSaving?'Salvando…':'Salvar observação'}</button>
   {message&&<div className="message">{message}</div>}
   {obsDisponivel&&<>
    <label>Observações do regional</label>
    {obsLoading&&<div className="obs-loading">Carregando observações…</div>}
    {!obsLoading&&obsList.length===0&&<div className="obs-empty">Nenhuma observação registrada.</div>}
    {!obsLoading&&obsList.length>0&&<div className="obs-list">
     {(showAllObs?obsList:obsList.slice(0,3)).map(o=>
      editingId===o.id?
       <div className="obs-item editing" key={o.id}>
        <textarea value={editText} onChange={e=>setEditText(e.target.value)}/>
        <div className="obs-actions">
         <button className="save" onClick={pedirEdicao} disabled={obsSaving}>Salvar alterações</button>
         <button className="obs-btn" onClick={()=>{setEditingId(null);setEditText('');}}>Cancelar</button>
        </div>
       </div>
      :
       <div className="obs-item" key={o.id}>
        <div className="obs-meta">
         <span className="obs-diretor">{o.diretor||'—'}</span>
         {o.regional&&<span className="obs-regional">{o.regional}</span>}
         <span className="obs-avaliacao">{avalObs(o.avaliacao_id)}</span>
         <span className="obs-data">{formatarDataHora(o.created_at)}</span>
        </div>
        <p>{o.observacao}</p>
        <div className="obs-actions">
         <button className="obs-btn" onClick={()=>{setEditingId(o.id);setEditText(o.observacao);}} disabled={obsSaving}>Editar</button>
          <button className="obs-btn danger" onClick={()=>pedirExclusao(o)} disabled={obsSaving}>Excluir</button>
        </div>
       </div>
     )}
     {obsList.length>3&&!showAllObs&&<button className="obs-btn" onClick={()=>setShowAllObs(true)}>Ver todas ({obsList.length})</button>}
     {showAllObs&&obsList.length>3&&<button className="obs-btn" onClick={()=>setShowAllObs(false)}>Mostrar menos</button>}
    </div>}
   </>}
  </aside>
  <ErrorBoundary>
  <main><header><div><small>Avaliação colegiada de performance</small><h1>{title}</h1><p>{subtitle}</p></div><span className="badge">{badge}</span></header>
   {loading&&<section className="empty-state"><h2>Carregando avaliações…</h2><p>Aguarde um instante.</p></section>}
   {!loading&&loadError&&<section className="empty-state"><h2>Não foi possível carregar as avaliações</h2><p>Tente novamente em instantes.</p><button className="save" onClick={reload}>Tentar novamente</button></section>}
   {!loading&&!loadError&&model&&model.avaliacoes.length===0&&<section className="empty-state"><h2>Nenhuma avaliação disponível ainda</h2><p>Use “Atualizar pela planilha” para importar um arquivo. As avaliações importadas ficam disponíveis automaticamente e permanecem após recarregar a página.</p></section>}
   {!loading&&!loadError&&model&&model.avaliacoes.length>0&&<>
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
        {evolution&&<section className="card evolution-card"><h2>Evolução mensal do nível de desenvolvimento</h2><p className="ev-sub">Progressão do diretor entre os níveis I e V ao longo dos meses avaliados.</p><p className="ev-note">Os níveis representam a classificação de desenvolvimento registrada na planilha e não correspondem às notas dos indicadores.</p><ErrorBoundary titulo="Não foi possível desenhar o gráfico de evolução"><div className="chart"><MonthlyEvolutionChart periods={evolution.periods} series={evolution.series}/></div></ErrorBoundary><div className="legend"><i className="sel"/>Período mensal<i className="quarter"/>Fechamento trimestral</div></section>}
     <section className="card radar-card"><h2>Comparação de desempenho</h2><p>Seleção atual versus média geral.</p><ErrorBoundary titulo="Não foi possível desenhar o gráfico de indicadores"><div className="chart"><RadarChart records={visible} allRecords={allRecords}/></div></ErrorBoundary><div className="legend center"><i className="sel"/>Seleção atual <i className="all"/>Média geral</div></section>
     <section className="card"><h2>Matriz histórica de desempenho</h2><p>Reprodução da planilha original: histórico por período, situação atual e indicadores.</p><PerformanceMatrix records={visible} allRecords={allRecords} avaliacoes={model.avaliacoes}/></section>
    </div>
   </>}
  <footer className="page-footer">Desenvolvido por V3LOZ</footer>
  </main>
  </ErrorBoundary>
  {pendingImport&&<ImportDialog file={pendingImport.file} analysis={pendingImport.analysis} onCancel={()=>setPendingImport(null)} onImported={finishImport}/>}
  <ConfirmModal aberto={!!confirmacao} titulo={confirmacao?.titulo||''} mensagem={confirmacao?.mensagem||''} detalhe={confirmacao?.detalhe} textoConfirmar={confirmacao?.textoConfirmar||'Confirmar'} perigo={!!confirmacao?.perigo} ocupado={obsSaving} erro={confirmErro} onConfirm={executarConfirmacao} onCancel={fecharConfirmacao}/>
 </div>
}
