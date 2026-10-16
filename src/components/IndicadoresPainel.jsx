import { useMemo, useState } from 'react';
import {
  CAMPOS_INDICADORES,
  CAMPOS_NOTA,
  CAMPOS_PERCENTUAL,
  formatarEntradaIndicador,
  mesmoValorIndicador,
  parseValorIndicador,
  salvarAjustesIndicadores
} from '../services/indicadoresAjustesService.js';
import { formatMetricCell, recordMetric } from '../services/dashboardService.js';

/**
 * Painel dedicado de PONTUAÇÕES e INDICADORES de UM registro do diretor
 * (aberto pelo botão "Indicadores" na tabela de períodos existentes).
 * Regras (não alteradas): somente campos digitados e diferentes do vigente
 * são gravados; valor original importado preservado; em branco nunca vira
 * zero; percentuais digitados em % e gravados como fração. Após a confirmação
 * do banco, o chamador atualiza o modelo — cards, radar e matriz mudam na
 * hora; nada de evolução mensal falsa.
 */
export default function IndicadoresPainel({ registro, onSalvo, onFechar }){
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  // Somente campos digitados entram em `entradas`: o que não foi tocado não
  // é enviado (o prefill de entrada é o vigente formatado).
  const [entradas, setEntradas] = useState({});

  const pendentes = useMemo(() => {
    const out = [];
    for(const campo of CAMPOS_INDICADORES){
      if(!(campo.chave in entradas)) continue;
      let novo = null;
      try { novo = parseValorIndicador(entradas[campo.chave], campo.tipo); } catch { continue; }
      if(novo == null) continue;
      const vig = recordMetric(registro, campo.chave);
      if(vig != null && mesmoValorIndicador(novo, vig, campo.tipo)) continue;
      out.push({
        chave: campo.chave,
        rotulo: campo.rotulo,
        vigente: vig == null ? 'não informado' : formatMetricCell(vig, campo.chave),
        novo: formatMetricCell(novo, campo.chave)
      });
    }
    return out;
  }, [entradas, registro]);

  const ultimaAtualizacao = useMemo(() => {
    let max = null;
    for(const info of Object.values(registro?.metricasInfo || {})){
      const quando = info?.ajustado ? info.atualizadoEm : null;
      if(quando && (!max || String(quando) > String(max))) max = quando;
    }
    if(!max) return 'Nenhuma';
    try { return new Date(max).toLocaleString('pt-BR'); } catch { return String(max); }
  }, [registro]);

  function fechar(){
    if(ocupado) return;
    onFechar?.();
  }

  async function salvar(){
    if(ocupado || !registro) return;
    setErro('');
    try{
      setOcupado(true);
      const ajustes = await salvarAjustesIndicadores({
        avaliacaoId: registro.avaliacaoId,
        registroId: registro.id,
        campos: CAMPOS_INDICADORES,
        entradas,
        vigente: registro.metricas || {},
        importado: registro.metricasImportado || {}
      });
      onSalvo?.({ tipo: 'indicadores', ajustes, total: ajustes.length });
    } catch(e){
      setErro(e?.message || String(e));
      setOcupado(false);
    }
  }

  const linhaCampo = campo => {
    const vig = recordMetric(registro, campo.chave);
    const info = registro?.metricasInfo?.[campo.chave];
    const texto = campo.chave in entradas
      ? entradas[campo.chave]
      : formatarEntradaIndicador(vig, campo.tipo);
    const origem = info?.ajustado
      ? (info.origem === 'cadastro_manual' ? 'cadastro manual' : 'edição manual')
      : 'planilha';
    return (
      <label key={campo.chave}>
        {campo.rotulo}{campo.tipo === 'percentual' ? ' (%)' : ''} — vigente {vig == null ? 'não informado' : formatMetricCell(vig, campo.chave)} · {origem}
        <input
          type="text"
          inputMode="decimal"
          value={texto}
          placeholder={campo.tipo === 'percentual' ? 'Ex.: 10,5' : 'Ex.: 3,25'}
          onChange={(e) => { setEntradas(p => ({ ...p, [campo.chave]: e.target.value })); setErro(''); }}
          disabled={ocupado}
        />
      </label>
    );
  };

  return <div className="modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)fechar();}}>
    <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="indicadores-painel-titulo">
      <h2 id="indicadores-painel-titulo">Pontuações e indicadores</h2>
      <p className="modal-file">{registro ? `${registro.diretor} · ${registro.avaliacaoLabel}` : 'Nenhum registro selecionado.'}</p>
      <div className="info">
        Vigência: <b>ajuste manual &gt; valor importado</b>. Notas aceitam vírgula ou ponto (ex.: 3,25);
        percentuais são digitados em <b>%</b> (10 = 10,0%) e exibidos com %. Deixe em branco para manter o valor atual.
      </div>
      {erro && <p className="error" role="alert">{erro}</p>}
      <div className="preview-grid">
        <div><span>Alterações pendentes</span><b>{pendentes.length ? `${pendentes.length} de ${CAMPOS_INDICADORES.length}` : 'Nenhuma'}</b></div>
        <div><span>Última atualização manual</span><b>{ultimaAtualizacao}</b></div>
      </div>
      <div className="meta-form">
        <div className="meta-row">{CAMPOS_NOTA.slice(0, 2).map(linhaCampo)}</div>
        <div className="meta-row">{CAMPOS_NOTA.slice(2, 4).map(linhaCampo)}</div>
        <div className="meta-row">{CAMPOS_NOTA.slice(4, 5).map(linhaCampo)}</div>
        <div className="meta-row">{CAMPOS_PERCENTUAL.slice(0, 2).map(linhaCampo)}</div>
        <div className="meta-row">{CAMPOS_PERCENTUAL.slice(2, 4).map(linhaCampo)}</div>
      </div>
      {pendentes.length > 0 && <div className="chips">
        <span className="chips-label">Alterações pendentes</span>
        {pendentes.map(p => <i key={p.chave}>{p.rotulo}: {p.vigente} → {p.novo}</i>)}
      </div>}
      <div className="info">
        O valor original importado permanece preservado para auditoria; uma planilha futura não sobrescreve valores manuais.
      </div>
      <div className="modal-actions">
        <button onClick={fechar} disabled={ocupado}>Cancelar</button>
        <button className="primary" onClick={salvar} disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar pontuações'}</button>
      </div>
    </div>
  </div>;
}
