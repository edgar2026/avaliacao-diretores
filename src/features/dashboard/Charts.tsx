import React from 'react';
import { buildRadarSeries } from '../../services/dashboardService.js';
import type { PeriodoGrafico } from '../../types/modelo';
import type { StatusEvoConfig, SetaConfig, TipoMudanca } from '../../types/graficos';

const ROMANO=['','I','II','III','IV','V'];

// ---------------------------------------------------------------------------
// Configuração ÚNICA do Status na evolução mensal: hierarquia vertical, cor de
// fundo (cards do eixo, pontos e segmentos), texto (sempre branco nos cards)
// e contorno. TODA cor/posição do gráfico lê daqui — nenhuma condicional de
// cor espalhada em outros componentes.
// De baixo para cima: Acompanhamento … Delegação II (mais avançado no topo).
// "Reposicionamento" NÃO entra nesta escala (pertence ao Ciclo de Vida).
// ---------------------------------------------------------------------------
const normSt=(s: unknown): string=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
export const STATUS_EVO: StatusEvoConfig[]=[
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
export function statusEvo(status: unknown): StatusEvoConfig | null {
 const t=normSt(status);
 if(!t||t==='nao informado')return null;
 const cfg=EVO_POR_CHAVE.get(t);
 if(cfg)return cfg;
 return {chave:'nao-classificado',nome:'Não classificado',ordem:null,cor:'#94A3B8',texto:'#0F172A',borda:'#64748B'};
}
/**
 * Único indicador mensal de mudança (UM por período, com prioridade):
 *   1. Status mudou na hierarquia (STATUS_EVO)  -> status-up / status-down;
 *   2. Status igual e Nível mudou (I=1 … V=5)   -> level-up  / level-down;
 *   3. Status e Nível iguais                    -> unchanged;
 *   4. Dados insuficientes (Status ou Nível
 *      ausente/fora da escala em qualquer um
 *      dos dois períodos)                       -> indeterminate.
 * Aceita Status por chave/canônico (string) ou pela ordem hierárquica (número).
 * Quando o Status muda, o Nível NUNCA gera indicador próprio (prioridade).
 */
export function getMonthlyChangeIndicator(statusAnterior: unknown,nivelAnterior: unknown,statusAtual: unknown,nivelAtual: unknown): TipoMudanca {
 const ordemDe=(s: unknown): number | null=>{
  if(s==null||s==='')return null;
  if(Number.isFinite(s))return (s as number)>=1&&(s as number)<=EVO_MAX?(s as number):null;
  const cfg=EVO_POR_CHAVE.get(normSt(s));
  return cfg&&cfg.ordem!=null?cfg.ordem:null;
 };
 const oAnt=ordemDe(statusAnterior),oAt=ordemDe(statusAtual);
 const nAnt=Number.isInteger(nivelAnterior)&&!!ROMANO[nivelAnterior as number]?(nivelAnterior as number):null;
 const nAt=Number.isInteger(nivelAtual)&&!!ROMANO[nivelAtual as number]?(nivelAtual as number):null;
 if(oAnt==null||oAt==null||nAnt==null||nAt==null)return 'indeterminate';
 if(oAt>oAnt)return 'status-up';
 if(oAt<oAnt)return 'status-down';
 if(nAt>nAnt)return 'level-up';
 if(nAt<nAnt)return 'level-down';
 return 'unchanged';
}
const MESES_EXT=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const MESES_LONGO=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
// "JUN/2026" -> "Junho de 2026" apenas para exibição no tooltip; o rótulo do
// eixo continua em MES/AAAA e nenhum dado é recalculado.
function periodoExtenso(rotulo: unknown): string {
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

// Indicador de mudança de um mês (comparação com o último período válido
// completo anterior).
interface IndicadorMes {
 kind: TipoMudanca;
 deSt: string | null;
 paraSt: string | null;
 deN: string | null;
 paraN: string | null;
}

// Tooltip do gráfico: linhas de texto ancoradas no cursor.
interface TooltipEvo {
 x: number;
 y: number;
 l: string[];
}

interface MonthlyEvolutionChartLocalProps {
 periods: PeriodoGrafico[];
 series?: unknown;
}

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
export function MonthlyEvolutionChart({periods}: MonthlyEvolutionChartLocalProps){
 const labels=periods||[];
 if(!labels.length)return <p className="chart-empty">Sem períodos para exibir</p>;
  // T=52: zona de SEGURANÇA acima da linha de Delegação II (≈52px até o topo
  // do SVG) para algarismo romano, palavra "Nível", indicador de mudança e
  // anel trimestral sem corte — para QUALQUER diretor que alcance o topo.
  const PAD=36,T=52,B=76,MIN_GAP=96,YAXIS_W=136;
 const scrollRef=React.useRef<HTMLDivElement|null>(null);
 const frameRef=React.useRef<HTMLDivElement|null>(null);
 const [availW,setAvailW]=React.useState(PAD*2+MIN_GAP*Math.max(0,labels.length-1));
 // boxH = altura do card (eixo Y); plotH = altura útil do desenho, já
 // descontando a barra de rolagem horizontal quando ela aparece.
  const [boxH,setBoxH]=React.useState(296);
  const [plotH,setPlotH]=React.useState(296);
  const [tip,setTip]=React.useState<TooltipEvo|null>(null);
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
 const x=(i: number)=>PAD+i*gap;
 // Escala do STATUS: 1 (Acompanhamento, base) .. EVO_MAX (Delegação II, topo).
 const y=(v: number)=>T+(EVO_MAX-v)*(H-T-B)/(EVO_MAX-1);
  // Status vigente de cada mês, resolvido UMA vez pela configuração única.
  const statusDe=labels.map(p=>statusEvo(p?.status));
  // Indicador de mudança (UM por mês, prioridade Status > Nível > Não alterou):
  // compara com o último período anterior que possua Status hierarquizado E
  // Nível válidos. Lacunas (sem Status ou sem Nível) não geram indicador nem
  // valor artificial; após a lacuna, a comparação usa o último período válido
  // completo anterior. Primeiro período válido = sem indicador.
  const indicadores: (IndicadorMes | null)[]=[];
  {
   let ult: { st: StatusEvoConfig; n: number } | null = null; // {st, n} do último período com Status E Nível válidos
   labels.forEach((p,i)=>{
    const st=statusDe[i];
    const temSt=!!(st&&st.ordem!=null);
    const n=p?.nivelRoman;
    const temNivel=Number.isInteger(n)&&!!ROMANO[n as number];
    if(!temSt||!temNivel){indicadores[i]=null;return;}
    let kind: TipoMudanca='indeterminate',deSt=null,paraSt=null,deN=null,paraN=null;
    if(ult){
     kind=getMonthlyChangeIndicator(ult.st.chave,ult.n,(st as StatusEvoConfig).chave,n);
     deSt=ult.st.nome;paraSt=(st as StatusEvoConfig).nome;deN=ROMANO[ult.n];paraN=ROMANO[n as number];
    }
    indicadores[i]={kind,deSt,paraSt,deN,paraN};
    ult={st:st as StatusEvoConfig,n:n as number};
   });
  }
  // Símbolo de CADA indicador (nunca mais de um por mês). A COR vive SOMENTE
  // no CSS (.val-nivel-seta.up/.down/.same → variáveis --evo-* compartilhadas
  // com a legenda inferior) — aqui entra apenas a classe correspondente.
  const SETA_IND: Partial<Record<TipoMudanca, SetaConfig>>={
   'status-up':{s:'↑↑',classe:'up'},
   'status-down':{s:'↓↓',classe:'down'},
   'level-up':{s:'↑',classe:'up'},
   'level-down':{s:'↓',classe:'down'},
   'unchanged':{s:'↔',classe:'same'}
  };
 // Segmentos: cada trecho liga dois Status válidos consecutivos e usa a cor
 // do Status do mês de DESTINO — a mudança fica evidente pelo encontro das
 // cores. Lacunas (sem Status) interrompem a linha; nada atravessa ausência.
 const runs: { px: number; py: number; st: StatusEvoConfig }[][]=[];
 {
  let cur: { px: number; py: number; st: StatusEvoConfig }[]=[];
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
 const idxTri=labels.reduce<number[]>((a,p,i)=>{if(p.quarterLabel)a.push(i);return a},[]);
 const triQuebra: Record<number, string[] | null>={};
 const larguraTxt=(txt: unknown)=>String(txt||'').length*6.4;
 idxTri.forEach((i,k)=>{
   const texto=labels[i].quarterLabel;
   const espacoEsq=k===0?x(i):(x(i)-x(idxTri[k-1]))/2;
   const espacoDir=k===idxTri.length-1?(W-x(i)):(x(idxTri[k+1])-x(i))/2;
   const espaco=Math.max(20,Math.min(espacoEsq,espacoDir));
   if(larguraTxt(texto)/2<=espaco){triQuebra[i]=null;return;}
   const corte=String(texto).lastIndexOf(' de ');
   triQuebra[i]=corte>0?[String(texto).slice(0,corte),String(texto).slice(corte+1)]:[String(texto)];
 });
  const linhas=(p: PeriodoGrafico,st: StatusEvoConfig | null,i: number): string[]=>{
   const out=[periodoExtenso(p.label)];
   // Tooltip mostra SEMPRE o Status completo (nunca número, nunca abreviação):
   // hierarquia -> nome canônico; fora da escala -> "Não classificado";
   // ausente -> "Não informado". O Nível vem EXATAMENTE do mesmo período.
   out.push(`Status: ${st?st.nome:'Não informado'}`);
   const n=p.nivelRoman;
   out.push(`Nível de desenvolvimento: ${n!=null&&ROMANO[n]?ROMANO[n]:'Não informado'}`);
   // Indicador do mês (UM só resultado, mesma regra do gráfico):
   //   Status mudou -> "Status: A → B" + "Resultado: Status subiu/desceu";
   //   só Nível mudou -> "Nível: A → B" + "Resultado: Nível subiu/desceu";
   //   nada mudou -> "Status e Nível permaneceram iguais" + "Resultado: Não alterou".
   const ind=indicadores[i];
   if(ind&&ind.kind!=='indeterminate'){
    if(ind.kind==='status-up'||ind.kind==='status-down'){
     out[1]=`Status: ${ind.deSt} → ${ind.paraSt}`;
     out.push(`Resultado: ${ind.kind==='status-up'?'Status subiu':'Status desceu'}`);
    }else if(ind.kind==='level-up'||ind.kind==='level-down'){
     out.push(`Nível: ${ind.deN} → ${ind.paraN}`);
     out.push(`Resultado: ${ind.kind==='level-up'?'Nível subiu':'Nível desceu'}`);
    }else{
     out.push('Status e Nível permaneceram iguais');
     out.push('Resultado: Não alterou');
    }
   }
  // Ajuste manual: o valor VIGENTE acima difere do importado da planilha —
  // o original aparece para consulta/auditoria (sem justificativa).
  if(p.ajustado){
   out.push('Origem: Atualizado no sistema');
   const difEstagio=(p.statusOriginal||'')!==(p.status||'');
   const difNivel=p.nivelOriginal!=null&&p.nivelOriginal!==n;
   if(difEstagio||difNivel)out.push(`Original da planilha: ${p.statusOriginal||'—'} · Nível ${ROMANO[p.nivelOriginal as number]||'—'}`);
  }
  if(p.quarterLabel)out.push(`Fechamento do ${p.quarterLabel}`);
  return out;
 };
 const abre=(e: React.MouseEvent,l: string[])=>setTip({x:e.clientX,y:e.clientY,l});
 const mexe=(e: React.MouseEvent)=>setTip(t=>t?{...t,x:e.clientX,y:e.clientY}:t);
 const fecha=()=>setTip(null);
 const tipLeft=tip?Math.max(8,Math.min(tip.x+16,((typeof window!=='undefined'&&window.innerWidth)||1200)-300)):8;
  return <div className="chart-evo">
   <div className="chart-frame" ref={frameRef}>
      {/* EIXO Y = LEGENDA: cada Status vira CARD COMPACTO colorido (fundo de
          STATUS_EVO + texto branco) alinhado ao centro da linha da malha. */}
      <svg className="chart-yaxis" viewBox={`0 0 ${YAXIS_W} ${boxH}`} width={YAXIS_W} height={boxH}>{STATUS_EVO.map(s=>{
        const larg=Math.min(YAXIS_W-6,Math.max(72,String(s.nome).length*7.4+24));
        return <g key={s.chave}>
          <rect className="y-card" x={YAXIS_W-6-larg} y={y(s.ordem as number)-12} width={larg} height={24} rx={8} fill={s.cor}/>
          <text className="y-card-label" x={YAXIS_W-6-larg/2} y={y(s.ordem as number)+4.5} textAnchor="middle" fill={s.texto} style={{fill:'#FFFFFF'}}>{s.nome}</text>
        </g>;
      })}</svg>
   <div className="chart-scroll" ref={scrollRef} style={{overflowX:comRolagem?'auto':'hidden'}}><svg className="chart-svg line" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{width:comRolagem?W:'100%',height:H}}>
    {STATUS_EVO.map(s=><line key={s.chave} className="chart-grid" x1={PAD-14} y1={y(s.ordem as number)} x2={W-PAD+14} y2={y(s.ordem as number)} style={{stroke:s.cor,strokeWidth:1.5,strokeOpacity:.26,strokeLinecap:'round',strokeDasharray:'none'}}/>)}
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
        const info=linhas(p,st,i);
         // Nível do MESMO período em DUAS linhas sobre o ponto: algarismo romano
         // na primeira linha e a palavra "Nível" logo abaixo (ambas acima do
         // marcador; cor azul-petróleo, nunca a do Status). Nível ausente = nenhum
         // dos dois rótulos (nunca zero, nunca "Não informado" sobre o ponto).
         const rom=p.nivelRoman!=null?ROMANO[p.nivelRoman]:null;
         // UM único indicador de mudança ao lado do algarismo romano (Status
         // prioriza Nível; sem indicador = primeiro período ou lacuna). Somente
         // o símbolo recebe a cor verde/vermelha/azul; numeral, palavra "Nível",
         // ponto, linha e Status permanecem intactos.
         const ind=indicadores[i];
         const seta=ind?SETA_IND[ind.kind]:null;
         // Altura levemente alternada nos meses seguidos para o conjunto não
         // encostar no rótulo vizinho, mantendo o deslocamento sobre o ponto.
         const alt=tri?0:(i%2?4:0);
         const yRom=py-(tri?32:28)-alt;
         const yPal=py-(tri?20:16)-alt;
         return <g key={i}>
         {rom&&<text className="val-nivel" x={px} y={yRom} textAnchor="middle">{rom}</text>}
         {rom&&seta&&<text className={`val-nivel-seta ${seta.classe}`} x={px+rom.length*3.5+3} y={yRom} textAnchor="start">{seta.s}</text>}
         {rom&&<text className="val-nivel-word" x={px} y={yPal} textAnchor="middle">Nível</text>}
         {tri&&<circle className="dot-ring" cx={px} cy={py} r={12}/>}
         <circle className="dot dot-status" cx={px} cy={py} r={tri?10:7.5} fill={st.cor} style={{fill:st.cor}} stroke={tri?'#0e2f3b':st.borda} strokeWidth={tri?3:2}/>
        <circle className="dot-hit" cx={px} cy={py} r={tri?15:11}
         onMouseEnter={e=>abre(e,info)} onMouseMove={mexe} onMouseLeave={fecha}/>
      </g>;
     })}
    {/* Eixo X em DUAS linhas: MÊS acima e ANO abaixo, cada período com seu
        próprio texto centralizado no ponto (nunca texto corrido nem ano com
        dois dígitos). O valor armazenado do período permanece intacto. */}
    {labels.map((p,i)=>{
      const txt=String(p.label||'');
      const corte=txt.indexOf('/');
      const mes=corte>0?txt.slice(0,corte):txt;
      const ano=corte>0?txt.slice(corte+1):'';
      return <g key={p.label+i}>
        <text className="x-label" x={x(i)} y={H-52} textAnchor="middle">{mes}</text>
        {ano&&<text className="x-ano" x={x(i)} y={H-36} textAnchor="middle">{ano}</text>}
      </g>;
    })}
    {labels.map((p,i)=><g key={'tri-'+p.label+i}>
      {p.quarterLabel&&(triQuebra[i]
        ? <text className="x-sub" x={x(i)} y={H-23} textAnchor="middle"><tspan x={x(i)} dy="0">{triQuebra[i][0]}</tspan>{triQuebra[i][1]&&<tspan x={x(i)} dy="12">{triQuebra[i][1]}</tspan>}</text>
        : <text className="x-sub" x={x(i)} y={H-19} textAnchor="middle">{p.quarterLabel}</text>)}
    </g>)}
   </svg></div>
   </div>
   {/* Legenda ULTRACOMPACTA: só o anel de fechamento trimestral + uma linha
       discreta explicando o algarismo romano (o Status vive no eixo Y). */}
   <EvolutionLegend/>
   {tip&&<div className="chart-tip" style={{left:tipLeft,top:tip.y}}><b>{tip.l[0]}</b>{tip.l.slice(1).map((t,i)=><span key={i}>{t}</span>)}</div>}
  </div>;
}

