import React,{ useState } from 'react';
import { formatBytes } from '../services/fileValidator.js';
import { runImport, ImportError, STAGES, STAGE_LABELS } from '../services/importService.js';

const STAGE_ORDER = [STAGES.VALIDANDO, STAGES.ENVIANDO, STAGES.SALVANDO, STAGES.CONCLUIDO];

// Exibição amigável de erros na interface (mesma regra do App).
const humanError=m=>String(m||'').replace(/aba chamada Planilha1/gi,'aba principal da planilha').replace(/Planilha1/gi,'planilha').replace(/VITE_SUPABASE_[A-Z_]+|SUPABASE_[A-Z_]+/gi,'a configuração').replace(/\bSupabase\b/gi,'sistema de dados').replace(/Storage/g,'o envio do arquivo').replace(/\bRLS\b/g,'as regras de acesso');

function inferMeta(fileName = ''){
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  const tri = String(fileName).match(/(\d)\s*TRI/i);
  const year = String(fileName).match(/(20\d{2})/);
  return {
    trimestre: tri ? Number(tri[1]) : quarter,
    ano: year ? Number(year[1]) : now.getFullYear()
  };
}

export default function ImportDialog({ file, analysis, onCancel, onImported }){
  const inferred = inferMeta(file?.name);
  const [titulo,setTitulo] = useState(String(file?.name || '').replace(/\.[^.]+$/,''));
  const [trimestre,setTrimestre] = useState(inferred.trimestre);
  const [ano,setAno] = useState(inferred.ano);
  const [stage,setStage] = useState(null);
  const [error,setError] = useState(null);
  const [result,setResult] = useState(null);
  const busy = stage !== null && stage !== STAGES.CONCLUIDO && !error;

  async function confirm(){
    if(busy) return;
    setError(null); setResult(null); setStage(STAGES.VALIDANDO);
    try{
      const report = await runImport({
        file,
        data: analysis.__buffer,
        analysis,
        meta: { titulo, trimestre: Number(trimestre), ano: Number(ano) },
        onProgress: setStage
      });
      setResult(report);
    }catch(err){
      setError(err instanceof ImportError ? err : new Error(err.message));
      setStage(null);
    }
  }

  if(result){
    return <div className="modal-backdrop"><div className="modal-card">
      <h2>Importação concluída</h2>
      <div className="preview-grid">
        <div><span>Avaliação</span><b>{result.titulo}</b></div>
        <div><span>Período</span><b>{result.trimestre}º trimestre / {result.ano}</b></div>
        <div><span>Registros</span><b>{result.totalRegistros}</b></div>
        <div><span>Períodos salvos</span><b>{result.totalPeriodos}</b></div>
        <div><span>Indicadores salvos</span><b>{result.totalIndicadores}</b></div>
        <div><span>Arquivo</span><b title={result.arquivoNome}>{result.arquivoNome}</b></div>
      </div>
      {result.duplicateInOtherPeriod?.length > 0 &&
        <p className="warn">Atenção: este mesmo arquivo já existe em outro período ({result.duplicateInOtherPeriod.map(d=>`${d.trimestre}/${d.ano}`).join(', ')}). As avaliações anteriores permanecem intactas.</p>}
      <div className="modal-actions"><button className="primary" onClick={()=>onImported(result)}>Fechar</button></div>
    </div></div>;
  }

  return <div className="modal-backdrop" onMouseDown={e=>{ if(e.target===e.currentTarget && !busy) onCancel(); }}>
    <div className="modal-card">
      <h2>Importar planilha</h2>
      <p className="modal-file" title={file?.name}>{file?.name} · {formatBytes(file?.size || 0)}</p>

      <section className="preview">
        <h3>Prévia da importação</h3>
        <div className="preview-grid">
          <div><span>Linhas de dados</span><b>{analysis.dataRowCount}</b></div>
          <div><span>Colunas</span><b>{analysis.columnCount}</b></div>
          <div><span>Períodos identificados</span><b>{analysis.periodLabels.length}</b></div>
          <div><span>Regionais</span><b>{analysis.regionals.length}</b></div>
          <div><span>Diretores</span><b>{analysis.directors.length}</b></div>
          <div><span>Unidades</span><b>{analysis.units.length}</b></div>
          <div><span>Registros que serão salvos</span><b>{analysis.records.length}</b></div>
          <div><span>Indicadores detectados</span><b>{analysis.indicatorColumns.length}</b></div>
          <div><span>Linhas sem diretor</span><b className={analysis.rowsWithoutDirector?'warn':''}>{analysis.rowsWithoutDirector}</b></div>
          <div><span>Possíveis duplicidades</span><b className={analysis.duplicates.length?'warn':''}>{analysis.duplicates.length}</b></div>
        </div>

        <div className="chips">
          <span className="chips-label">Períodos:</span>
          {analysis.periodLabels.map(p => <i key={p}>{p}</i>)}
        </div>

        {analysis.missingRequired.length > 0 && <p className="error">Campos obrigatórios ausentes: {analysis.missingRequired.map(f=>f.label).join(', ')}.</p>}
        {analysis.missingOptional.length > 0 && <p className="warn">Campos opcionais ausentes: {analysis.missingOptional.map(f=>f.label).join(', ')}.</p>}
        {analysis.duplicates.length > 0 && <p className="warn">{analysis.duplicates.length} combinação(ões) regional/diretor/unidade repetida(s) na planilha (ex.: {analysis.duplicates[0].diretor} — {analysis.duplicates[0].unidade}).</p>}
        {analysis.sheetNames?.length > 1 && <p className="info">Ignorando outras abas: {analysis.sheetNames.filter(n=>n!=='Planilha1').join(', ')}.</p>}
      </section>

      <section className="meta-form">
        <h3>Dados da avaliação</h3>
        <label>Título
          <input value={titulo} onChange={e=>setTitulo(e.target.value)} placeholder="Ex.: 3º trimestre 2026 — status diretores"/>
        </label>
        <div className="meta-row">
          <label>Trimestre
            <select value={trimestre} onChange={e=>setTrimestre(e.target.value)}>
              {[1,2,3,4].map(t=><option key={t} value={t}>{t}º tri</option>)}
            </select>
          </label>
          <label>Ano
            <input type="number" min="2000" max="2100" value={ano} onChange={e=>setAno(e.target.value)}/>
          </label>
        </div>
      </section>

      {stage && <section className="progress">
        {STAGE_ORDER.map(s => <div key={s} className={`step ${stage===s?'current':''} ${STAGE_ORDER.indexOf(stage)>STAGE_ORDER.indexOf(s)?'done':''}`}>{STAGE_LABELS[s]}</div>)}
      </section>}

      {error && <p className="error">{error.stage?`Falha em "${STAGE_LABELS[error.stage]||error.stage}": `:''}{humanError(error.message)}</p>}

      <div className="modal-actions">
        <button onClick={onCancel} disabled={busy}>Cancelar</button>
        <button className="primary" onClick={confirm} disabled={busy || !titulo.trim() || analysis.missingRequired.length>0}>
          {busy ? 'Importando…' : 'Importar'}
        </button>
      </div>
    </div>
  </div>;
}
