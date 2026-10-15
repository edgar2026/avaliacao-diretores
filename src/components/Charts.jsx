import React from 'react';
import { buildRadarSeries } from '../services/dashboardService.js';

const fmtNivel=v=>Number.isInteger(v)?String(v):v.toFixed(1).replace('.',',');
const ROMANO=['','I','II','III','IV','V'];
const MESES_EXT=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const MESES_LONGO=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
// "JUN/2026" -> "Junho de 2026" apenas para exibição no tooltip; o rótulo do
// eixo continua em MES/AAAA e nenhum dado é recalculado.
function periodoExtenso(rotulo){
 const txt=String(rotulo||'');
 const m=/^([A-Z]{3})\/(\d{4})$/.exec(txt);
 if(!m)return txt;
 const i=MESES_EXT.indexOf(m[1]);
 return i<0?txt:`${MESES_LONGO[i]} de ${m[2]}`;
}

// Regra responsiva da largura: até este número de períodos TODOS os meses
// cabem na largura do card (width:100%, min-width:0, overflow-x:hidden e
// pontos distribuídos por toda a largura útil — NENHUMA barra de rolagem).
// Acima dele o SVG ganha largura interna proporcional e a rolagem horizontal
// acontece SOMENTE dentro da área do gráfico (a página nunca rola na horizontal).
const MAX_VISIBLE_PERIODS_WITHOUT_SCROLL = 18;

/**
 * Evolução MENSAL do nível de desenvolvimento de um diretor: eixo X com os
 * meses REAIS da planilha (JUN/2026 … SET/2026), uma única série e eixo Y
 * fixo Nível I..Nível V (valores internos 1..5). Os rótulos são algarismos
 * romanos (não notas). Fechamentos trimestrais usam marcador dourado maior
 * com contorno e trazem "Nº trimestre de AAAA" abaixo do mês (com quebra em
 * duas linhas quando o espaço lateral é curto). Valor ausente = quebra na
 * linha (nunca 0, nunca repetido): o mês permanece no eixo, sem ponto.
 * Largura e altura responsivas via ResizeObserver (sem barra até
 * MAX_VISIBLE_PERIODS_WITHOUT_SCROLL períodos; gap mínimo de 96px por
 * período somente acima disso) e tooltip próprio em HTML.
 */
