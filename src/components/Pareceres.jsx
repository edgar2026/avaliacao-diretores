import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {avaliacaoLabel} from '../services/dashboardService.js';
import {resolveObservacaoVinculo,formatarDataHora} from '../services/observacoesService.js';
import {
  TIPOS_PARECER,
  TIPO_LABEL,
  listPareceres,
  createParecer,
  updateParecer,
  archiveParecer,
  parecerMaisRecente,
  parecerEditado
} from '../services/pareceresService.js';
import ConfirmModal from './ConfirmModal.jsx';

// Sem nomes técnicos na tela (mesma tradução do resto do app).
const mensagemErro=(m)=>String(m||'')
 .replace(/VITE_SUPABASE_[A-Z_]+|SUPABASE_[A-Z_]+/gi,'a configuração')
 .replace(/\bSupabase\b/gi,'sistema de dados')
 .replace(/\bRLS\b/g,'as regras de acesso');

// Texto do parecer no card: no máximo SEIS linhas visíveis; quando o
// conteúdo ultrapassa aparece "Ver parecer completo" (nada é cortado
// permanentemente — o texto completo continua no banco e no histórico).
function ParecerTexto({ texto }){
  const ref=useRef(null);
  const [aberto,setAberto]=useState(false);
  const [truncado,setTruncado]=useState(false);
  useEffect(()=>{setAberto(false);},[texto]);
  useLayoutEffect(()=>{
    const el=ref.current;
    if(!el||aberto){setTruncado(false);return;}
    setTruncado(el.scrollHeight-el.clientHeight>2);
  },[texto,aberto]);
  if(!texto)return null;
  return <>
    <p ref={ref} className={`parecer-texto${aberto?' aberto':' limitado'}`}>{texto}</p>
    {(truncado||aberto)&&<button type="button" className="parecer-btn link" onClick={()=>setAberto(v=>!v)}>{aberto?'Mostrar menos':'Ver parecer completo'}</button>}
  </>;
}

// Textos dos cards: o PRIMEIRO card ('regional') é exibido como
// "JUSTIFICATIVA" (tipo interno no banco permanece 'regional' — mudança
// somente visual/textual, sem migration); o SEGUNDO card ('operacoes')
// permanece exatamente com os textos de "Parecer de Operações".
const TEXTOS = {
  regional: {
    vazio: 'Nenhuma justificativa registrada.',
    adicionar: 'Adicionar justificativa',
    novo: 'Nova justificativa',
    editarTitulo: 'Editar justificativa',
    excluirTitulo: 'Excluir justificativa',
    excluirMensagem: 'Excluir esta justificativa? Ela deixa de aparecer na tela e a justificativa anterior volta automaticamente.',
    historicoTitulo: 'Histórico da justificativa',
    sucessoNovo: 'Justificativa adicionada com sucesso.',
    sucessoEdicao: 'Justificativa atualizada com sucesso.',
    sucessoExclusao: 'Justificativa excluída com sucesso.'
  },
  operacoes: {
    vazio: 'Nenhum parecer registrado.',
    adicionar: 'Adicionar parecer',
    novo: 'Novo parecer',
    editarTitulo: 'Editar parecer',
    excluirTitulo: 'Excluir parecer',
    excluirMensagem: 'Excluir este parecer? Ele deixa de aparecer na tela e o parecer anterior volta automaticamente.',
    historicoTitulo: 'Histórico — Parecer de Operações',
    sucessoNovo: '',
    sucessoEdicao: '',
    sucessoExclusao: ''
  }
};

/**
 * Área de PARECERES (topo da área principal, abaixo da identificação do
 * diretor e antes dos cards/indicadores). Dois cards sempre juntos, sem abas
 * e sem clique: JUSTIFICATIVA (tipo interno 'regional') + Parecer de
 * Operações. Com diretor selecionado os dois registros mais recentes ATIVOS
 * carregam automaticamente; sem diretor aparece apenas uma mensagem discreta
 * (nenhum card vazio).
 * Um diretor pode ter vários registros de cada tipo: o card mostra apenas o
 * mais recente ATIVO e o Histórico guarda todos os ATIVOS. Registros
 * excluídos logicamente (arquivada_em preenchido) nunca aparecem no card nem
 * no histórico — continuam no banco apenas para auditoria; ao excluir o mais
 * recente, o ativo anterior volta automaticamente.
 */
