import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import './MatrizesDiretores.css';
import DiretorInfoCard from './DiretorInfoCard.tsx';
import { normalizarChave } from '../../../services/classificacaoMatrizService.ts';
import type { InfoCardDiretor } from './infoDiretores.ts';

export type MatrixType = 'ninebox' | 'risk';

export interface MatrixDirector {
  id: string;
  name: string;
  unit: string;
  /** Origem da posição exibida: automática (motor) ou manual vigente. */
  origem?: 'automatica' | 'manual';
  /** Identificação discreta da origem (tooltip) — sem alterar o visual. */
  origemDetalhe?: string;
}

export interface MatrixMove {
  id: string;
  type: MatrixType;
  directorId: string;
  directorName: string;
  fromIndex: number;
  toIndex: number;
  fromLabel: string;
  toLabel: string;
  movedAt: string;
  color: ColorClass;
}

export interface MatrixData {
  ninebox: MatrixDirector[][];
  risk: MatrixDirector[][];
}

// Diretores sem regra aplicável no motor de classificação automática —
// exibidos no bloco "Aguardando classificação" de cada matriz.
export interface MatrizesAguardando {
  ninebox: MatrixDirector[];
  risk: MatrixDirector[];
}

export interface MatrizesDiretoresProps {
  initialData?: MatrixData;
  aguardando?: MatrizesAguardando | null;
  /** Conteúdo do card informativo por diretor (chave = nome normalizado). */
  infoCards?: ReadonlyMap<string, InfoCardDiretor> | null;
  selectedDirector?: string;
  storageKey?: string;
  persistLocally?: boolean;
  onDirectorMove?: (move: MatrixMove, nextData: MatrixData) => void | Promise<void>;
  className?: string;
}

export type ColorClass = 'diamond' | 'green-light' | 'green' | 'orange' | 'yellow' | 'red';

interface NineMeta {
  label: string;
  color: ColorClass;
  potential: 'Alto' | 'Médio' | 'Baixo';
  performance: 'Abaixo do esperado' | 'Esperado' | 'Acima do esperado';
}

const NINE_META: NineMeta[] = [
  { label: 'DIAMANTE BRUTO', color: 'diamond', potential: 'Alto', performance: 'Abaixo do esperado' },
  { label: 'FORTE DESEMPENHO', color: 'green-light', potential: 'Alto', performance: 'Esperado' },
  { label: 'ALTO POTENCIAL', color: 'green', potential: 'Alto', performance: 'Acima do esperado' },
  { label: 'QUESTIONÁVEL', color: 'orange', potential: 'Médio', performance: 'Abaixo do esperado' },
  { label: 'MANTENEDOR', color: 'yellow', potential: 'Médio', performance: 'Esperado' },
  { label: 'FORTE DESEMPENHO', color: 'green-light', potential: 'Médio', performance: 'Acima do esperado' },
  { label: 'INSUFICIENTE', color: 'red', potential: 'Baixo', performance: 'Abaixo do esperado' },
  { label: 'EFICAZ', color: 'orange', potential: 'Baixo', performance: 'Esperado' },
  { label: 'COMPROMETIDO', color: 'yellow', potential: 'Baixo', performance: 'Acima do esperado' },
];

const RISK_COLORS: ColorClass[] = [
  'yellow', 'orange', 'red', 'red',
  'green-light', 'yellow', 'orange', 'red',
  'green', 'green-light', 'diamond', 'orange',
  'green', 'green', 'green-light', 'diamond',
];

const RISK_Y = ['Altíssimo', 'Alto', 'Médio', 'Baixo'] as const;
const RISK_X = ['Baixo', 'Médio', 'Alto', 'Altíssimo'] as const;

// Matrizes vazias: a distribuição vem EXCLUSIVAMENTE do motor de classificação
// automática (initialData). Nenhum dado fictício é criado aqui.
function buildEmptyMatrixData(): MatrixData {
  return {
    ninebox: Array.from({ length: 9 }, () => []),
    risk: Array.from({ length: 16 }, () => []),
  };
}

