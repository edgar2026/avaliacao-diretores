import React from 'react';
import { buildRadarSeries } from '../services/dashboardService.js';

const fmtNivel=v=>Number.isInteger(v)?String(v):v.toFixed(1).replace('.',',');
const ROMANO=['','I','II','III','IV','V'];

/**
 * Evolução MENSAL de um diretor: eixo X com os meses REAIS da planilha
 * (JUN/2025 … SET/2026), uma única série e eixo Y fixo 1..5 (níveis romanos).
 * Fechamentos trimestrais usam marcador dourado maior com contorno e trazem
 * "Nº trimestre de AAAA" abaixo do mês. Valor ausente = quebra na linha
 * (nunca 0, nunca repetido): o mês permanece no eixo, sem ponto.
 * Largura responsiva via ResizeObserver (gap mínimo de 96px por período).
 */
export function MonthlyEvolutionChart({periods,series}){
 const labels=periods||[];
 const listas=series||[];
 if(!labels.length||!listas.length)return <p className="chart-empty">Sem períodos para exibir</p>;
 const PAD=46,H=360,T=26,B=76,MIN_GAP=96;
 const scrollRef=React.useRef(null);
 const [availW,setAvailW]=React.useState(PAD*2+MIN_GAP*Math.max(0,labels.length-1));
 React.useLayoutEffect(()=>{
  const el=scrollRef.current;
  if(!el)return;
  const update=()=>setAvailW(el.clientWidth);
  update();
  const ro=new ResizeObserver(update);
  ro.observe(el);
  return ()=>ro.disconnect();
 },[]);
 const total=labels.length;
 const gap=total>1?Math.max(MIN_GAP,(availW-PAD*2)/(total-1)):0;
 const W=Math.max(availW,PAD*2+gap*Math.max(0,total-1));
 const x=i=>PAD+i*gap;
 const y=v=>T+(5-v)*(H-T-B)/4;
 const segmentsDe=valores=>{const segs=[];let cur=[];valores.forEach((v,i)=>{if(typeof v==='number'&&Number.isFinite(v))cur.push([x(i),y(v)]);else if(cur.length){segs.push(cur);cur=[]}});if(cur.length)segs.push(cur);return segs};
 const path=seg=>seg.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
 const tooltip=(p,v)=>{
  const linhas=[p.label];
  if(p.status)linhas.push(`Status: ${p.status}`);
  linhas.push(`Nível: ${ROMANO[v]||v} (${fmtNivel(v)})`);
  if(p.quarterLabel)linhas.push(p.quarterLabel);
  return linhas.join('\n');
 };
 return <div className="chart-frame">
  <svg className="chart-yaxis" viewBox={`0 0 42 ${H}`} width={42} height={H}>{[1,2,3,4,5].map(nn=><text key={nn} x={38} y={y(nn)+4} textAnchor="end">{nn}</text>)}</svg>
  <div className="chart-scroll" ref={scrollRef}><svg className="chart-svg line" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
   {[1,2,3,4,5].map(nn=><line key={nn} className="chart-grid" x1={PAD-14} y1={y(nn)} x2={W-PAD+14} y2={y(nn)}/>)}
   {listas.map(s=><g key={s.key}>{segmentsDe(s.valores).map((seg,i)=><path key={i} className={`line-path line-${s.classe}`} d={path(seg)}/>)}</g>)}
   {listas.map(s=><g key={s.key+'-pts'}>{s.valores.map((v,i)=>{
     // Período sem informação: mês continua no eixo, sem ponto e sem valor —
     // `segmentsDe` já interrompe a linha nesse ponto.
     if(typeof v!=='number'||!Number.isFinite(v))return null;
     const p=labels[i]||{};
     const tri=!!p.isQuarter;
     const px=x(i),py=y(v);
     return <g key={i}>
      <circle className={`dot ${tri?'dot-quarter':'dot-'+s.classe}`} cx={px} cy={py} r={tri?7.5:5}><title>{tooltip(p,v)}</title></circle>
      <text className={`val ${tri?'val-quarter':'val-'+s.classe}`} x={px} y={py-(tri?17:12)} textAnchor="middle">{fmtNivel(v)}</text>
     </g>;
    })}</g>)}
   {labels.map((p,i)=><g key={p.label+i}>
     <text className="x-label" x={x(i)} y={H-30} textAnchor="middle">{p.label}</text>
     {p.quarterLabel&&<text className="x-sub" x={x(i)} y={H-13} textAnchor="middle">{p.quarterLabel}</text>}
    </g>)}
  </svg></div>
 </div>;
}
const names=['Presencial','Acadêmico','Pós-graduação','Nota geral','Avaliação institucional','Ritmo de captação','Crescimento de matrículas','Evasão','EBITDA'];
// Normaliza para a escala 0..1 do radar. Indicador AUSENTE permanece `null`
// (nunca vira 0: zero seria lido como desempenho péssimo no eixo).
function normalized(name,v){if(v==null||!Number.isFinite(v))return null;if(['Presencial','Acadêmico','Pós-graduação','Nota geral','Avaliação institucional'].includes(name))return Math.max(0,Math.min(1,v/5));if(name==='Evasão')return Math.max(0,Math.min(1,1-v/.3));return Math.max(0,Math.min(1,(v+.5)));}
export function RadarChart({records,allRecords}){
 // Os registros vêm do modelo do Supabase (`metricas`); o acesso aos
 // indicadores passa por `buildRadarSeries`/`recordMetric`, que convertem os
 // nomes e protegem registro/propriedade ausente. Sem nenhum indicador
 // disponível, exibe "Indicadores não disponíveis" no lugar do radar.
 const radar=buildRadarSeries(records,allRecords,names);
 if(!radar.disponivel)return <p className="chart-empty">Indicadores não disponíveis</p>;
 const N=radar.nomes.length,W=760,H=420,cx=380,cy=195,r=145;
 const point=(i,f)=>{const a=-Math.PI/2+i*2*Math.PI/N;return [cx+Math.cos(a)*r*f,cy+Math.sin(a)*r*f]};
 const poly=vals=>vals.map((v,i)=>{const f=normalized(radar.nomes[i],v);return f==null?null:point(i,f)}).filter(Boolean).map(p=>p.join(',')).join(' ');
 const selPts=poly(radar.sel),allPts=poly(radar.all);
 return <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg radar">{[.25,.5,.75,1].map(q=><polygon key={q} points={Array.from({length:N},(_,i)=>point(i,q).join(',')).join(' ')}/>)}{radar.nomes.map((n,i)=>{const p=point(i,1),l=point(i,1.28);return <g key={n}><line x1={cx} y1={cy} x2={p[0]} y2={p[1]}/><text x={l[0]} y={l[1]} textAnchor="middle">{n.replace('Crescimento de matrículas','Cresc. matrículas').replace('Avaliação institucional','Aval. institucional')}</text></g>})}{allPts&&<polygon className="radar-all" points={allPts}/>}<polygon className="radar-sel" points={selPts}/></svg>
}
