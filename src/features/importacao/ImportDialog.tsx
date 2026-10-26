import React,{ useMemo, useState } from 'react';
import { formatBytes } from '../../services/fileValidator.js';
import { runImport, ImportError, STAGES, STAGE_LABELS } from '../../services/importService.js';
import { buildUpdatePreview } from '../../services/previewService.js';
import ConfirmModal from '../../components/ConfirmModal.tsx';
import type { WorkbookAnalysis } from '../../types/planilha';
import type { DashboardModel } from '../../types/modelo';
import type { AvaliacaoHashInfo } from '../../services/avaliacoesService.js';

const STAGE_ORDER = [STAGES.ENVIANDO, STAGES.ATUALIZANDO_PERIODOS, STAGES.ATUALIZANDO_INDICADORES, STAGES.ATUALIZANDO_CADASTROS, STAGES.CONCLUIDO];

// Análise da planilha com o buffer binário anexado em App (usado pelo
// runImport no momento da confirmação — a prévia nunca envia arquivo).
export type AnalysisComBuffer = WorkbookAnalysis & { __buffer?: ArrayBuffer };

// Erro da importação: Error comum + estágio em que falhou (quando conhecido).
type ErroImport = Error & { stage?: string | null };

interface ImportDialogProps {
  file: File | null;
  analysis: AnalysisComBuffer;
  model: DashboardModel | null;
  arquivosIguais: AvaliacaoHashInfo[];
  onCancel: () => void;
  onImported: (result: RelatorioImportado) => void;
}

// Relatório devolvido pelo runImport (services/importService.js) — a tela de
// sucesso e o chamador (App) leem os mesmos campos.
export interface RelatorioImportado {
  titulo?: string;
  trimestre?: number | string;
  ano?: number | string;
  arquivoNome?: string;
  totalRegistros?: number;
  plano?: unknown;
  duplicateInOtherPeriod?: { trimestre: number | string; ano: number | string }[] | null;
}

// Exibição amigável de erros na interface (mesma regra do App).
const humanError=(m: unknown)=>String(m||'').replace(/aba chamada Planilha1/gi,'aba principal da planilha').replace(/Planilha1/gi,'planilha').replace(/VITE_SUPABASE_[A-Z_]+|SUPABASE_[A-Z_]+/gi,'a configuração').replace(/\bSupabase\b/gi,'sistema de dados').replace(/Storage/g,'o envio do arquivo').replace(/\bRLS\b/g,'as regras de acesso');

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

// Seção da prévia com resumo curto e detalhes opcionais ("Ver detalhes").
interface SecaoPrevProps {
  titulo: React.ReactNode;
  resumo?: React.ReactNode;
  alerta?: boolean;
  vazio?: React.ReactNode;
  detalhes?: React.ReactNode;
  extra?: React.ReactNode;
}

function SecaoPrev({ titulo, resumo, alerta=false, vazio=null, detalhes=null, extra=null }: SecaoPrevProps){
  return <section className={`pv-section${alerta?' pv-alerta':''}`}>
    <h3>{titulo}</h3>
    {resumo
      ? <p className={`pv-resumo${alerta?' warn':''}`}>{resumo}</p>
      : <p className="pv-vazio">{vazio}</p>}
    {extra}
    {detalhes!=null && <details className="pv-detalhes"><summary>Ver detalhes</summary>{detalhes}</details>}
  </section>;
}

// Nomes novos listados por extenso quando a quantidade é pequena.
const nomes = (arr: string[], max=10): string => !arr?.length ? '' : arr.length <= max
  ? arr.join(', ')
  : `${arr.slice(0, max).join(', ')} e mais ${arr.length - max}`;