// Legenda dos CINCO indicadores de mudança (Status e Nível diferenciados) +
// anel de fechamento trimestral. Uma única linha quando cabe; quebra
// responsiva natural quando não cabe (flex-wrap).
export function EvolutionLegend(){
 return <div className="status-legend" aria-hidden="true">
   <span><b className="lg-seta lg-up">↑</b> Nível subiu</span>
   <span><b className="lg-seta lg-down">↓</b> Nível desceu</span>
   <span><b className="lg-seta lg-up">↑↑</b> Status subiu</span>
   <span><b className="lg-seta lg-down">↓↓</b> Status desceu</span>
   <span><b className="lg-seta lg-same">↔</b> Não alterou</span>
   <span><i className="lg-quarter"/>Fechamento trimestral</span>
 </div>;
}
const names=['Presencial','Acadêmico','Pós-graduação','Nota geral','Avaliação institucional','Ritmo de captação','Crescimento de matrículas','Evasão','EBITDA'];
// Normaliza para a escala 0..1 do radar. Indicador AUSENTE permanece `null`
// (nunca vira 0: zero seria lido como desempenho péssimo no eixo).
function normalized(name: string,v: number | null | undefined): number | null {if(v==null||!Number.isFinite(v))return null;if(['Presencial','Acadêmico','Pós-graduação','Nota geral','Avaliação institucional'].includes(name))return Math.max(0,Math.min(1,v/5));if(name==='Evasão')return Math.max(0,Math.min(1,1-v/.3));return Math.max(0,Math.min(1,(v+.5)));}

