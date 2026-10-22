import React from 'react';

/* =============================================================================
 * FAIXA MENSAL DE NÍVEL — componente AUXILIAR e ISOLADO do gráfico de evolução.
 *
 * Visual somente: mostra, para cada mês já presente no eixo, uma etiqueta
 * azul-petróleo com o NÍVEL de desenvolvimento (romano) do MESMO período,
 * alinhada ao ponto mensal. NÃO cria segunda linha gráfica, NÃO cria ponto
 * extra, NÃO duplica meses e NÃO altera dados persistidos (usa exatamente
 * periods[i].nivelRoman). A cor do Status pertence à linha e aos pontos —
 * nunca a estas etiquetas. Nível ausente => "N/I" (sem repetir valores).
 *
 * PARA DESFAZER esta faixa: apagar este arquivo e remover em Charts.jsx o
 * import e o <NivelBand/> dentro do SVG. A linha do Status e todo o restante
 * do gráfico permanecem intactos.
 * ========================================================================== */

const ROMANO=['','I','II','III','IV','V'];

/**
 * Faixa desenhada DENTRO do mesmo SVG do gráfico (mesmo scroll e mesma escala
 * de x), posicionada entre o rótulo do mês e a identificação trimestral.
 * Props: periods (mesmos períodos do gráfico), x(i) (posição mensal), gap,
 * yTop/altura (retângulo da faixa), info(i) (linhas do tooltip — sempre com
 * Status/Nível do próprio mês, sem repetir valores anteriores) e os
 * handlers de tooltip do gráfico (abre/mexe/fecha).
 */
export default function NivelBand({periods,x,gap,yTop,altura,info,abre,mexe,fecha}){
  const list=periods||[];
  if(!list.length)return null;
  const larg=Math.max(26,Math.min((gap||0)>0?gap-6:56,64));
  // Espaço curto => abreviação compacta ("N III"); nomes completos no tooltip.
  const curto=larg<48;
  return <g className="nivel-band">
    {list.map((p,i)=>{
      const n=p.nivelRoman;
      const rot=(n!=null&&ROMANO[n])?(curto?`N ${ROMANO[n]}`:`Nível ${ROMANO[n]}`):'N/I';
      const px=x(i);
      return <g key={p.label+i} className="nb-cell"
        onMouseEnter={e=>abre(e,info(i))} onMouseMove={mexe} onMouseLeave={fecha}>
        <rect className="nb-band" x={px-larg/2} y={yTop} width={larg} height={altura} rx={4}/>
        <text className="nb-label" x={px} y={yTop+altura/2+3.5} textAnchor="middle">{rot}</text>
      </g>;
    })}
  </g>;
}