export default function ImportDialog({ file, analysis, model, arquivosIguais, onCancel, onImported }: ImportDialogProps){
  const inferred = inferMeta(file?.name);
  const [titulo,setTitulo] = useState(String(file?.name || '').replace(/\.[^.]+$/,''));
  const [trimestre,setTrimestre] = useState<number | string>(inferred.trimestre);
  const [ano,setAno] = useState<number | string>(inferred.ano);
  const [stage,setStage] = useState<string | null>(null);
  const [error,setError] = useState<ErroImport | null>(null);
  const [result,setResult] = useState<RelatorioImportado | null>(null);
  const [confirmando,setConfirmando] = useState(false);
  const busy = stage !== null && stage !== STAGES.CONCLUIDO && !error;

  // Prévia SOMENTE LEITURA montada a partir da análise local + modelo atual.
  // Nenhum dado é gravado nem arquivo enviado enquanto o usuário não confirmar.
  // A regra exibida é a MESMA função pura (planejarAtualizacao) que a gravação
  // executa — meta acompanha título/trimestre/ano para o bloqueio de arquivo
  // idêntico no MESMO período.
  const meta = useMemo(() => ({ ano: Number(ano), trimestre: Number(trimestre) }), [ano, trimestre]);
  const prev = useMemo(() => buildUpdatePreview({ analysis, model, arquivosIguais, meta }), [analysis, model, arquivosIguais, meta]);
  const pendenciasPermitidas = prev.pendencias.filter((p: { bloqueia?: boolean }) => !p.bloqueia);
  const podeConfirmar = !busy && !prev.bloqueado && Boolean(titulo.trim()) && analysis.missingRequired.length === 0;

  async function confirm(){
    if(busy || !podeConfirmar) return;
    setError(null); setResult(null); setStage(STAGES.VALIDANDO);
    try{
      const report = await runImport({
        file,
        data: analysis.__buffer,
        analysis,
        meta: { titulo, trimestre: Number(trimestre), ano: Number(ano) },
        onProgress: setStage
      });
      setResult(report as RelatorioImportado);
    }catch(err: unknown){
      setError(err instanceof ImportError ? err : new Error((err as Error).message));
      setStage(null);
    }
  }

  if(result){
    const res = (result.plano || {}) as Record<string, number | undefined>;
    return <div className="modal-backdrop"><div className="modal-card">
      <h2>Atualização concluída com sucesso</h2>
      <p className="modal-file" title={result.arquivoNome}>{result.titulo} · {result.trimestre}º trimestre / {result.ano} · {result.arquivoNome}</p>
      <div className="preview-grid">
        <div><span>Registros novos</span><b>{res.novos ?? 0}</b></div>
        <div><span>Registros reutilizados</span><b>{res.reutilizados ?? 0}</b></div>
        <div><span>Registros reativados</span><b>{res.reativados ?? 0}</b></div>
        <div><span>Registros arquivados</span><b>{res.arquivados ?? 0}</b></div>
        <div><span>Períodos adicionados</span><b>{res.periodosNovos ?? 0}</b></div>
        <div><span>Campos completados</span><b>{res.completacoes ?? 0}</b></div>
        <div><span>Indicadores atualizados</span><b>{(res.indicadoresAtualizados ?? 0) + (res.indicadoresNovos ?? 0)}</b></div>
        <div><span>Divergências mantidas</span><b>{res.divergenciasMantidas ?? 0}</b></div>
        <div><span>Ajustes manuais preservados</span><b>{prev.ajustesPreservados.total}</b></div>
        <div><span>Registros ignorados</span><b>{res.ignoradas ?? 0}</b></div>
        <div><span>Pendências mantidas</span><b>{pendenciasPermitidas.length}</b></div>
      </div>
      {result.duplicateInOtherPeriod && result.duplicateInOtherPeriod.length > 0 &&
        <p className="warn">Atenção: este mesmo arquivo já existe em outro período ({result.duplicateInOtherPeriod.map(d=>`${d.trimestre}/${d.ano}`).join(', ')}). As avaliações anteriores permanecem intactas.</p>}
      <div className="modal-actions"><button className="primary" onClick={()=>onImported(result)}>Fechar</button></div>
    </div></div>;
  }

  return <div className="modal-backdrop" onMouseDown={e=>{ if(e.target===e.currentTarget && !busy) onCancel(); }}>
    <div className="modal-card">
      <h2>Prévia da atualização</h2>
      <p className="modal-file" title={file?.name || ''}>{file?.name} · {formatBytes(file?.size || 0)}</p>

      <section className="pv-resumo-topo">
        <div className="preview-grid">
          <div><span>Período mais recente</span><b>{prev.periodoMaisRecente}</b></div>
          <div><span>Períodos identificados</span><b>{prev.totalPeriodosIdentificados}</b></div>
          <div><span>Registros analisados</span><b>{prev.totalRegistros}</b></div>
          <div><span>Diretores válidos</span><b>{prev.totalDiretores}</b></div>
          <div><span>Unidades</span><b>{prev.totalUnidades}</b></div>
          <div><span>Referência atual</span><b>{prev.referencia.atual}</b></div>
          <div><span>Nova referência</span><b>{prev.referencia.avanca ? prev.referencia.nova : 'Sem alteração'}</b></div>
        </div>
        <p className="pv-nota">Nada será gravado até você confirmar a atualização.</p>
      </section>

      <SecaoPrev titulo="Registros (identidade Diretor + Unidade)"
        alerta={prev.registros.arquivados>0||prev.registros.ignoradas>0}
        resumo={`${prev.registros.novos} novo(s) · ${prev.registros.reutilizados} reutilizado(s) · ${prev.registros.reativados} reativado(s) · ${prev.registros.arquivados} arquivado(s) · ${prev.registros.ignoradas} ignorada(s)`}
        vazio="Nenhum registro identificado na planilha."
        detalhes={(prev.registros.novosDetalhes.length||prev.registros.reativadosDetalhes.length||prev.registros.arquivadosDetalhes.length||prev.registros.ignoradasDetalhes.length||prev.registros.reutilizados)?<>
          {prev.registros.reutilizados>0&&<p className="pv-linha">{prev.registros.reutilizados} registro(s) já existe(m) e serão REUTILIZADOS — mesmo id, histórico e ajustes preservados.</p>}
          {prev.registros.novosDetalhes.length>0&&<ul className="pv-lista">{prev.registros.novosDetalhes.map((d,i)=><li key={`n${i}`}><b>Novo</b><span>{d}</span></li>)}</ul>}
          {prev.registros.reativadosDetalhes.length>0&&<ul className="pv-lista">{prev.registros.reativadosDetalhes.map((d,i)=><li key={`r${i}`}><b>Reativado</b><span>{d} — volta a aparecer (arquivamento removido)</span></li>)}</ul>}
          {prev.registros.arquivadosDetalhes.length>0&&<ul className="pv-lista">{prev.registros.arquivadosDetalhes.map((d,i)=><li key={`a${i}`}><b>Arquivado</b><span>{d} — ausente da planilha; nada é apagado</span></li>)}</ul>}
          {prev.registros.ignoradasDetalhes.length>0&&<ul className="pv-lista">{prev.registros.ignoradasDetalhes.map((d,i)=><li key={`i${i}`}><b>Ignorada</b><span>{d}</span></li>)}</ul>}
        </>:null}/>

      <SecaoPrev titulo="Novos períodos"
        resumo={prev.novosPeriodos.length ? `${prev.novosPeriodos.length} período(s) novo(s) serão adicionados.` : ''}
        vazio="Nenhum período novo encontrado."
        detalhes={prev.novosPeriodos.length ? <ul className="pv-lista">
          {prev.novosPeriodos.map(p=><li key={p.label}>
            <b>{p.label}</b>
            <span>{p.comStatus} com Status · {p.comNivel} com Nível · {p.semPreenchimento} sem preenchimento</span>
          </li>)}
        </ul> : null}/>

      <SecaoPrev titulo="Informações que serão completadas"
        resumo={prev.completacoes.length ? `${prev.completacoes.length} campo(s) vazios serão completados (sem substituir nada já preenchido).` : ''}
        vazio="Nenhuma informação anterior precisa ser completada."
        detalhes={prev.completacoes.length ? <ul className="pv-lista">
          {prev.completacoes.map((c,i)=><li key={i}>
            <b>{String(c.diretor ?? '')}</b> · {String(c.unidade ?? '')}
            <span>{String(c.periodo ?? '')} — {c.campo}: Não informado → {String(c.valorNovo ?? '')}</span>
          </li>)}
        </ul> : null}/>

      <SecaoPrev titulo="Divergências entre planilha e sistema"
        alerta={prev.divergenciasMantidas.length>0}
        resumo={prev.divergencias.length
          ? `${prev.divergencias.length} divergência(s): ${prev.divergencias.filter(d=>d.acao==='atualizado').length} será(ão) atualizado(s) e ${prev.divergenciasMantidas.length} mantido(s) — a prioridade do sistema (ajuste manual > cadastro manual > valor importado) preserva o valor existente.`
          : ''}
        vazio="Nenhuma divergência: planilha e sistema estão alinhados."
        detalhes={prev.divergencias.length ? <ul className="pv-lista">
          {prev.divergencias.slice(0,200).map((d,i)=><li key={i}>
            <b>{d.diretor}</b> · {d.unidade}
            <span>{d.periodo?`${d.periodo} — `:''}{d.campo}: sistema {d.valorSistemaExibido} · planilha {d.valorPlanilhaExibido} · {d.acao==='atualizado'?'atualizado':'mantido'} ({d.origem})</span>
          </li>)}
          {prev.divergencias.length>200&&<li className="pv-linha">… e mais {prev.divergencias.length-200} divergência(s).</li>}
        </ul> : null}/>

      <SecaoPrev titulo="Dados existentes preservados"
        resumo={[
          `${prev.periodosPreservados.total} período(s) existente(s) serão mantidos sem alteração.`,
          `${prev.periodosPreservados.registros} registro(s) existente(s) serão preservados.`,
          prev.ajustesPreservados.total
            ? `${prev.ajustesPreservados.total} ajuste(s) realizado(s) no sistema permanecerão intactos.`
            : 'Nenhum ajuste manual registrado.'
        ].join(' ')}
        detalhes={<ul className="pv-chips-lista">{prev.periodosPreservados.rotulos.map(r=><li key={r}>{r}</li>)}</ul>}/>

      <SecaoPrev titulo="Ajustes manuais preservados" alerta={prev.ajustesPreservados.total>0}
        resumo={prev.ajustesPreservados.total
          ? `Ajustes realizados no sistema têm prioridade e não serão substituídos pela planilha. ${prev.ajustesPreservados.total} ajuste(s) manual(is) permanecerão intactos.`
          : ''}
        vazio="Nenhum ajuste manual registrado."
        detalhes={prev.ajustesPreservados.total ? <ul className="pv-lista">
          {prev.ajustesPreservados.detalhes.map((a,i)=><li key={i}>
            <b>{a.diretor}</b> · {a.unidade}
            <span>{a.periodo} — valor original importado: {a.statusOriginal} {a.nivelOriginal!=='—'?a.nivelOriginal:''} · valor vigente ajustado: {a.statusVigente} {a.nivelVigente}</span>
          </li>)}
        </ul> : null}/>

      <SecaoPrev titulo="Notas e indicadores"
        resumo={prev.indicadores.totalRegistros ? `${prev.indicadores.totalRegistros} registro(s) terão notas e indicadores atualizados — referência mais recente encontrada: ${prev.indicadores.referencia}.` : ''}
        vazio="Nenhum indicador reconhecido na planilha."
        extra={prev.indicadores.nomes.length ? <div className="chips">
          <span className="chips-label">Indicadores reconhecidos:</span>
          {prev.indicadores.nomes.map(n=><i key={n}>{n}</i>)}
        </div> : null}
        detalhes={prev.indicadores.totalRegistros ? <ul className="pv-lista">
          {prev.indicadores.detalhes.map((d,i)=><li key={i}>
            <b>{d.diretor}</b> · {d.unidade}
            <span>{d.valores.map(v=>`${v.nome}: ${typeof v.valor==='number'?v.valor.toLocaleString('pt-BR',{maximumFractionDigits:2}):v.valor}`).join(' · ')}</span>
          </li>)}
        </ul> : null}/>

      <SecaoPrev titulo="Novos cadastros e vínculos"
        resumo={`${prev.cadastros.regionaisNovas.length} regional(is) nova(s) · ${prev.cadastros.diretoresNovos.length} diretor(es) novo(s) · ${prev.cadastros.unidadesNovas.length} unidade(s) nova(s) · ${prev.cadastros.diretoresExistentes} diretor(es) existente(s) · ${prev.cadastros.semDiretor} registro(s) sem diretor`}
        extra={<p className="pv-linha">Depois de confirmar a atualização, os filtros Regional e Diretor são recarregados com os novos cadastros — sem reiniciar o sistema.</p>}
        detalhes={(prev.cadastros.regionaisNovas.length||prev.cadastros.diretoresNovos.length||prev.cadastros.unidadesNovas.length||prev.cadastros.mudancasRegional.length||prev.cadastros.mudancasUnidade.length)?<>
          {prev.cadastros.regionaisNovas.length>0&&<p className="pv-linha">Regionais novas: <b>{nomes(prev.cadastros.regionaisNovas)}</b></p>}
          {prev.cadastros.diretoresNovos.length>0&&<p className="pv-linha">Diretores novos: <b>{nomes(prev.cadastros.diretoresNovos)}</b></p>}
          {prev.cadastros.unidadesNovas.length>0&&<p className="pv-linha">Unidades novas: <b>{nomes(prev.cadastros.unidadesNovas)}</b></p>}
          {prev.cadastros.mudancasRegional.length>0&&<ul className="pv-lista">{prev.cadastros.mudancasRegional.map((m,i)=><li key={i}><b>{m.diretor}</b><span>Mudança de Regional: {m.anterior} → {m.novo}</span></li>)}</ul>}
          {prev.cadastros.mudancasUnidade.length>0&&<ul className="pv-lista">{prev.cadastros.mudancasUnidade.map((m,i)=><li key={i}><b>{m.diretor}</b><span>Mudança de Unidade: {m.anterior} → {m.novo}</span></li>)}</ul>}
        </>:null}/>

      {prev.pendencias.length>0&&<section className="pv-section pv-alerta">
        <h3>Pendências e alertas</h3>
        <ul className="pv-alertas">
          {prev.pendencias.map((p,i)=><li key={i} className={p.bloqueia?'error':''}>{p.mensagem}{p.bloqueia?' (impede a atualização)':''}</li>)}
        </ul>
      </section>}

      {analysis.missingRequired.length > 0 && <p className="error">Campos obrigatórios ausentes: {analysis.missingRequired.map(f=>f.label).join(', ')}.</p>}
      {analysis.sheetNames && analysis.sheetNames.length > 1 && <p className="info">Ignorando outras abas: {analysis.sheetNames.filter(n=>n!=='Planilha1').join(', ')}.</p>}

      <section className="meta-form">
        <h3>Dados da avaliação</h3>
        <label>Título
          <input value={titulo} onChange={e=>setTitulo(e.target.value)} placeholder="Ex.: 4º trimestre 2026 — status diretores"/>
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

      {stage && STAGE_ORDER.includes(stage) && <section className="progress">
        {STAGE_ORDER.map(s => <div key={s} className={`step ${stage===s?'current':''} ${STAGE_ORDER.indexOf(stage)>STAGE_ORDER.indexOf(s)?'done':''}`}>{STAGE_LABELS[s as keyof typeof STAGE_LABELS]}</div>)}
      </section>}

      {error && <p className="error">{error.stage?`Falha em "${STAGE_LABELS[error.stage as keyof typeof STAGE_LABELS]||error.stage}": `:''}{humanError(error.message)}</p>}

      <div className="modal-actions">
        <button onClick={onCancel} disabled={busy}>Cancelar</button>
        <button className="primary" onClick={()=>setConfirmando(true)} disabled={!podeConfirmar}>
          Confirmar atualização
        </button>
      </div>

      <ConfirmModal
        aberto={confirmando}
        titulo="Confirmar atualização?"
        mensagem="Somente depois da confirmação o sistema grava a nova avaliação e o arquivo completo."
        detalhe={[
          `Registros: ${prev.registros.novos} novo(s), ${prev.registros.reutilizados} reutilizado(s), ${prev.registros.reativados} reativado(s), ${prev.registros.arquivados} arquivado(s), ${prev.registros.ignoradas} ignorada(s)`,
          `Períodos novos: ${prev.novosPeriodos.length}${prev.novosPeriodos.length?` (${prev.novosPeriodos.map(p=>p.label).join(', ')})`:''}`,
          `Campos vazios a completar: ${prev.completacoes.length}`,
          `Divergências mantidas: ${prev.divergenciasMantidas.length} (prioridade do sistema)`,
          `Ajustes manuais preservados: ${prev.ajustesPreservados.total}`,
          `Notas e indicadores a atualizar: ${prev.indicadores.totalRegistros} registro(s)`,
          `Novos cadastros: ${prev.cadastros.regionaisNovas.length} regional(is), ${prev.cadastros.diretoresNovos.length} diretor(es), ${prev.cadastros.unidadesNovas.length} unidade(s)`,
          `Pendências permitidas: ${pendenciasPermitidas.length}`
        ].join('\n')}
        textoConfirmar="Sim, atualizar"
        textoCancelar="Voltar"
        ocupado={busy}
        onConfirm={()=>{ setConfirmando(false); confirm(); }}
        onCancel={()=>setConfirmando(false)}
      />
    </div>
  </div>;
}
