import React from 'react';

/* =============================================================================
 * FAIXA MENSAL DE STATUS — componente AUXILIAR e ISOLADO do gráfico de evolução.
 *
 * Visual somente: mostra, para cada mês já presente no eixo, uma etiqueta
 * colorida com o Status do MESMO período, alinhada verticalmente ao ponto
 * mensal. NÃO cria segunda linha gráfica, NÃO cria ponto extra, NÃO duplica
 * meses e NÃO altera dados persistidos (usa exatamente periods[i].status).
 *
 * Paleta (mesmas cores do sistema):
 *   Supervisão I/II  → fundo #EF4444, texto branco
 *   Gestão I/II      → fundo #FACC15, texto #422006
 *   Delegação I/II   → fundo #22C55E, texto branco
 *   Demais/Ausente   → fundo neutro #64748B, texto branco (etiqueta "N/I")
 *
 * PARA DESFAZER esta faixa: apagar este arquivo e remover em Charts.jsx os
 * três pontos de uso (import, <StatusTimeline/> dentro do SVG e
 * <StatusTimelineLegend/> após o chart-frame). A linha do Nível e todo o restante
 * do gráfico permanecem intactos.
 * ========================================================================== */

// Normalização igual à do resumo do card (App.jsx): caixa, acentos e espaços.
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();

// Abreviação SOMENTE visual — o valor armazenado/exibido no tooltip continua
// completo. "Não informado" e Status ausente viram "N/I".
const ABREV={
  'supervisao i':'SUP I','supervisao ii':'SUP II',
  'gestao i':'GEST I','gestao ii':'GEST II',
  'delegacao i':'DELEG I','delegacao ii':'DELEG II',
  'acompanhamento':'ACOMP.','reposicionamento':'REPOS.',
  'nao informado':'N/I'
};

export function statusClasse(status){
  const t=norm(status);
  if(/^supervisao (i|ii)$/.test(t))return 'supervisao';
  if(/^gestao (i|ii)$/.test(t))return 'gestao';
  if(/^delegacao (i|ii)$/.test(t))return 'delegacao';
  return 'neutro';
}

export function statusAbrev(status){
  const t=norm(status);
  if(!t)return 'N/I';
  if(ABREV[t])return ABREV[t];
  return String(status).trim().toUpperCase();
}

/**
 * Faixa desenhada DENTRO do mesmo SVG do gráfico (mesmo scroll e mesma escala
 * de x), posicionada entre o rótulo do mês e a identificação trimestral.
 * Props: periods (mesmos períodos do gráfico), x(i) (posição mensal), gap,
 * yTop/altura (retângulo da faixa), info(i) (linhas do tooltip — sempre com
 * o Status/Nível do próprio mês, sem repetir valores anteriores) e os
 * handlers de tooltip do gráfico (abre/mexe/fecha).
 */
export default function StatusTimeline({periods,x,gap,yTop,altura,info,abre,mexe,fecha}){
  const list=periods||[];
  if(!list.length)return null;
  const larg=Math.max(26,Math.min((gap||0)>0?gap-6:56,62));
  return <g className="status-timeline">
    {list.map((p,i)=>{
      const classe=statusClasse(p.status);
      const px=x(i);
      return <g key={p.label+i} className="st-cell"
        onMouseEnter={e=>abre(e,info(i))} onMouseMove={mexe} onMouseLeave={fecha}>
        <rect className={`st-band st-${classe}`} x={px-larg/2} y={yTop} width={larg} height={altura} rx={4}/>
        <text className={`st-label st-text-${classe}`} x={px} y={yTop+altura/2+3.5} textAnchor="middle">{statusAbrev(p.status)}</text>
      </g>;
    })}
  </g>;
}

// Legenda compacta das cores (linha simples abaixo do gráfico — sem bloco grande).
export function StatusTimelineLegend(){
  return <div className="status-legend" aria-hidden="true">
    <span className="status-legend-titulo">Status:</span>
    <span><i className="st-supervisao"/>Supervisão</span>
    <span><i className="st-gestao"/>Gestão</span>
    <span><i className="st-delegacao"/>Delegação</span>
    <span><i className="st-neutro"/>Outro/Não informado</span>
  </div>;
}
