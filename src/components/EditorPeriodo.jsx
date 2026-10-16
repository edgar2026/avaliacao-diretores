import { useMemo, useState } from 'react';
import { NIVEL_OPCOES, salvarAjuste, validarNivel } from '../services/ajustesService.js';

/**
 * Formulário compacto de edição do Status (estágio) e do Nível do ÚLTIMO
 * PERÍODO VÁLIDO do diretor selecionado. O período NUNCA é escolhido nem
 * alterado: aparece somente para leitura (o único editável é o último válido;
 * quando um novo mês entrar na base, ele passará a ser esse período). Não
 * solicita justificativa nem observação. Não toca em períodos anteriores,
 * pareceres, indicadores, filtros, upload nem identidade visual.
 */
export default function EditorPeriodo({ resumo, opcoesStatus, onSalvo, onFechar }){
  const [status, setStatus] = useState(resumo?.status || '');
  const [nivel, setNivel] = useState(resumo?.nivel || '');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  // Segurança: se o valor vigente não estiver na lista (ex.: status vindo de
  // um ajuste antigo), ele entra como opção — nunca um select em branco.
  const statusOps = useMemo(() => {
    const l = (opcoesStatus || []).slice();
    const atual = String(status ?? '').trim();
    if(atual && !l.includes(atual)) l.unshift(atual);
    return l;
  }, [opcoesStatus, status]);

  async function salvar(){
    if(ocupado) return;
    setErro('');
    try{
      validarNivel(nivel);
      setOcupado(true);
      // Aguarda a confirmação REAL do banco antes de fechar: só aí o resumo,
      // o último ponto do gráfico e a matriz são atualizados.
      const ajuste = await salvarAjuste({
        avaliacaoId: resumo?.avaliacaoId,
        registroId: resumo?.registroId,
        periodoId: resumo?.periodoId,
        statusAjustado: status,
        nivelAjustado: nivel,
        opcoes: statusOps
      });
      onSalvo?.(ajuste);
    } catch(e){
      // Erro: formulário continua aberto com as escolhas do usuário e a
      // mensagem clara abaixo dos campos (o gráfico só muda após o banco).
      setErro(e?.message || String(e));
      setOcupado(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget&&!ocupado)onFechar?.();}}>
    <div className="modal-card editor-periodo" role="dialog" aria-modal="true" aria-labelledby="editor-periodo-titulo">
      <h2 id="editor-periodo-titulo">Editar período do diretor</h2>
      <p className="modal-file">Apenas o último período válido do diretor pode ser editado.</p>
      <div className="meta-form">
        <label>Período
          <input type="text" value={resumo?.periodo||''} readOnly disabled/>
        </label>
        <div className="meta-row">
          <label>Status
            <select value={status} onChange={(e)=>setStatus(e.target.value)} disabled={ocupado} autoFocus>
              <option value="" disabled>Selecione…</option>
              {statusOps.map((s)=><option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>Nível
            <select value={nivel} onChange={(e)=>setNivel(e.target.value)} disabled={ocupado}>
              <option value="" disabled>Selecione…</option>
              {NIVEL_OPCOES.map((o)=><option key={o.valor} value={o.valor}>{o.valor}</option>)}
            </select>
          </label>
        </div>
      </div>
      {erro&&<p className="error" role="alert">{erro}</p>}
      <div className="modal-actions">
        <button onClick={onFechar} disabled={ocupado}>Cancelar</button>
        <button className="primary" onClick={salvar} disabled={ocupado}>{ocupado?'Salvando…':'Salvar'}</button>
      </div>
    </div>
  </div>;
}
