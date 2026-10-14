import React, { useMemo, useRef, useState } from 'react';
import {
  buildPeriodLabelMap,
  matrixPeriodColumns,
  filterMatrixRows,
  formatMetricCell,
  recordMetric,
  MATRIX_INDICATORS
} from '../services/dashboardService.js';
import { friendlyMetricName } from '../dataParser.js';

const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const isEmpty = v => v == null || String(v).trim() === '';

function uniqueSorted(list){
  return [...new Set(list.filter(v => !isEmpty(v)))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export default function PerformanceMatrix({ records, allRecords, avaliacoes }){
  const regs = records || [];
  const labelMap = useMemo(() => buildPeriodLabelMap(regs, avaliacoes || []), [regs, avaliacoes]);
  const periodCols = useMemo(() => matrixPeriodColumns(regs, avaliacoes || []), [regs, avaliacoes]);

  const [f, setF] = useState({
    regional: '', diretor: '', unidade: '', periodo: '',
    statusTrimestral: '', nivel: '', statusGestao: '', cicloVida: ''
  });
  // Painel de filtros recolhido por padrão; histórico completo oculto por padrão.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef(null);
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v, ...(k === 'periodo' ? { statusTrimestral: '', nivel: '' } : {}) }));
  const clear = () => setF({ regional: '', diretor: '', unidade: '', periodo: '', statusTrimestral: '', nivel: '', statusGestao: '', cicloVida: '' });
  const activeFilters = Object.values(f).filter(Boolean).length;
  const filtersLabel = filtersOpen ? 'Ocultar filtros' : (activeFilters ? `Filtros (${activeFilters})` : 'Filtros');

  // Último período = última coluna na ordem cronológica dos dados
  // (avaliações da mais antiga para a mais recente + ordem das colunas na
  // planilha). Nenhum mês/trimestre/ano fixo no código.
  const lastCol = periodCols.length ? periodCols[periodCols.length - 1] : null;
  const shownCols = showHistory ? periodCols : (lastCol ? [lastCol] : []);
  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (!next && scrollRef.current) scrollRef.current.scrollLeft = 0;
  };

  // Células de histórico de um registro: label composto → { estagio, nivel }
  const cellsOf = r => {
    const m = new Map();
    for (const p of r.periodos || []) {
      const lab = labelMap.get(`${r.avaliacaoId}|${p.rotulo}`);
      if (lab) m.set(lab, p);
    }
    return m;
  };

  // Cabeçalho de filtro: opções escopadas pelo período escolhido
  const periodScoped = useMemo(() => {
    if (!f.periodo) return regs;
    return regs.filter(r => {
      for (const p of r.periodos || []) if (labelMap.get(`${r.avaliacaoId}|${p.rotulo}`) === f.periodo) return true;
      return false;
    });
  }, [regs, f.periodo, labelMap]);

  const statusOpts = useMemo(() => {
    const s = new Set();
    for (const r of periodScoped) for (const p of r.periodos || []) {
      const lab = labelMap.get(`${r.avaliacaoId}|${p.rotulo}`);
      if (f.periodo && lab !== f.periodo) continue;
      if (!isEmpty(p.estagio)) s.add(p.estagio);
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [periodScoped, f.periodo, labelMap]);

  const nivelOpts = useMemo(() => {
    const s = new Set();
    for (const r of periodScoped) for (const p of r.periodos || []) {
      const lab = labelMap.get(`${r.avaliacaoId}|${p.rotulo}`);
      if (f.periodo && lab !== f.periodo) continue;
      if (!isEmpty(p.nivel)) s.add(p.nivel);
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [periodScoped, f.periodo, labelMap]);

  const rows = useMemo(
    () => filterMatrixRows(regs, f, (r, p) => labelMap.get(`${r.avaliacaoId}|${p.rotulo}`)),
    [regs, f, labelMap]
  );

  // Indicadores extras (EAV futuros) — fora dos 9 conhecidos, dinâmicos
  const extras = useMemo(() => {
    const s = new Set();
    for (const r of regs) for (const ind of r.indicadores || []) {
      const friendly = friendlyMetricName(ind.nome);
      const isKnown = friendly && MATRIX_INDICATORS.some(m => m.key === friendly);
      if (!isKnown && !isEmpty(ind.nome)) s.add(ind.nome);
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [regs]);

  const cellsOfCache = useMemo(() => {
    const map = new Map();
    for (const r of rows) map.set(r.id, cellsOf(r));
    return map;
  }, [rows, labelMap]);

  const extraCell = (r, name) => {
    const ind = (r.indicadores || []).find(i => i.nome === name);
    if (!ind) return '—';
    if (ind.valorNumerico != null && Number.isFinite(ind.valorNumerico)) {
      return ind.valorNumerico.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    }
    return isEmpty(ind.valorTexto) ? '—' : ind.valorTexto;
  };

  const opts = {
    regional: uniqueSorted(regs.map(r => r.regional)),
    diretor: uniqueSorted(regs.map(r => r.diretor)),
    unidade: uniqueSorted(regs.map(r => r.unidade)),
    periodo: periodCols,
    statusTrimestral: statusOpts,
    nivel: nivelOpts,
    statusGestao: uniqueSorted(regs.map(r => r.statusGestao)),
    cicloVida: uniqueSorted(regs.map(r => r.cicloVida))
  };

  const labels = {
    regional: 'Regional', diretor: 'Diretor', unidade: 'Unidade', periodo: 'Período',
    statusTrimestral: 'Status trimestral', nivel: 'Nível', statusGestao: 'Status de gestão', cicloVida: 'Ciclo de vida'
  };

  return (
    <div className="matrix">
      <div className="mx-bar">
        <button className="mx-btn" type="button" onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen}>{filtersLabel}</button>
        <span className="mx-count">{rows.length} de {regs.length} registro(s)</span>
        <button className="mx-btn" type="button" onClick={toggleHistory} disabled={!periodCols.length}>{showHistory ? 'Ocultar histórico' : 'Ver histórico completo'}</button>
      </div>
      {filtersOpen && (
        <div className="mx-filters">
          {Object.keys(labels).map(k => (
            <label key={k}>{labels[k]}
              <select value={f[k]} onChange={e => set(k, e.target.value)} disabled={!regs.length}>
                <option value="">Todos</option>
                {opts[k].map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          ))}
          <button className="save" onClick={clear} disabled={!Object.values(f).some(Boolean)}>Limpar filtros</button>
        </div>
      )}
      {!regs.length ? (
        <p className="mx-empty">Nenhum registro na seleção atual.</p>
      ) : (
        <div className="mx-scroll" ref={scrollRef}>
          <table className="mx-table">
            <thead>
              <tr>
                <th className="mx-frozen mx-f1" rowSpan={2}>Regional</th>
                <th className="mx-frozen mx-f2" rowSpan={2}>Diretor</th>
                <th className="mx-frozen mx-f3" rowSpan={2}>Unidade</th>
                {shownCols.map((lab, i) => <th key={lab} className={'mx-hist' + (i === 0 ? ' mx-hstart' : '')} colSpan={2}>{lab}</th>)}
                <th className={'mx-final' + (shownCols.length ? '' : ' mx-hstart')} colSpan={3}>Situação atual</th>
                {MATRIX_INDICATORS.map(m => <th key={m.key} className="mx-ind" rowSpan={2}>{m.label}</th>)}
                {extras.map(name => <th key={name} className="mx-ind" rowSpan={2}>{name}</th>)}
              </tr>
              <tr>
                {shownCols.map((lab, i) => (
                  <React.Fragment key={lab}>
                    <th className={'mx-sub' + (i === 0 ? ' mx-hstart' : '')}>Status</th>
                    <th className="mx-sub">Nível</th>
                  </React.Fragment>
                ))}
                <th className={'mx-sub' + (shownCols.length ? '' : ' mx-hstart')}>Status de gestão</th>
                <th className="mx-sub">Ciclo de vida</th>
                <th className="mx-sub">Nível da unidade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const cells = cellsOfCache.get(r.id) || new Map();
                return (
                  <tr key={r.id}>
                    <td className="mx-frozen mx-f1" title={r.regional}>{r.regional || '—'}</td>
                    <td className="mx-frozen mx-f2" title={r.diretor}>{r.diretor || '—'}</td>
                    <td className="mx-frozen mx-f3" title={r.unidade}>{r.unidade || '—'}</td>
                    {shownCols.map((lab, i) => {
                      const c = cells.get(lab);
                      return (
                        <React.Fragment key={lab}>
                          <td className={i === 0 ? 'mx-hstart' : ''} title={c?.estagio || ''}>{isEmpty(c?.estagio) ? '—' : c.estagio}</td>
                          <td title={c?.nivel || ''}>{isEmpty(c?.nivel) ? '—' : c.nivel}</td>
                        </React.Fragment>
                      );
                    })}
                    <td className="mx-cstart" title={r.statusGestao || ''}>{r.statusGestao || '—'}</td>
                    <td title={r.cicloVida || ''}>{r.cicloVida || '—'}</td>
                    <td title={r.nivelAtual || ''}>{r.nivelAtual || '—'}</td>
                    {MATRIX_INDICATORS.map(m => (
                      <td key={m.key} title={m.label}>{formatMetricCell(recordMetric(r, m.key), m.key)}</td>
                    ))}
                    {extras.map(name => <td key={name} title={name}>{extraCell(r, name)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
