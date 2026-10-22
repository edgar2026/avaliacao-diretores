import React from 'react';
import { buildRadarSeries } from '../services/dashboardService.js';

const ROMANO=['','I','II','III','IV','V'];

// ---------------------------------------------------------------------------
// Configuração ÚNICA do Status na evolução mensal: hierarquia vertical, cor de
// fundo (cards do eixo, pontos e segmentos), texto (sempre branco nos cards)
// e contorno. TODA cor/posição do gráfico lê daqui — nenhuma condicional de
// cor espalhada em outros componentes.
// De baixo para cima: Acompanhamento … Delegação II (mais avançado no topo).
// "Reposicionamento" NÃO entra nesta escala (pertence ao Ciclo de Vida).
// ---------------------------------------------------------------------------
const normSt=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
export const STATUS_EVO=[
 {chave:'acompanhamento',nome:'Acompanhamento',ordem:1,cor:'#64748B',texto:'#FFFFFF',borda:'#334155'},
 {chave:'supervisao i',nome:'Supervisão I',ordem:2,cor:'#EF4444',texto:'#FFFFFF',borda:'#7F1D1D'},
 {chave:'supervisao ii',nome:'Supervisão II',ordem:3,cor:'#B91C1C',texto:'#FFFFFF',borda:'#7F1D1D'},
 {chave:'gestao i',nome:'Gestão I',ordem:4,cor:'#EAB308',texto:'#FFFFFF',borda:'#854D0E'},
 {chave:'gestao ii',nome:'Gestão II',ordem:5,cor:'#D97706',texto:'#FFFFFF',borda:'#92400E'},
 {chave:'delegacao i',nome:'Delegação I',ordem:6,cor:'#22C55E',texto:'#FFFFFF',borda:'#14532D'},
 {chave:'delegacao ii',nome:'Delegação II',ordem:7,cor:'#15803D',texto:'#FFFFFF',borda:'#14532D'}
];
const EVO_POR_CHAVE=new Map(STATUS_EVO.map(s=>[s.chave,s]));
const EVO_MAX=STATUS_EVO.length;
/**
 * Status de um período para a ESCALA da evolução mensal.
 *   - presente na hierarquia -> config (cor + ordem; gera ponto);
 *   - vazio/"Não informado"  -> null (SEM ponto; nunca repete o anterior);
 *   - texto fora da escala   -> marcador "Não classificado" no tooltip,
 *     também SEM ponto e SEM inventar posição.
 */
export function statusEvo(status){
 const t=normSt(status);
 if(!t||t==='nao informado')return null;
 const cfg=EVO_POR_CHAVE.get(t);
 if(cfg)return cfg;
 return {chave:'nao-classificado',nome:'Não classificado',ordem:null,cor:'#94A3B8',texto:'#0F172A',borda:'#64748B'};
}
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
 * Evolução MENSAL do Status e do Nível de um diretor: eixo X com os meses
 * REAIS da planilha (JUN/2025 … SET/2026), uma única série cuja LINHA e eixo
 * Y representam o STATUS (hierarquia Acompanhamento…Delegação II, de baixo
 * para cima; a posição superior é a classificação mais avançada). Os pontos
 * usam a cor fixa de cada Status (STATUS_EVO) e o eixo Y é a própria legenda
 * (marcador colorido + nome em texto azul-escuro, sem caixas preenchidas).
 * O NÍVEL do mesmo período aparece sobre cada ponto em algarismo romano
 * (cor única azul-petróleo, sem fundo). Fechamentos trimestrais usam anel
 * externo no marcador (a cor interna continua sendo a do Status) e o rótulo
 * "Nº trimestre de AAAA" abaixo do mês. Status ausente ou fora da
 * hierarquia = quebra na linha (nunca 0, nunca repetido, sem inventar
 * posição); Nível ausente = ponto sem rótulo. Largura e altura responsivas
 * via ResizeObserver (sem barra até MAX_VISIBLE_PERIODS_WITHOUT_SCROLL
 * períodos; gap mínimo de 96px por período somente acima disso) e tooltip
 * próprio em HTML.
 */