function cloneData(data: MatrixData): MatrixData {
  return {
    ninebox: data.ninebox.map((group) => group.map((director) => ({ ...director }))),
    risk: data.risk.map((group) => group.map((director) => ({ ...director }))),
  };
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

function formatDateTime(date = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function matrixKey(type: MatrixType): keyof MatrixData {
  return type === 'ninebox' ? 'ninebox' : 'risk';
}

function titleFor(type: MatrixType, index: number): string {
  if (type === 'ninebox') {
    const item = NINE_META[index];
    return `${item.label} • Potencial ${item.potential} • Desempenho ${item.performance}`;
  }
  return `Risco ${RISK_Y[Math.floor(index / 4)]} • Dano ${RISK_X[index % 4]}`;
}

/**
 * Rótulo CURTO da célula (ex.: "QUESTIONÁVEL", "Risco Alto • Dano Alto") —
 * usado na identificação da origem (automática/manual) fora do componente.
 */
export function rotuloCelula(type: MatrixType, index: number): string {
  if (type === 'ninebox') return NINE_META[index]?.label || '';
  return `Risco ${RISK_Y[Math.floor(index / 4)]} • Dano ${RISK_X[index % 4]}`;
}

function colorFor(type: MatrixType, index: number): ColorClass {
  return type === 'ninebox' ? NINE_META[index].color : RISK_COLORS[index];
}

export default function MatrizesDiretores({
  initialData,
  aguardando = null,
  infoCards = null,
  selectedDirector = '',
  storageKey = 'matrizesDiretoresV12HistoricoAmpliado',
  persistLocally = false,
  onDirectorMove,
  className = '',
}: MatrizesDiretoresProps) {
  const [data, setData] = useState<MatrixData>(() => {
    if (initialData) return cloneData(initialData);
    if (persistLocally) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) return JSON.parse(raw) as MatrixData;
      } catch {
        // Fallback
      }
    }
    return buildEmptyMatrixData();
  });

  const [modal, setModal] = useState<{ type: MatrixType; sourceIndex: number } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [history, setHistory] = useState<MatrixMove[]>([]);
  const [success, setSuccess] = useState('');

  // ---------------------------------------------------------------------------
  // CARD INFORMATIVO DO DIRETORE (hover / foco / toque) — UM por vez.
  // Abre com 250 ms de tolerância, fecha com 140 ms (para o ponteiro viajar do
  // âncora até o card sem sumir), fecha ao iniciar arraste, ao fechar o modal,
  // em clique fora e em Escape (só o informativo — o modal permanece).
  // ---------------------------------------------------------------------------
  interface InfoDiretorAberta {
    anchor: HTMLElement;
    chave: string;
    origem: string;
    diretor: string;
    unidade: string;
  }

  const [infoAberta, setInfoAberta] = useState<InfoDiretorAberta | null>(null);
  const infoTimerRef = useRef<number | null>(null);
  const saiTimerRef = useRef<number | null>(null);
  const toqueRef = useRef(0);
  const ponteiroBaixoRef = useRef(0);
  const infoCardRef = useRef<HTMLDivElement | null>(null);

  const limparTimersInfo = useCallback(() => {
    if (infoTimerRef.current != null) {
      window.clearTimeout(infoTimerRef.current);
      infoTimerRef.current = null;
    }
    if (saiTimerRef.current != null) {
      window.clearTimeout(saiTimerRef.current);
      saiTimerRef.current = null;
    }
  }, []);

  const fecharInfo = useCallback(() => {
    limparTimersInfo();
    setInfoAberta(null);
  }, [limparTimersInfo]);

  const abrirInfo = useCallback(
    (anchor: HTMLElement, origem: string, person: MatrixDirector) => {
      const chave = normalizarChave(person.name);
      if (!infoCards?.get(chave)) return;
      setInfoAberta((atual) =>
        atual && atual.anchor === anchor
          ? atual
          : { anchor, chave, origem, diretor: person.name, unidade: person.unit }
      );
    },
    [infoCards]
  );

  const agendarInfo = useCallback(
    (anchor: HTMLElement, origem: string, person: MatrixDirector) => {
      limparTimersInfo();
      infoTimerRef.current = window.setTimeout(() => {
        infoTimerRef.current = null;
        abrirInfo(anchor, origem, person);
      }, 250);
    },
    [abrirInfo, limparTimersInfo]
  );

  const agendarSaidaInfo = useCallback(() => {
    limparTimersInfo();
    saiTimerRef.current = window.setTimeout(() => {
      saiTimerRef.current = null;
      setInfoAberta(null);
    }, 140);
  }, [limparTimersInfo]);

  // Ponteiro baixado: o click (que alterna/abre) ou o arraste decide — o foco
  // gerado pelo mousedown não abre o card na hora (evita "flash" ao arrastar).
  const aoBaixarInfo = (event: ReactPointerEvent<HTMLElement>) => {
    ponteiroBaixoRef.current = Date.now();
    if (event.pointerType !== 'touch') return;
    toqueRef.current = Date.now();
  };

  // Hover (mouse/pen): abre após 250 ms. Toque não abre aqui (o click decide).
  const aoEntrarInfo = (
    event: ReactPointerEvent<HTMLElement>,
    origem: string,
    person: MatrixDirector
  ) => {
    if (event.pointerType === 'touch') return;
    agendarInfo(event.currentTarget, origem, person);
  };

  const aoSairInfo = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    agendarSaidaInfo();
  };

  // Foco de teclado abre na hora; foco gerado por toque ou por mousedown fica
  // para o click decidir (alternar/abrir) — e nunca abre durante um arraste.
  const aoFocarInfo = (
    event: ReactFocusEvent<HTMLElement>,
    origem: string,
    person: MatrixDirector
  ) => {
    const agora = Date.now();
    if (agora - toqueRef.current < 700) return;
    if (agora - ponteiroBaixoRef.current < 700) return;
    limparTimersInfo();
    abrirInfo(event.currentTarget, origem, person);
  };

  const aoDesfocarInfo = (event: ReactFocusEvent<HTMLElement>) => {
    if (infoAberta?.anchor === event.currentTarget) fecharInfo();
  };

  // Toque curto alterna (abre/fecha); clique de mouse sempre garante o card
  // aberto na linha clicada (foco já terá aberto — aqui é só o reforço).
  const aoClicarInfo = (
    event: ReactMouseEvent<HTMLElement>,
    origem: string,
    person: MatrixDirector
  ) => {
    const anchor = event.currentTarget;
    const toqueRecente = Date.now() - toqueRef.current <= 700;
    if (toqueRecente && infoAberta?.anchor === anchor) {
      fecharInfo();
      return;
    }
    limparTimersInfo();
    abrirInfo(anchor, origem, person);
  };

  // Motivo exibido: só nas listas "Aguardando" e POR MATRIZ (ninebox/risk).
  const motivoDe = (chave: string, origem: string): string | undefined => {
    if (origem === 'mov') return undefined;
    const info = infoCards?.get(chave);
    if (!info) return undefined;
    return origem === 'ninebox' ? info.motivoNinebox : info.motivoRisco;
  };

  // Clique fora do âncora e fora do card fecha o informativo (essencial no
  // fluxo por toque, onde não existe pointerleave permanente).
  useEffect(() => {
    if (!infoAberta) return;
    const aoClique = (event: MouseEvent) => {
      const alvo = event.target as Node | null;
      if (alvo && (infoAberta.anchor.contains(alvo) || infoCardRef.current?.contains(alvo))) return;
      fecharInfo();
    };
    document.addEventListener('click', aoClique, true);
    return () => document.removeEventListener('click', aoClique, true);
  }, [infoAberta, fecharInfo]);

  // Card só permanece enquanto o diretor existir nos dados em memória.
  useEffect(() => {
    if (infoAberta && !infoCards?.get(infoAberta.chave)) fecharInfo();
  }, [infoAberta, infoCards, fecharInfo]);

  // Se a LINHA âncora sair do DOM (lista refeita, filtro, movimentação), o
  // informativo é encerrado — nunca fica "solto" apontando para um elemento
  // desmontado.
  useEffect(() => {
    if (infoAberta && !infoAberta.anchor.isConnected) fecharInfo();
  });

  // Ao trocar/fechar o modal, o informativo é encerrado junto.
  useEffect(() => {
    fecharInfo();
  }, [modal, fecharInfo]);

  useEffect(() => () => limparTimersInfo(), [limparTimersInfo]);

  // Atualiza quando a distribuição do motor de classificação automática muda
  // (dados novos, ajuste de Status/Nível ou filtro lateral).
  useEffect(() => {
    if (initialData) {
      setData(cloneData(initialData));
    }
  }, [initialData]);

  // Diretores sem regra aplicável (leitura; não participam do arrastar e soltar).
  const aguardandoNinebox = aguardando?.ninebox || [];
  const aguardandoRisco = aguardando?.risk || [];

  useEffect(() => {
    if (persistLocally) {
      localStorage.setItem(storageKey, JSON.stringify(data));
    }
  }, [data, persistLocally, storageKey]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape fecha PRIMEIRO o card informativo; o modal só fecha se não
      // houver informativo aberto.
      if (infoAberta) {
        fecharInfo();
        return;
      }
      setModal(null);
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [infoAberta, fecharInfo]);

  const openMove = useCallback((type: MatrixType, sourceIndex: number) => {
    setSuccess('');
    setModal({ type, sourceIndex });
  }, []);

  const currentSource = useMemo(() => {
    if (!modal) return [];
    return data[matrixKey(modal.type)][modal.sourceIndex] || [];
  }, [modal, data]);

  const currentHistory = useMemo(() => {
    if (!modal) return [];
    return history.filter((item) => item.type === modal.type).slice(0, 8);
  }, [history, modal]);

  const moveDirector = useCallback(
    async (toIndex: number) => {
      if (!modal || !draggedId || toIndex === modal.sourceIndex) return;

      const key = matrixKey(modal.type);
      const nextData = cloneData(data);
      const source = nextData[key][modal.sourceIndex];
      const position = source.findIndex((d) => d.id === draggedId);
      if (position < 0) return;

      const [director] = source.splice(position, 1);
      nextData[key][toIndex].push(director);

      const toColor = colorFor(modal.type, toIndex);
      const fromLabel = titleFor(modal.type, modal.sourceIndex);
      const toLabel = titleFor(modal.type, toIndex);

      const move: MatrixMove = {
        id: `${modal.type}-${director.id}-${Date.now()}`,
        type: modal.type,
        directorId: director.id,
        directorName: director.name,
        fromIndex: modal.sourceIndex,
        toIndex,
        fromLabel,
        toLabel,
        movedAt: formatDateTime(),
        color: toColor,
      };

      setData(nextData);
      setHistory((current) => [move, ...current].slice(0, 50));
      setDraggedId(null);
      setDragOverIndex(null);
      setSuccess(`${director.name} foi movido para ${toLabel}.`);
      await onDirectorMove?.(move, nextData);
    },
    [data, draggedId, modal, onDirectorMove],
  );

  const clearHistory = useCallback(() => {
    if (!modal) return;
    setHistory((items) => items.filter((item) => item.type !== modal.type));
  }, [modal]);

  const hasSelectedDirector = useCallback(
    (people: MatrixDirector[]) => {
      if (!selectedDirector) return false;
      return people.some((p) => p.name.toLowerCase() === selectedDirector.toLowerCase());
    },
    [selectedDirector],
  );

  const renderPeople = (people: MatrixDirector[]) => (
    <div className="md-people">
      <div className="md-avatars">
        {people.slice(0, 3).map((person) => {
          const isSel = selectedDirector && person.name.toLowerCase() === selectedDirector.toLowerCase();
          return (
            <div
              className={`md-avatar ${isSel ? 'md-highlighted' : ''}`}
              title={[`${person.name} • ${person.unit}`, person.origemDetalhe].filter(Boolean).join('\n')}
              data-origem={person.origem || 'automatica'}
              key={person.id}
            >
              {initials(person.name)}
            </div>
          );
        })}
      </div>
      <div className="md-count">+ {people.length} diretores</div>
    </div>
  );

  // Diretores sem regra aplicável no motor: ficam em "Aguardando classificação"
  // da matriz correspondente (uma única vez em cada matriz). Cada item abre o
  // card informativo no hover/foco/toque, com o Motivo DAQUELA matriz.
  const renderAguardando = (lista: MatrixDirector[], matriz: 'ninebox' | 'risk') => {
    if (!lista.length) return null;
    return (
      <div className="md-aguardando">
        <div className="md-aguardando-head">
          <span className="md-aguardando-titulo">Aguardando classificação</span>
          <span className="md-badge">{lista.length}</span>
        </div>
        <div className="md-aguardando-lista">
          {lista.map((person) => {
            const isSel =
              selectedDirector && person.name.toLowerCase() === selectedDirector.toLowerCase();
            const chave = normalizarChave(person.name);
            const aberta = infoAberta?.chave === chave && infoAberta.origem === matriz;
            return (
              <span
                className={`md-aguardando-item ${isSel ? 'md-highlighted' : ''}`}
                title={aberta ? undefined : `${person.name} • ${person.unit}`}
                key={person.id}
                tabIndex={0}
                aria-describedby={aberta ? 'md-info-card' : undefined}
                onPointerEnter={(event) => aoEntrarInfo(event, matriz, person)}
                onPointerLeave={aoSairInfo}
                onPointerDown={aoBaixarInfo}
                onFocus={(event) => aoFocarInfo(event, matriz, person)}
                onBlur={aoDesfocarInfo}
                onClick={(event) => aoClicarInfo(event, matriz, person)}
              >
                {person.name}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  // Conteúdo vigente do card aberto (recarregado dos dados em memória a cada
  // render — nunca fica defasado após um ajuste de Status/Nível).
  const infoCardAberta = infoAberta ? infoCards?.get(infoAberta.chave) : undefined;

  return (
    <div className={`matrizes-diretores ${className}`.trim()} aria-label="Matrizes de Diretores">
      {/* 1. Ninebox - Potencial x Desempenho */}
      <article className="md-card">
        <div className="md-title">
          Ninebox - Potencial x Desempenho{' '}
          <span className="md-info" title="Matriz de potencial e desempenho">
            i
          </span>
        </div>

        <section className="md-nine-chart">
          <aside className="md-nine-y">
            <div className="md-axis-main">POTENCIAL</div>
            <div className="md-nine-levels">
              <div className="md-axis-level">ALTO</div>
              <div className="md-axis-level">MÉDIO</div>
              <div className="md-axis-level">BAIXO</div>
            </div>
          </aside>
          <div className="md-nine-grid">
            {NINE_META.map((item, index) => {
              const boxPeople = data.ninebox[index] || [];
              const isHigh = hasSelectedDirector(boxPeople);
              return (
                <article
                  className={`md-box md-clickable md-${item.color} ${isHigh ? 'md-highlighted' : ''}`}
                  key={`${item.label}-${index}`}
                  onClick={() => openMove('ninebox', index)}
                >
                  <h2>{item.label}</h2>
                  {renderPeople(boxPeople)}
                </article>
              );
            })}
          </div>
        </section>

        <footer className="md-nine-x">
          <div className="md-nine-x-levels">
            <div className="md-x-level">ABAIXO DO ESPERADO</div>
            <div className="md-x-level">ESPERADO</div>
            <div className="md-x-level">ACIMA DO ESPERADO</div>
          </div>
          <div className="md-x-main">DESEMPENHO</div>
        </footer>

        {renderAguardando(aguardandoNinebox, 'ninebox')}
      </article>

      {/* 2. Matriz Risco x Dano (abaixo do Ninebox) */}
      <article className="md-card">
        <div className="md-title">
          Matriz Risco x Dano{' '}
          <span className="md-info" title="Classificação de risco e dano à instituição">
            i
          </span>
        </div>

        <div className="md-risk-wrap">
          <section className="md-risk-area">
            <aside className="md-risk-y">
              <div className="md-axis-main">RISCO</div>
              <div className="md-risk-levels">
                <div className="md-risk-level-y">ALTÍSSIMO</div>
                <div className="md-risk-level-y">ALTO</div>
                <div className="md-risk-level-y">MÉDIO</div>
                <div className="md-risk-level-y">BAIXO</div>
              </div>
            </aside>
            <div className="md-risk-grid">
              {RISK_COLORS.map((color, index) => {
                const cellPeople = data.risk[index] || [];
                const isHigh = hasSelectedDirector(cellPeople);
                return (
                  <div
                    className={`md-cell md-clickable md-${color} ${isHigh ? 'md-highlighted' : ''}`}
                    key={`${color}-${index}`}
                    title={titleFor('risk', index)}
                    onClick={() => openMove('risk', index)}
                  >
                    {renderPeople(cellPeople)}
                  </div>
                );
              })}
            </div>
          </section>

          <footer className="md-risk-x">
            <div className="md-risk-x-levels">
              <div className="md-x-level">BAIXO</div>
              <div className="md-x-level">MÉDIO</div>
              <div className="md-x-level">ALTO</div>
              <div className="md-x-level">ALTÍSSIMO</div>
            </div>
            <div className="md-x-main">DANO À INSTITUIÇÃO</div>
          </footer>
        </div>

        {renderAguardando(aguardandoRisco, 'risk')}
      </article>

      {/* Modal de Movimentação */}
      {modal && (
        <div
          className="md-modal open"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          <div className="md-dialog" role="dialog" aria-modal="true" aria-label="Movimentação de diretores">
            <header className="md-dialog-head">
              <h2>
                {modal.type === 'ninebox' ? 'Ninebox - Potencial x Desempenho' : 'Matriz Risco x Dano'} —
                movimentação de diretores
              </h2>
              <button className="md-close" type="button" onClick={() => setModal(null)} aria-label="Fechar">
                ×
              </button>
            </header>
            <div className="md-hint">
              Arraste um diretor da lista e solte no quadrado colorido de destino.
            </div>

            <div className="md-move-layout">
              {/* Painel da Esquerda: Lista de Diretores */}
              <section
                className={`md-source-panel md-${colorFor(modal.type, modal.sourceIndex)}`}
              >
                <div className="md-panel-head">
                  <span>{titleFor(modal.type, modal.sourceIndex)}</span>
                  <span className="md-badge">{currentSource.length}</span>
                </div>
                <div className="md-director-list">
                  {currentSource.length ? (
                    currentSource.map((director) => {
                      const isSel =
                        selectedDirector &&
                        director.name.toLowerCase() === selectedDirector.toLowerCase();
                      const chaveDir = normalizarChave(director.name);
                      const infoDesta =
                        infoAberta?.chave === chaveDir && infoAberta.origem === 'mov';
                      return (
                        <div
                          className={`md-director ${draggedId === director.id ? 'dragging' : ''} ${
                            isSel ? 'md-highlighted' : ''
                          }`}
                          draggable
                          key={director.id}
                          title={
                            infoDesta
                              ? undefined
                              : [`${director.name} • ${director.unit}`, director.origemDetalhe]
                                  .filter(Boolean)
                                  .join('\n')
                          }
                          data-origem={director.origem || 'automatica'}
                          tabIndex={0}
                          aria-describedby={infoDesta ? 'md-info-card' : undefined}
                          onPointerEnter={(event) => aoEntrarInfo(event, 'mov', director)}
                          onPointerLeave={aoSairInfo}
                          onPointerDown={aoBaixarInfo}
                          onFocus={(event) => aoFocarInfo(event, 'mov', director)}
                          onBlur={aoDesfocarInfo}
                          onClick={(event) => aoClicarInfo(event, 'mov', director)}
                          onDragStart={(event) => {
                            // Arraste inicia: o informativo some na hora (não
                            // acompanha o ponteiro durante o movimento).
                            fecharInfo();
                            setDraggedId(director.id);
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', director.id);
                          }}
                          onDragEnd={() => {
                            setDraggedId(null);
                            setDragOverIndex(null);
                          }}
                        >
                          <span className="md-mini">{initials(director.name)}</span>
                          <span>
                            <b>{director.name}</b>
                            <small>{director.unit}</small>
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="md-director-empty">Nenhum diretor nesta posição.</div>
                  )}
                </div>
              </section>

              {/* Painel da Direita: Matriz em Miniatura + Histórico */}
              <section className="md-dest-panel">
                <div className="md-panel-head">
                  <span>Solte o diretor no quadrado correspondente da matriz em miniatura</span>
                </div>

                <div className="md-targets">
                  {modal.type === 'ninebox' ? (
                    <div className="md-mini-matrix">
                      <aside className="md-mini-y">
                        <div className="md-mini-y-title">POTENCIAL</div>
                        <div className="md-mini-y-levels" style={{ gridTemplateRows: 'repeat(3, 1fr)' }}>
                          <div className="md-mini-y-level">ALTO</div>
                          <div className="md-mini-y-level">MÉDIO</div>
                          <div className="md-mini-y-level">BAIXO</div>
                        </div>
                      </aside>
                      <div className="md-mini-main">
                        <div className="md-mini-grid nine">
                          {data.ninebox.map((group, i) => {
                            const isSelected = i === modal.sourceIndex;
                            return (
                              <div
                                className={`md-target md-${NINE_META[i].color} ${
                                  isSelected ? 'selected' : ''
                                } ${dragOverIndex === i ? 'over' : ''}`}
                                key={`nine-mini-${i}`}
                                onClick={() => {
                                  if (!draggedId && i !== modal.sourceIndex) {
                                    setSuccess('');
                                    setModal({ type: 'ninebox', sourceIndex: i });
                                  }
                                }}
                                onDragOver={(e) => {
                                  if (i !== modal.sourceIndex) {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    setDragOverIndex(i);
                                  }
                                }}
                                onDragLeave={() => setDragOverIndex(null)}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  void moveDirector(i);
                                }}
                              >
                                <span>{NINE_META[i].label}</span>
                                <small>{group.length} diretores</small>
                                {isSelected && <span className="md-selected-badge">Selecionado</span>}
                              </div>
                            );
                          })}
                        </div>
                        <div className="md-mini-x-levels nine">
                          <div className="md-mini-x-level">ABAIXO DO ESPERADO</div>
                          <div className="md-mini-x-level">ESPERADO</div>
                          <div className="md-mini-x-level">ACIMA DO ESPERADO</div>
                        </div>
                        <div className="md-mini-x-title">DESEMPENHO</div>
                      </div>
                    </div>
                  ) : (
                    <div className="md-mini-matrix">
                      <aside className="md-mini-y">
                        <div className="md-mini-y-title">RISCO</div>
                        <div className="md-mini-y-levels" style={{ gridTemplateRows: 'repeat(4, 1fr)' }}>
                          <div className="md-mini-y-level">ALTÍSSIMO</div>
                          <div className="md-mini-y-level">ALTO</div>
                          <div className="md-mini-y-level">MÉDIO</div>
                          <div className="md-mini-y-level">BAIXO</div>
                        </div>
                      </aside>
                      <div className="md-mini-main">
                        <div className="md-mini-grid risk">
                          {data.risk.map((group, i) => {
                            const isSelected = i === modal.sourceIndex;
                            return (
                              <div
                                className={`md-target md-${RISK_COLORS[i]} ${
                                  isSelected ? 'selected' : ''
                                } ${dragOverIndex === i ? 'over' : ''}`}
                                key={`risk-mini-${i}`}
                                onClick={() => {
                                  if (!draggedId && i !== modal.sourceIndex) {
                                    setSuccess('');
                                    setModal({ type: 'risk', sourceIndex: i });
                                  }
                                }}
                                onDragOver={(e) => {
                                  if (i !== modal.sourceIndex) {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    setDragOverIndex(i);
                                  }
                                }}
                                onDragLeave={() => setDragOverIndex(null)}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  void moveDirector(i);
                                }}
                              >
                                <span
                                  dangerouslySetInnerHTML={{
                                    __html: `Risco ${RISK_Y[Math.floor(i / 4)]}<br>Dano ${RISK_X[i % 4]}`,
                                  }}
                                />
                                <small>{group.length} diretores</small>
                                {isSelected && <span className="md-selected-badge">Selecionado</span>}
                              </div>
                            );
                          })}
                        </div>
                        <div className="md-mini-x-levels risk">
                          <div className="md-mini-x-level">BAIXO</div>
                          <div className="md-mini-x-level">MÉDIO</div>
                          <div className="md-mini-x-level">ALTO</div>
                          <div className="md-mini-x-level">ALTÍSSIMO</div>
                        </div>
                        <div className="md-mini-x-title">DANO À INSTITUIÇÃO</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Histórico Recente de Movimentações */}
                <div className="md-move-history">
                  <div className="md-history-head">
                    <span className="md-history-title">Movimentações recentes</span>
                    <button className="md-history-clear" type="button" onClick={clearHistory}>
                      Limpar histórico
                    </button>
                  </div>
                  <div className="md-history-list">
                    {currentHistory.length ? (
                      currentHistory.map((item) => (
                        <div className={`md-history-item md-${item.color}`} key={item.id}>
                          <span className="md-history-date">{item.movedAt}</span>
                          <span className="md-history-message">
                            O diretor <strong>{item.directorName}</strong> foi movido de{' '}
                            <strong>{item.fromLabel}</strong> para <strong>{item.toLabel}</strong>.
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="md-history-empty">
                        Nenhuma movimentação registrada nesta matriz.
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>

            {success && <div className="md-success">{success}</div>}
          </div>
        </div>
      )}

      {/* Card informativo do diretor — UM por vez, `position: fixed` acima do
          modal (z-index 1200) e também sobre "Aguardando classificação". */}
      {infoAberta && infoCardAberta && (
        <DiretorInfoCard
          anchor={infoAberta.anchor}
          info={infoCardAberta}
          diretor={infoAberta.diretor}
          unidade={infoAberta.unidade}
          motivo={motivoDe(infoAberta.chave, infoAberta.origem)}
          cardRef={infoCardRef}
          onEnter={limparTimersInfo}
          onLeave={agendarSaidaInfo}
          onClose={fecharInfo}
        />
      )}
    </div>
  );
}