export function MonthlyEvolutionChart({periods,series}){
 const labels=periods||[];
 const listas=series||[];
 if(!labels.length||!listas.length)return <p className="chart-empty">Sem períodos para exibir</p>;
  const PAD=36,T=40,B=66,MIN_GAP=96;
 const scrollRef=React.useRef(null);
 const frameRef=React.useRef(null);
 const [availW,setAvailW]=React.useState(PAD*2+MIN_GAP*Math.max(0,labels.length-1));
 // boxH = altura do card (eixo Y); plotH = altura útil do desenho, já
 // descontando a barra de rolagem horizontal quando ela aparece.
  const [boxH,setBoxH]=React.useState(296);
  const [plotH,setPlotH]=React.useState(296);
 const [tip,setTip]=React.useState(null);
 React.useLayoutEffect(()=>{
   const sc=scrollRef.current;
   if(!sc)return;
   const upd=()=>{
     setAvailW(sc.clientWidth);
     setPlotH(sc.clientHeight);
     const fr=frameRef.current;
     if(fr&&fr.clientHeight)setBoxH(fr.clientHeight);
   };
   upd();
   const ro=new ResizeObserver(upd);
   ro.observe(sc);
   if(frameRef.current)ro.observe(frameRef.current);
   return ()=>ro.disconnect();
 },[]);
 const H=Math.max(220,plotH||280);
 const total=labels.length;
 // Modo sem barra (<= MAX_VISIBLE_PERIODS_WITHOUT_SCROLL): o gap vem SOBREDA
 // largura real medida do container (nenhuma largura mínima fixa) e a largura
 // do SVG é a própria largura disponível. Modo com rolagem (> limite): largura
 // interna proporcional com MIN_GAP de leitura por período.
 const comRolagem=total>MAX_VISIBLE_PERIODS_WITHOUT_SCROLL;
 const gap=total>1?(comRolagem
   ? Math.max(MIN_GAP,(availW-PAD*2)/(total-1))
   : Math.max(0,(availW-PAD*2)/(total-1))):0;
 const W=comRolagem?Math.max(availW,PAD*2+gap*Math.max(0,total-1)):availW;
 const x=i=>PAD+i*gap;
 const y=v=>T+(5-v)*(H-T-B)/4;
 const segmentsDe=valores=>{const segs=[];let cur=[];valores.forEach((v,i)=>{if(typeof v==='number'&&Number.isFinite(v))cur.push([x(i),y(v)]);else if(cur.length){segs.push(cur);cur=[]}});if(cur.length)segs.push(cur);return segs};
 const path=seg=>seg.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
 // Rótulo trimestral: se o espaço horizontal ao redor (meia distância até o
 // trimestre vizinho ou até a borda do SVG) não comporta o texto de uma vez,
 // quebra em duas linhas ("3º trimestre" / "de 2026") — nunca aumenta a
 // largura do gráfico e nunca deixa os dois trimestres se sobreporem.
 const idxTri=labels.reduce((a,p,i)=>{if(p.quarterLabel)a.push(i);return a},[]);
 const triQuebra={};
 const larguraTxt=txt=>String(txt||'').length*6.4;
 idxTri.forEach((i,k)=>{
   const texto=labels[i].quarterLabel;
   const espacoEsq=k===0?x(i):(x(i)-x(idxTri[k-1]))/2;
   const espacoDir=k===idxTri.length-1?(W-x(i)):(x(idxTri[k+1])-x(i))/2;
   const espaco=Math.max(20,Math.min(espacoEsq,espacoDir));
   if(larguraTxt(texto)/2<=espaco){triQuebra[i]=null;return;}
   const corte=texto.lastIndexOf(' de ');
   triQuebra[i]=corte>0?[texto.slice(0,corte),texto.slice(corte+1)]:[texto];
 });
 const linhas=(p,v)=>{
   const out=[periodoExtenso(p.label)];
   if(p.status)out.push(`Estágio: ${p.status}`);
   out.push(`Nível de desenvolvimento: ${ROMANO[v]||fmtNivel(v)}`);
   if(p.quarterLabel)out.push(`Fechamento do ${p.quarterLabel}`);
   return out;
 };
 const abre=(e,l)=>setTip({x:e.clientX,y:e.clientY,l});
 const mexe=e=>setTip(t=>t?{...t,x:e.clientX,y:e.clientY}:t);
 const fecha=()=>setTip(null);
 const tipLeft=tip?Math.max(8,Math.min(tip.x+16,((typeof window!=='undefined'&&window.innerWidth)||1200)-300)):8;
 return <div className="chart-frame" ref={frameRef}>
      <svg className="chart-yaxis" viewBox={`0 0 56 ${boxH}`} width={56} height={boxH}>{[1,2,3,4,5].map(nn=><text key={nn} x={50} y={y(nn)+4.5} textAnchor="end">Nível {ROMANO[nn]}</text>)}</svg>
  <div className="chart-scroll" ref={scrollRef} style={{overflowX:comRolagem?'auto':'hidden'}}><svg className="chart-svg line" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{width:comRolagem?W:'100%',height:H}}>
   {[1,2,3,4,5].map(nn=><line key={nn} className="chart-grid" x1={PAD-14} y1={y(nn)} x2={W-PAD+14} y2={y(nn)}/>)}
   {listas.map(s=><g key={s.key}>{segmentsDe(s.valores).map((seg,i)=><path key={i} className={`line-path line-${s.classe}`} d={path(seg)}/>)}</g>)}
   {listas.map(s=><g key={s.key+'-pts'}>{s.valores.map((v,i)=>{
      // Período sem informação: mês continua no eixo, sem ponto e sem valor —
      // `segmentsDe` já interrompe a linha nesse ponto.
      if(typeof v!=='number'||!Number.isFinite(v))return null;
      const p=labels[i]||{};
      const tri=!!p.isQuarter;
      const px=x(i),py=y(v);
      const info=linhas(p,v);
      return <g key={i}>
       <circle className={`dot ${tri?'dot-quarter':'dot-'+s.classe}`} cx={px} cy={py} r={tri?7.5:6}/>
        <text className={`val ${tri?'val-quarter':'val-'+s.classe}`} x={px} y={py-(tri?22:16)} textAnchor="middle">{ROMANO[v]||fmtNivel(v)}</text>
       <circle className="dot-hit" cx={px} cy={py} r={tri?13:10}
        onMouseEnter={e=>abre(e,info)} onMouseMove={mexe} onMouseLeave={fecha}/>
      </g>;
    })}</g>)}
   {labels.map((p,i)=><g key={p.label+i}>
     <text className="x-label" x={x(i)} y={p.quarterLabel&&triQuebra[i]?H-34:H-30} textAnchor="middle">{p.label}</text>
     {p.quarterLabel&&(triQuebra[i]
       ? <text className="x-sub" x={x(i)} y={H-17} textAnchor="middle"><tspan x={x(i)} dy="0">{triQuebra[i][0]}</tspan>{triQuebra[i][1]&&<tspan x={x(i)} dy="12">{triQuebra[i][1]}</tspan>}</text>
       : <text className="x-sub" x={x(i)} y={H-11} textAnchor="middle">{p.quarterLabel}</text>)}
   </g>)}
  </svg></div>
  {tip&&<div className="chart-tip" style={{left:tipLeft,top:tip.y}}><b>{tip.l[0]}</b>{tip.l.slice(1).map((t,i)=><span key={i}>{t}</span>)}</div>}
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
 const N=radar.nomes.length,W=760,H=440,cx=380,cy=220,r=180;
 const point=(i,f)=>{const a=-Math.PI/2+i*2*Math.PI/N;return [cx+Math.cos(a)*r*f,cy+Math.sin(a)*r*f]};
 const poly=vals=>vals.map((v,i)=>{const f=normalized(radar.nomes[i],v);return f==null?null:point(i,f)}).filter(Boolean).map(p=>p.join(',')).join(' ');
 const selPts=poly(radar.sel),allPts=poly(radar.all);
 return <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg radar">{[.25,.5,.75,1].map(q=><polygon key={q} points={Array.from({length:N},(_,i)=>point(i,q).join(',')).join(' ')}/>)}{radar.nomes.map((n,i)=>{const p=point(i,1),l=point(i,1.18);return <g key={n}><line x1={cx} y1={cy} x2={p[0]} y2={p[1]}/><text x={l[0]} y={l[1]} textAnchor="middle">{n.replace('Crescimento de matrículas','Cresc. matrículas').replace('Avaliação institucional','Aval. institucional')}</text></g>})}{allPts&&<polygon className="radar-all" points={allPts}/>}<polygon className="radar-sel" points={selPts}/></svg>
}