export function MonthlyEvolutionChart({periods}){
 const labels=periods||[];
 if(!labels.length)return <p className="chart-empty">Sem períodos para exibir</p>;
  const PAD=36,T=40,B=76,MIN_GAP=96,YAXIS_W=136;
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
 // Escala do STATUS: 1 (Acompanhamento, base) .. EVO_MAX (Delegação II, topo).
 const y=v=>T+(EVO_MAX-v)*(H-T-B)/(EVO_MAX-1);
 // Status vigente de cada mês, resolvido UMA vez pela configuração única.
 const statusDe=labels.map(p=>statusEvo(p?.status));
 // Segmentos: cada trecho liga dois Status válidos consecutivos e usa a cor
 // do Status do mês de DESTINO — a mudança fica evidente pelo encontro das
 // cores. Lacunas (sem Status) interrompem a linha; nada atravessa ausência.
 const runs=[];
 {
  let cur=[];
  labels.forEach((p,i)=>{
   const st=statusDe[i];
   if(st&&st.ordem!=null)cur.push({px:x(i),py:y(st.ordem),st});
   else if(cur.length){runs.push(cur);cur=[];}
  });
  if(cur.length)runs.push(cur);
 }
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
 const linhas=(p,st)=>{
  const out=[periodoExtenso(p.label)];
  // Tooltip mostra SEMPRE o Status completo (nunca número, nunca abreviação):
  // hierarquia -> nome canônico; fora da escala -> "Não classificado";
  // ausente -> "Não informado". O Nível vem EXATAMENTE do mesmo período.
  out.push(`Status: ${st?st.nome:'Não informado'}`);
  const n=p.nivelRoman;
  out.push(`Nível de desenvolvimento: ${n!=null&&ROMANO[n]?ROMANO[n]:'Não informado'}`);
  // Ajuste manual: o valor VIGENTE acima difere do importado da planilha —
  // o original aparece para consulta/auditoria (sem justificativa).
  if(p.ajustado){
   out.push('Origem: Atualizado no sistema');
   const difEstagio=(p.statusOriginal||'')!==(p.status||'');
   const difNivel=p.nivelOriginal!=null&&p.nivelOriginal!==n;
   if(difEstagio||difNivel)out.push(`Original da planilha: ${p.statusOriginal||'—'} · Nível ${ROMANO[p.nivelOriginal]||'—'}`);
  }
  if(p.quarterLabel)out.push(`Fechamento do ${p.quarterLabel}`);
  return out;
 };
 const abre=(e,l)=>setTip({x:e.clientX,y:e.clientY,l});
 const mexe=e=>setTip(t=>t?{...t,x:e.clientX,y:e.clientY}:t);
 const fecha=()=>setTip(null);
 const tipLeft=tip?Math.max(8,Math.min(tip.x+16,((typeof window!=='undefined'&&window.innerWidth)||1200)-300)):8;
  return <div className="chart-evo">
   <div className="chart-frame" ref={frameRef}>
      {/* EIXO Y = LEGENDA: cada Status vira CARD COMPACTO colorido (fundo de
          STATUS_EVO + texto branco) alinhado ao centro da linha da malha. */}
      <svg className="chart-yaxis" viewBox={`0 0 ${YAXIS_W} ${boxH}`} width={YAXIS_W} height={boxH}>{STATUS_EVO.map(s=>{
        const larg=Math.min(YAXIS_W-6,Math.max(72,String(s.nome).length*7.4+24));
        return <g key={s.chave}>
          <rect className="y-card" x={YAXIS_W-6-larg} y={y(s.ordem)-12} width={larg} height={24} rx={8} fill={s.cor}/>
          <text className="y-card-label" x={YAXIS_W-6-larg/2} y={y(s.ordem)+4.5} textAnchor="middle" fill={s.texto} style={{fill:'#FFFFFF'}}>{s.nome}</text>
        </g>;
      })}</svg>
   <div className="chart-scroll" ref={scrollRef} style={{overflowX:comRolagem?'auto':'hidden'}}><svg className="chart-svg line" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{width:comRolagem?W:'100%',height:H}}>
    {STATUS_EVO.map(s=><line key={s.chave} className="chart-grid" x1={PAD-14} y1={y(s.ordem)} x2={W-PAD+14} y2={y(s.ordem)} style={{stroke:s.cor,strokeWidth:1.5,strokeOpacity:.26,strokeLinecap:'round',strokeDasharray:'none'}}/>)}
    {runs.map((run,ri)=><g key={'seg-'+ri}>{run.slice(1).map((pt,k)=>{
       const prev=run[k];
       return <line key={k} className="line-seg" x1={prev.px} y1={prev.py} x2={pt.px} y2={pt.py} style={{stroke:pt.st.cor}}/>;
     })}</g>)}
    {labels.map((p,i)=>{
       const st=statusDe[i];
       // Período sem Status hierarquizado: mês continua no eixo, sem ponto —
       // a linha acima já interrompe o desenho nesse ponto (sem ligar
       // artificialmente dois Status através de uma ausência).
       if(!st||st.ordem==null)return null;
       const tri=!!p.isQuarter;
       const px=x(i),py=y(st.ordem);
       const info=linhas(p,st);
       // Nível do MESMO período em algarismo romano sobre o ponto (cor única
       // azul-petróleo, nunca a do Status). Nível ausente = sem rótulo.
       const rom=p.nivelRoman!=null?ROMANO[p.nivelRoman]:null;
        return <g key={i}>
         {rom&&<text className="val-nivel" x={px} y={py-(tri?30:21)} textAnchor="middle">{rom}</text>}
         {tri&&<circle className="dot-ring" cx={px} cy={py} r={12}/>}
         <circle className="dot dot-status" cx={px} cy={py} r={tri?10:7.5} fill={st.cor} stroke={tri?'#0e2f3b':st.borda} strokeWidth={tri?3:2}/>
        <circle className="dot-hit" cx={px} cy={py} r={tri?15:11}
         onMouseEnter={e=>abre(e,info)} onMouseMove={mexe} onMouseLeave={fecha}/>
       </g>;
     })}
    {labels.map((p,i)=><g key={p.label+i}>
      <text className="x-label" x={x(i)} y={H-44} textAnchor="middle">{p.label}</text>
    </g>)}
    {labels.map((p,i)=><g key={'tri-'+p.label+i}>
      {p.quarterLabel&&(triQuebra[i]
        ? <text className="x-sub" x={x(i)} y={H-28} textAnchor="middle"><tspan x={x(i)} dy="0">{triQuebra[i][0]}</tspan>{triQuebra[i][1]&&<tspan x={x(i)} dy="12">{triQuebra[i][1]}</tspan>}</text>
        : <text className="x-sub" x={x(i)} y={H-16} textAnchor="middle">{p.quarterLabel}</text>)}
    </g>)}
   </svg></div>
   </div>
   {/* Legenda ULTRACOMPACTA: só o anel de fechamento trimestral + uma linha
       discreta explicando o algarismo romano (o Status vive no eixo Y). */}
   <EvolutionLegend/>
   {tip&&<div className="chart-tip" style={{left:tipLeft,top:tip.y}}><b>{tip.l[0]}</b>{tip.l.slice(1).map((t,i)=><span key={i}>{t}</span>)}</div>}
  </div>;
}

// Legenda ULTRACOMPACTA: o Status já é explicado pelas etiquetas do eixo Y e
// o Nível pelos algarismos romanos sobre os pontos — aqui restam só o anel de
// fechamento trimestral e uma linha discreta de apoio (uma única linha).
export function EvolutionLegend(){
 return <div className="status-legend" aria-hidden="true">
   <span className="lg-nota">Algarismo romano sobre o ponto: Nível de desenvolvimento</span>
   <span><i className="lg-quarter"/>Fechamento trimestral</span>
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

