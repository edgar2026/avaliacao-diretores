import React,{useEffect,useRef} from 'react';

// Modal de confirmação do app (substitui o window.confirm do navegador).
// Mesma linguagem visual do ImportDialog (.modal-backdrop/.modal-card), em
// versão compacta e centralizada: ícone, título, mensagem, detalhe opcional,
// erro exibido DENTRO do modal e ações Confirmar/Cancelar.
export default function ConfirmModal({ aberto, titulo, mensagem, detalhe, textoConfirmar='Confirmar', textoCancelar='Cancelar', perigo=false, ocupado=false, erro='', onConfirm, onCancel }){
 const cancelRef=useRef(null),confirmRef=useRef(null);
 useEffect(()=>{
  if(!aberto)return;
  const overflowAnterior=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const aoTeclar=e=>{if(e.key==='Escape'&&!ocupado)onCancel();};
  window.addEventListener('keydown',aoTeclar);
  return ()=>{document.body.style.overflow=overflowAnterior;window.removeEventListener('keydown',aoTeclar);};
 },[aberto,ocupado,onCancel]);
 useEffect(()=>{
  if(!aberto)return;
  (perigo?cancelRef:confirmRef).current?.focus();
 },[aberto,perigo]);
 if(!aberto)return null;
 return <div className="modal-backdrop confirm-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!ocupado)onCancel();}}>
  <div className="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-titulo" aria-describedby="confirm-texto">
   <span className={`confirm-icon${perigo?' perigo':''}`} aria-hidden="true">
    {perigo
     ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
     : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>}
   </span>
   <h2 id="confirm-titulo">{titulo}</h2>
   <p id="confirm-texto" className="confirm-texto">{mensagem}</p>
   {detalhe&&<p className="confirm-detalhe">{detalhe}</p>}
   {erro&&<p className="error confirm-erro" role="alert">{erro}</p>}
   <div className="modal-actions">
    <button ref={cancelRef} onClick={onCancel} disabled={ocupado}>{textoCancelar}</button>
    <button ref={confirmRef} className={perigo?'perigo':'primary'} onClick={onConfirm} disabled={ocupado}>{ocupado?'Aguarde…':textoConfirmar}</button>
   </div>
  </div>
 </div>;
}
