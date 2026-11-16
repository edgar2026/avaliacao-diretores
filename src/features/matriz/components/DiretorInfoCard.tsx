import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import './DiretorInfoCard.css';
import type { InfoCardDiretor } from './infoDiretores.ts';

// ---------------------------------------------------------------------------
// CARD INFORMATIVO DO DIRETORE — renderizado UMA única vez por vez, com
// `position: fixed` (z-index 1200, acima do modal .md-modal z-index 1000).
//
// POSICIONAMENTO (medido no próprio elemento, via getBoundingClientRect):
//   1. à DIREITA do âncora;
//   2. senão, à ESQUERDA;
//   3. senão, ABAIXO (centralizado no âncora);
//   4. senão, ACIMA;
// sempre limitado à interseção do retângulo do .md-dialog (quando existir) e
// da viewport, com padding, e NUNCA sobreposto ao próprio âncora (evita
// flicker de pointerenter/pointerleave). Reposiciona em resize e scroll.
// ---------------------------------------------------------------------------

/** Distância entre o âncora e o card. */
const GAP = 10;
/** Respiro interno das bordas do diálogo/viewport. */
const PAD = 8;

export interface DiretorInfoCardProps {
  /** Elemento âncora (linha do modal ou item de "Aguardando"). */
  anchor: HTMLElement;
  /** Conteúdo montado em memória (mesmo período para Status e Nível). */
  info: InfoCardDiretor;
  diretor: string;
  unidade: string;
  /** Motivo de aguardando (só nas listas "Aguardando classificação"). */
  motivo?: string;
  /** Ref do elemento raiz (usado pelo pai para detectar clique fora). */
  cardRef: RefObject<HTMLDivElement | null>;
  /** Ponteiro entrou no card: cancela o fechamento agendado. */
  onEnter: () => void;
  /** Ponteiro saiu do card: agenda o fechamento com tolerância. */
  onLeave: () => void;
  /** Fecha apenas o informativo (nunca o modal). */
  onClose: () => void;
}

interface Posicao {
  left: number;
  top: number;
}

/** Chave comparável do Status (caixa, acento e espaços ignorados). */
function chaveStatus(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Família de cor do Status — mesma paleta do gráfico de evolução. */
function tomStatus(v: unknown): string {
  const t = chaveStatus(v);
  if (/^supervisao (i|ii)$/.test(t)) return 'st-supervisao';
  if (/^gestao (i|ii)$/.test(t)) return 'st-gestao';
  if (/^delegacao (i|ii)$/.test(t)) return 'st-delegacao';
  return 'st-neutro';
}

export default function DiretorInfoCard({
  anchor,
  info,
  diretor,
  unidade,
  motivo,
  cardRef,
  onEnter,
  onLeave,
  onClose
}: DiretorInfoCardProps) {
  const [pos, setPos] = useState<Posicao | null>(null);

  const reposicionar = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    // Âncora desmontada (modal fechou / lista mudou): fecha só o informativo.
    if (!anchor.isConnected) {
      onClose();
      return;
    }
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    // Interseção: viewport ∩ .md-dialog (quando o âncora está no modal).
    let limEsq = PAD;
    let limDir = window.innerWidth - PAD;
    let limTop = PAD;
    let limBase = window.innerHeight - PAD;
    const dialogo = anchor.closest('.md-dialog');
    if (dialogo) {
      const d = dialogo.getBoundingClientRect();
      limEsq = Math.max(limEsq, d.left + PAD);
      limDir = Math.min(limDir, d.right - PAD);
      limTop = Math.max(limTop, d.top + PAD);
      limBase = Math.min(limBase, d.bottom - PAD);
    }

    const clampX = (v: number) => Math.min(Math.max(v, limEsq), Math.max(limEsq, limDir - w));
    const clampY = (v: number) => Math.min(Math.max(v, limTop), Math.max(limTop, limBase - h));

    let left: number;
    let top: number;
    if (r.right + GAP + w <= limDir) {
      // 1) Direita do âncora.
      left = r.right + GAP;
      top = clampY(r.top);
    } else if (r.left - GAP - w >= limEsq) {
      // 2) Esquerda do âncora.
      left = r.left - GAP - w;
      top = clampY(r.top);
    } else {
      // 3) Abaixo, 4) acima — sempre fora do retângulo do âncora.
      left = clampX(r.left + r.width / 2 - w / 2);
      if (r.bottom + GAP + h <= limBase) top = r.bottom + GAP;
      else if (r.top - GAP - h >= limTop) top = r.top - GAP - h;
      else top = clampY(r.top);
    }

    setPos((atual) => (atual && atual.left === left && atual.top === top ? atual : { left, top }));
  }, [anchor, cardRef, onClose]);

  // Mede antes da pintura: o card nunca aparece "pulando" de (-9999,-9999).
  useLayoutEffect(() => {
    reposicionar();
  }, [reposicionar]);

  // Reposiciona quando a página ou um painel rolam, ou a janela muda de tamanho.
  useEffect(() => {
    const aoMudar = () => reposicionar();
    window.addEventListener('resize', aoMudar, true);
    window.addEventListener('scroll', aoMudar, true);
    return () => {
      window.removeEventListener('resize', aoMudar, true);
      window.removeEventListener('scroll', aoMudar, true);
    };
  }, [reposicionar]);

  return (
    <div
      ref={cardRef}
      id="md-info-card"
      className="md-info-card"
      role="tooltip"
      style={{
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : -9999,
        visibility: pos ? 'visible' : 'hidden'
      }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="md-info-linha">
        <span className="md-info-rotulo">Regional</span>
        <span className="md-info-valor">{info.regional}</span>
      </div>
      <div className="md-info-linha">
        <span className="md-info-rotulo">Diretor</span>
        <span className="md-info-valor md-info-forte">{diretor}</span>
      </div>
      <div className="md-info-linha">
        <span className="md-info-rotulo">Unidade</span>
        <span className="md-info-valor">{unidade}</span>
      </div>
      <div className="md-info-linha">
        <span className="md-info-rotulo">Referência</span>
        <span className="md-info-valor">{info.periodo}</span>
      </div>
      <div className="md-info-linha">
        <span className="md-info-rotulo">Status</span>
        <span className={`md-info-badge md-info-${tomStatus(info.status)}`}>{info.status}</span>
      </div>
      <div className="md-info-linha">
        <span className="md-info-rotulo">Nível</span>
        <span className="md-info-valor md-info-forte">{info.nivel}</span>
      </div>
      {motivo ? (
        <div className="md-info-motivo">
          <span className="md-info-rotulo">Motivo</span>
          <span className="md-info-valor md-info-forte">{motivo}</span>
        </div>
      ) : null}
    </div>
  );
}