interface RadarChartLocalProps {
 records: readonly unknown[];
 allRecords?: readonly unknown[];
}

export function RadarChart({records,allRecords}: RadarChartLocalProps){
 // Os registros vêm do modelo do Supabase (`metricas`); o acesso aos
 // indicadores passa por `buildRadarSeries`/`recordMetric`, que convertem os
 // nomes e protegem registro/propriedade ausente. Sem nenhum indicador
 // disponível, exibe "Indicadores não disponíveis" no lugar do radar.
 const radar=buildRadarSeries(records,allRecords,names) as { disponivel: boolean; nomes: string[]; sel: (number | null)[]; all: (number | null)[] };
 if(!radar.disponivel)return <p className="chart-empty">Indicadores não disponíveis</p>;
 const N=radar.nomes.length,W=760,H=440,cx=380,cy=220,r=180;
 const point=(i: number,f: number): [number, number]=>{const a=-Math.PI/2+i*2*Math.PI/N;return [cx+Math.cos(a)*r*f,cy+Math.sin(a)*r*f]};
 const poly=(vals: (number | null)[]): string=>vals.map((v,i)=>{const f=normalized(radar.nomes[i],v);return f==null?null:point(i,f)}).filter(Boolean).map(p=>(p as [number, number]).join(',')).join(' ');
 const selPts=poly(radar.sel),allPts=poly(radar.all);
 return <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg radar">{[.25,.5,.75,1].map(q=><polygon key={q} points={Array.from({length:N},(_,i)=>point(i,q).join(',')).join(' ')}/>)}{radar.nomes.map((n,i)=>{const p=point(i,1),l=point(i,1.18);return <g key={n}><line x1={cx} y1={cy} x2={p[0]} y2={p[1]}/><text x={l[0]} y={l[1]} textAnchor="middle">{n.replace('Crescimento de matrículas','Cresc. matrículas').replace('Avaliação institucional','Aval. institucional')}</text></g>})}{allPts&&<polygon className="radar-all" points={allPts}/>}<polygon className="radar-sel" points={selPts}/></svg>
}
