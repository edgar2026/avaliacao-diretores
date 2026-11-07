import React from 'react';
import ErrorBoundary from '../../components/ErrorBoundary.tsx';
import { MonthlyEvolutionChart } from './Charts.tsx';
import type { ItemEvolucaoPdf } from '../../services/evolucaoPdfService.ts';

/* Área de CAPTURA isolada do PDF da evolução: renderiza FORA da tela o MESMO
   componente exibido na aplicação (MonthlyEvolutionChart) com os dados de UM
   diretor, para o html2canvas fotografar em alta resolução.

   - Não altera os filtros nem a seleção visível da página principal (nada é
     “trocado rapidamente” na tela do usuário);
   - o botão “Editar” NÃO é renderizado aqui — ele continua existindo na
     aplicação; no PDF o subcard mantém apenas Período, Status, Nível e (quando
     houver) a origem “Atualizado no sistema”, sem espaço vazio;
   - diretor sem períodos válidos: página com título, nome e unidade + a
     mensagem aprovada (não inventa linha e não interrompe o lote). */
interface CapturaEvolucaoPdfProps {
  item: ItemEvolucaoPdf;
  largura: number;
  captureRef: React.RefObject<HTMLDivElement | null>;
  /** Índice da página no lote — o motor da exportação usa data-indice para
      confirmar que a área isolada já foi renderizada com ESTE diretor. */
  indice: number;
}

export default function CapturaEvolucaoPdf({ item, largura, captureRef, indice }: CapturaEvolucaoPdfProps){
  const resumo = item.resumo;
  const estilo = (item.estilo || null) as React.CSSProperties | null;
  return <div className="pdf-capture" ref={captureRef} data-indice={indice} style={{ width: largura }} aria-hidden="true">
    <section className="card evolution-card">
      <div className="ev-topo">
        <div className="ev-textos">
          <h2>Evolução mensal do Status e do Nível</h2>
          <div className="ev-diretor">
            <div className="ev-diretor-linha"><b>Diretor:</b> <span className="ev-diretor-nome">{item.diretor}</span></div>
            <div className="ev-diretor-linha"><b>Unidade:</b> <span className="ev-diretor-unidade">{item.unidades.join(' · ') || 'Não informado'}</span></div>
          </div>
        </div>
        {resumo&&<div className="ev-resumo" style={estilo}>
          <div className="ev-linha"><b>Período:</b> <span className="ev-valor">{resumo.periodo||'Não informado'}</span></div>
          <div className="ev-linha ev-linha-sn">
            <span className="ev-par"><b>Status:</b> <span className="ev-badge">{resumo.status||'Não informado'}</span></span>
            <span className="ev-par"><b>Nível:</b> <span className="ev-nivel">{resumo.nivel||'Não informado'}</span></span>
          </div>
          {resumo.ajustado&&<div className="ev-linha ev-linha-acoes"><div className="ev-ajuste">Atualizado no sistema</div></div>}
        </div>}
      </div>
      <div className="chart">
        <ErrorBoundary titulo="Não foi possível desenhar o gráfico de evolução">
          {item.evolution
            ? <MonthlyEvolutionChart periods={item.evolution.periods} series={item.evolution.series}/>
            : <p className="chart-empty">Não existem períodos válidos para gerar a evolução deste diretor.</p>}
        </ErrorBoundary>
      </div>
    </section>
  </div>;
}