export default function Pareceres({ regional, diretor, registros, avaliacoes }){
  const [dados,setDados]=useState({regional:[],operacoes:[]});
  const [carregando,setCarregando]=useState(false);
  const [erro,setErro]=useState('');
  const [editor,setEditor]=useState(null);
  const [editorErro,setEditorErro]=useState('');
  const [historico,setHistorico]=useState(null);
  const [confirmacao,setConfirmacao]=useState(null);
  const [confirmErro,setConfirmErro]=useState('');
  const [ocupado,setOcupado]=useState(false);
  const [sucesso,setSucesso]=useState({regional:'',operacoes:''});
  const [recarga,setRecarga]=useState(0);
  const reqRef=useRef(0);
  const histRef=useRef(0);

  const ativo=Boolean(regional&&diretor);

  // Mesmo vínculo das observações: avaliação mais recente em que o diretor
  // tem registro + registro_id (prioridade de vínculo no momento de criar).
  const vinculo=useMemo(()=>!ativo?null:resolveObservacaoVinculo(registros||[],avaliacoes||[],{regional,diretor}),[ativo,registros,avaliacoes,regional,diretor]);

  const avaliacaoPorId=useMemo(()=>{
    const mapa=new Map();
    for(const a of (avaliacoes||[])) if(a?.id) mapa.set(a.id,a);
    return mapa;
  },[avaliacoes]);
  const avaliacaoDe=(id)=>{const a=avaliacaoPorId.get(id);return a?avaliacaoLabel(a):'—';};
  const tituloDe=(id)=>avaliacaoPorId.get(id)?.titulo||'';

  // Carregamento automático dos DOIS tipos. A troca de regional/diretor limpa
  // os pareceres anteriores na hora e um token descarta respostas atrasadas
  // (a resposta de um diretor anterior nunca sobrescreve a tela atual).
  useEffect(()=>{
    const reqId=++reqRef.current;
    histRef.current++;
    setDados({regional:[],operacoes:[]});
    setErro('');
    setEditor(null);setEditorErro('');setHistorico(null);setConfirmacao(null);setConfirmErro('');
    setSucesso({regional:'',operacoes:''});
    if(!ativo){setCarregando(false);return;}
    setCarregando(true);
    (async()=>{
      try{
        const listas=await Promise.all(TIPOS_PARECER.map((tipo)=>listPareceres({tipo,regional,diretor,registros})));
        if(reqId!==reqRef.current)return;
        setDados({regional:listas[0]||[],operacoes:listas[1]||[]});
        setErro('');
      }catch(e){
        if(reqId!==reqRef.current)return;
        setDados({regional:[],operacoes:[]});
        setErro(mensagemErro(e?.message));
      }finally{
        if(reqId===reqRef.current)setCarregando(false);
      }
    })();
  },[ativo,regional,diretor,registros,avaliacoes,recarga]);

  // Esc fecha o editor e o histórico (o modal de confirmação já trata o seu).
  useEffect(()=>{
    if(!editor&&!historico)return;
    const aoTeclar=(e)=>{if(e.key==='Escape'&&!ocupado){setEditor(null);setHistorico(null);}};
    window.addEventListener('keydown',aoTeclar);
    return ()=>window.removeEventListener('keydown',aoTeclar);
  },[editor,historico,ocupado]);

  // Sucesso (apenas o primeiro card — "justificativa") some sozinho.
  useEffect(()=>{
    if(!sucesso.regional)return;
    const t=setTimeout(()=>setSucesso((s)=>({...s,regional:''})),6000);
    return ()=>clearTimeout(t);
  },[sucesso.regional]);

  function abrirNovo(tipo){
    if(ocupado)return;
    setEditorErro('');
    setEditor({tipo,modo:'novo',texto:''});
  }
  function abrirEdicao(tipo,parecer){
    if(ocupado)return;
    setEditorErro('');
    setEditor({tipo,modo:'editar',id:parecer.id,avaliacaoId:parecer.avaliacao_id,texto:parecer.observacao||'',regional:parecer.regional||''});
  }
  function fecharEditor(){if(!ocupado)setEditor(null);setEditorErro('');}

  // NOVO: cria mais um registro (o anterior fica no histórico e este passa a
  // ser o mais recente). EDITAR: muda somente o texto do parecer selecionado.
  async function salvarEditor(){
    if(!editor||ocupado)return;
    const texto=(editor.texto||'').trim();
    if(!texto){setEditorErro('O texto do parecer não pode ficar vazio.');return;}
    setOcupado(true);setEditorErro('');
    try{
      if(editor.modo==='novo'){
        if(!vinculo?.avaliacaoId)throw new Error('Não foi possível identificar a avaliação do diretor selecionado.');
        await createParecer({avaliacaoId:vinculo.avaliacaoId,registroId:vinculo.registroId||null,regional,diretor,tipo:editor.tipo,texto});
      }else{
        await updateParecer({id:editor.id,texto});
      }
      setSucesso((s)=>({...s,[editor.tipo]:editor.modo==='novo'?TEXTOS[editor.tipo].sucessoNovo:TEXTOS[editor.tipo].sucessoEdicao}));
      setEditor(null);setEditorErro('');
      setRecarga((n)=>n+1);
    }catch(e){setEditorErro(mensagemErro(e?.message));}
    finally{setOcupado(false);}
  }

  // EXCLUIR: confirmação + exclusão lógica (arquivada_em). O registro excluído
  // some da interface imediatamente (recarga com arquivada_em IS NULL) e, ao
  // excluir o mais recente, o ativo anterior volta automaticamente.
  function pedirExclusao(tipo,parecer){
    if(ocupado)return;
    setConfirmErro('');
    const corpo=(parecer.observacao||'').trim();
    setConfirmacao({
      tipo,
      parecer,
      mensagem:TEXTOS[tipo].excluirMensagem,
      detalhe:[TIPO_LABEL[tipo],regional,diretor].filter(Boolean).join(' · ')+(corpo?`\n“${corpo.length>180?corpo.slice(0,180)+'…':corpo}”`:'')
    });
  }
  async function executarExclusao(){
    if(!confirmacao||ocupado)return;
    setOcupado(true);setConfirmErro('');
    try{
      await archiveParecer(confirmacao.parecer.id);
      setSucesso((s)=>({...s,[confirmacao.tipo]:TEXTOS[confirmacao.tipo].sucessoExclusao}));
      setConfirmacao(null);
      setRecarga((n)=>n+1);
    }catch(e){setConfirmErro(mensagemErro(e?.message));}
    finally{setOcupado(false);}
  }
  function fecharConfirmacao(){if(!ocupado)setConfirmacao(null);}

  // HISTÓRICO: painel separado por tipo, do mais recente para o mais antigo,
  // somente registros ATIVOS (arquivada_em IS NULL — excluídos nunca aparecem).
  async function abrirHistorico(tipo){
    const token=++histRef.current;
    setHistorico({tipo,linhas:[],carregando:true,erro:''});
    try{
      const linhas=await listPareceres({tipo,regional,diretor,registros});
      if(token!==histRef.current)return;
      setHistorico((h)=>(h&&h.tipo===tipo?{...h,linhas,carregando:false}:h));
    }catch(e){
      if(token!==histRef.current)return;
      setHistorico((h)=>(h&&h.tipo===tipo?{...h,carregando:false,erro:mensagemErro(e?.message)}:h));
    }
  }
  function fecharHistorico(){if(!ocupado){histRef.current++;setHistorico(null);}}

  if(!regional){
    return <p className="parecer-selecao">Selecione uma regional para registrar este conteúdo.</p>;
  }
  if(!diretor){
    return <p className="parecer-selecao">Selecione um diretor para registrar este conteúdo.</p>;
  }

  // Regional RESPONSÁVEL pelo registro (salva no próprio registro na criação;
  // nunca é substituída pelo filtro atual). Sem regional salva → "Não informado".
  const registradoPor=(p)=>`Registrado por: ${((p?.regional||'').trim())||'Não informado'}`;

  return <section className="pareceres" aria-label="Pareceres do diretor">
    {TIPOS_PARECER.map((tipo)=>{
      const lista=dados[tipo]||[];
      const atual=parecerMaisRecente(lista);
      const txt=TEXTOS[tipo];
      return <article className="parecer-card" key={tipo}>
        <div className="parecer-head">
          <h2>{TIPO_LABEL[tipo]}</h2>
          {atual&&<span className="parecer-chip">mais recente</span>}
        </div>
        {erro&&<>
          <p className="parecer-erro">{erro}</p>
          <div className="parecer-acoes"><button className="parecer-btn" onClick={()=>setRecarga((n)=>n+1)}>Tentar novamente</button></div>
        </>}
        {!erro&&carregando&&<p className="parecer-status">Carregando pareceres…</p>}
        {!erro&&!carregando&&atual&&<>
          <div className="parecer-meta">
            <span>Avaliação: {avaliacaoDe(atual.avaliacao_id)}</span>
            <span>{registradoPor(atual)}</span>
            <span>Criado em {formatarDataHora(atual.created_at)}</span>
            {parecerEditado(atual)&&<span>Atualizado em {formatarDataHora(atual.updated_at)}</span>}
          </div>
          <ParecerTexto texto={atual.observacao}/>
          <div className="parecer-acoes">
            <button className="parecer-btn primario" onClick={()=>abrirNovo(tipo)} disabled={ocupado}>{txt.novo}</button>
            <button className="parecer-btn" onClick={()=>abrirEdicao(tipo,atual)} disabled={ocupado}>Editar</button>
            <button className="parecer-btn danger" onClick={()=>pedirExclusao(tipo,atual)} disabled={ocupado}>Excluir</button>
            <button className="parecer-btn" onClick={()=>abrirHistorico(tipo)} disabled={ocupado}>Histórico{lista.length>1?` (${lista.length})`:''}</button>
          </div>
        </>}
        {!erro&&!carregando&&!atual&&<>
          <p className="parecer-vazio">{txt.vazio}</p>
          <div className="parecer-acoes">
            <button className="parecer-btn primario" onClick={()=>abrirNovo(tipo)} disabled={ocupado}>{txt.adicionar}</button>
            <button className="parecer-btn" onClick={()=>abrirHistorico(tipo)} disabled={ocupado}>Histórico</button>
          </div>
        </>}
        {sucesso[tipo]&&<p className="ev-sucesso" role="status">{sucesso[tipo]}</p>}
      </article>;
    })}

    {editor&&<div className="modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)fecharEditor();}}>
      <div className="modal-card parecer-editor" role="dialog" aria-modal="true" aria-labelledby="parecer-editor-titulo">
        <h2 id="parecer-editor-titulo">{editor.modo==='novo'?TEXTOS[editor.tipo].novo:TEXTOS[editor.tipo].editarTitulo}</h2>
        <p className="modal-file">{TIPO_LABEL[editor.tipo]} · {editor.modo==='editar'?registradoPor({regional:editor.regional}):`Registrado por: ${regional}`} · {diretor}{editor.modo==='editar'?` · ${avaliacaoDe(editor.avaliacaoId)}`:''}</p>
        <h3>Texto do parecer</h3>
        <textarea className="parecer-area" value={editor.texto} onChange={(e)=>setEditor({...editor,texto:e.target.value})} placeholder="Escreva o parecer..." disabled={ocupado} autoFocus/>
        {editorErro&&<p className="error" role="alert">{editorErro}</p>}
        <div className="modal-actions">
          <button onClick={fecharEditor} disabled={ocupado}>Cancelar</button>
          <button className="primary" onClick={salvarEditor} disabled={ocupado}>{ocupado?'Salvando…':'Salvar'}</button>
        </div>
      </div>
    </div>}

    {historico&&<div className="modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)fecharHistorico();}}>
      <div className="modal-card parecer-historico" role="dialog" aria-modal="true" aria-labelledby="parecer-historico-titulo">
        <h2 id="parecer-historico-titulo">{TEXTOS[historico.tipo].historicoTitulo}</h2>
        <p className="modal-file">{regional} · {diretor}</p>
        {historico.carregando&&<p className="parecer-status">Carregando histórico…</p>}
        {!historico.carregando&&historico.erro&&<p className="error" role="alert">{historico.erro}</p>}
        {!historico.carregando&&!historico.erro&&historico.linhas.length===0&&<p className="parecer-vazio">{TEXTOS[historico.tipo].vazio}</p>}
        {!historico.carregando&&!historico.erro&&historico.linhas.length>0&&<div className="hist-lista">
          {historico.linhas.map((p)=>(
            <div className="hist-item" key={p.id}>
              <div className="hist-meta">
                <span className="hist-avaliacao">{avaliacaoDe(p.avaliacao_id)}{tituloDe(p.avaliacao_id)?` · ${tituloDe(p.avaliacao_id)}`:''}</span>
                <span>{registradoPor(p)}</span>
                <span>Criado em {formatarDataHora(p.created_at)}</span>
                {parecerEditado(p)&&<span>Atualizado em {formatarDataHora(p.updated_at)}</span>}
              </div>
              <p>{p.observacao}</p>
            </div>
          ))}
        </div>}
        <div className="modal-actions"><button className="primary" onClick={fecharHistorico} disabled={ocupado}>Fechar</button></div>
      </div>
    </div>}

    <ConfirmModal
      aberto={!!confirmacao}
      titulo={confirmacao?TEXTOS[confirmacao.tipo].excluirTitulo:'Excluir parecer'}
      mensagem={confirmacao?.mensagem||''}
      detalhe={confirmacao?.detalhe}
      textoConfirmar="Excluir"
      perigo
      ocupado={ocupado}
      erro={confirmErro}
      onConfirm={executarExclusao}
      onCancel={fecharConfirmacao}
    />
  </section>;
}
