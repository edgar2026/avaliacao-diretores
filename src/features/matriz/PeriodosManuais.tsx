import { useEffect, useMemo, useState } from 'react';
import {
  NAO_INFORMADO,
  NIVEL_OPCOES,
  ROMANOS,
  restaurarValorImportado,
  salvarAjuste
} from '../../services/ajustesService.js';
import {
  MESES,
  anoSugerido,
  eValorVazio,
  ehFechamentoTrimestral,
  gerarRotuloPeriodo,
  linhasPeriodosDoDiretor,
  origemDoPeriodo,
  salvarPeriodoManual,
  trimestreDoMes
} from '../../services/periodosManuais.js';
import type { LinhaPeriodoDiretor, ResultadoSalvarPeriodoManual } from '../../services/periodosManuais.js';
import IndicadoresPainel from '../indicadores/IndicadoresPainel.tsx';
import type { ResultadoIndicadores } from '../indicadores/IndicadoresPainel.tsx';
import type { Registro, Periodo, AvaliacaoModel } from '../../types/modelo';
import type { AjusteRow } from '../../types/supabase';
import type { Nivel } from '../../types/status';

const mostra = (v: unknown): string => eValorVazio(v) ? 'Não informado' : String(v);

// Resultado entregue ao chamador (App) após cada ação confirmada pelo banco.
export type ResultadoPeriodosManuais =
  | ({ tipo: 'cadastro' } & ResultadoSalvarPeriodoManual)
  | { tipo: 'ajuste'; ajuste: AjusteRow }
  | { tipo: 'restaurar'; registroId: string; periodoId: string }
  | ResultadoIndicadores;

interface PeriodosManuaisProps {
  registros: Registro[];
  avaliacoes: AvaliacaoModel[];
  statusOpcoes: string[];
  onSalvo?: (info: ResultadoPeriodosManuais) => void;
  onFechar?: () => void;
}

/**
 * Painel "Atualizar dados" da Matriz histórica (somente com diretor
 * específico selecionado), organizado em duas áreas separadas:
 *
 *   1. PERÍODOS EXISTENTES (padrão) — tabela compacta estilo Excel com TODOS
 *      os períodos do diretor (uma linha por mês/ano, da avaliação vigente de
 *      maior prioridade), ordenada do mais recente para o mais antigo. Status
 *      e Nível são editados NA PRÓPRIA LINHA (uma linha em edição por vez),
 *      pelas camadas de ajuste manual: valor original da planilha sempre
 *      preservado. O botão "Indicadores" abre painel dedicado de pontuações
 *      e percentuais.
 *   2. NOVO PERÍODO — formulário compacto (Mês, Ano, Status, Nível) que
 *      grava linha com origem "cadastro manual", rótulo normalizado
 *      (OUT/2026), ordem cronológica e fechamento trimestral em mar/jun/set/
 *      dez; período duplicado (Diretor + Mês + Ano) é bloqueado antes de ir
 *      ao banco.
 *
 * Nenhuma regra de dados foi alterada: prioridade ajuste manual > cadastro
 * manual > valor importado; atualização incremental via planilha continua
 * completando apenas campos vazios, por Diretor + Período + Campo.
 */
export default function PeriodosManuais({ registros, avaliacoes, statusOpcoes, onSalvo, onFechar }: PeriodosManuaisProps){
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  // Áreas separadas: "existentes" (padrão) ou formulário de "novo".
  const [aba, setAba] = useState('existentes');

  const [mes, setMes] = useState('');
  const [ano, setAno] = useState(() => anoSugerido(avaliacoes));
  const [status, setStatus] = useState('');
  const [nivel, setNivel] = useState('');

  // Edição inline: somente UMA linha em edição por vez (chave da linha).
  const [edicao, setEdicao] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editNivel, setEditNivel] = useState('');

  // Linha existente destacada quando um novo período é bloqueado por
  // duplicidade (Diretor + Mês + Ano).
  const [destaque, setDestaque] = useState('');

  // Painel dedicado de pontuações/indicadores (aberto pelo botão
  // "Indicadores" de uma linha).
  const [indicadores, setIndicadores] = useState<Registro | null>(null);

  // Tabela de períodos: uma linha por mês/ano, do mais recente para o mais
  // antigo, já resolvendo a prioridade de vigência entre avaliações.
  const linhas = useMemo(() => linhasPeriodosDoDiretor(registros, avaliacoes), [registros, avaliacoes]);

  const registrosOrdenados = useMemo(() => {
    const ordemAval = new Map((avaliacoes || []).map((a, i) => [a.id, i]));
    return [...(registros || [])].sort((a, b) =>
      (ordemAval.get(a.avaliacaoId) ?? -1) - (ordemAval.get(b.avaliacaoId) ?? -1));
  }, [registros, avaliacoes]);
  // Registro alvo do cadastro de novo período: o mais recente do diretor.
  const registroAlvo = registrosOrdenados[registrosOrdenados.length - 1] || null;

  const sel = useMemo(() => linhas.find(l => l.chave === edicao) || null, [linhas, edicao]);

  const statusOps = useMemo(() => {
    // "Não informado" é a PRIMEIRA opção válida (escolha manual salvável),
    // seguida das classificações do sistema + valores já importados.
    const l: string[] = [NAO_INFORMADO];
    for(const s of (statusOpcoes || [])){
      const t = String(s ?? '').trim();
      if(t && t !== NAO_INFORMADO && !l.includes(t)) l.push(t);
    }
    const atual = String(editStatus ?? '').trim();
    if(atual && atual !== NAO_INFORMADO && !l.includes(atual)) l.push(atual);
    return l;
  }, [statusOpcoes, editStatus]);

  // Nível editável: "Não informado" (escolha manual salvável) + I–V.
  const nivelOps = useMemo(() => [NAO_INFORMADO, ...NIVEL_OPCOES.map(o => o.valor)], []);

  useEffect(() => {
    const p = sel?.periodo;
    // Campo vazio OU ajuste manual para "Não informado" -> select na opção
    // "Não informado" (decisão do usuário, não o valor importado).
    setEditStatus(!p || eValorVazio(p.estagio) ? NAO_INFORMADO : String(p.estagio));
    setEditNivel(!p || p.nivelRoman == null ? NAO_INFORMADO : (ROMANOS[p.nivelRoman] || NAO_INFORMADO));
    setErro('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edicao]);

  const rotuloPrevisto = mes && /^\d{4}$/.test(String(ano)) ? gerarRotuloPeriodo(Number(mes), Number(ano)) : '';

  function limparNovo(){
    setMes('');
    setAno(() => anoSugerido(avaliacoes));
    setStatus('');
    setNivel('');
  }

  function abrirNovo(){
    setErro('');
    setSucesso('');
    limparNovo();
    setAba('novo');
  }

  function abrirTabela(){
    setErro('');
    setAba('existentes');
  }

  function editar(linha: LinhaPeriodoDiretor){
    if(ocupado) return;
    setErro('');
    setSucesso('');
    setDestaque('');
    setEdicao(linha.chave);
  }

  function cancelarEdicao(){
    if(ocupado) return;
    setEdicao('');
    setErro('');
  }

  async function cadastrar(){
    if(ocupado || !registroAlvo) return;
    setErro('');
    setSucesso('');
    const m = Number(mes), a = Number(ano);
    // BLOQUEIO DE DUPLICIDADE (Diretor + Mês + Ano) ANTES de ir ao banco:
    // a tabela é por mês/ano do diretor inteiro (todas as avaliações).
    const dup = linhas.find(l => l.info && l.info.month === m && l.info.year === a);
    if(dup){
      setAba('existentes');
      setDestaque(dup.chave);
      setErro('Este período já existe para o diretor. Use “Editar” na linha destacada para completar ou ajustar os dados.');
      return;
    }
    try{
      setOcupado(true);
      const info = await salvarPeriodoManual({
        registroId: registroAlvo.id,
        avaliacaoId: registroAlvo.avaliacaoId,
        avaliacoes: avaliacoes || [],
        mes, ano, status, nivel,
        opcoes: statusOpcoes
      });
      // Fecha o formulário e volta à tabela após salvar.
      limparNovo();
      setAba('existentes');
      setSucesso(`Período ${info.rotulo} cadastrado com sucesso.`);
      onSalvo?.({ tipo: 'cadastro', ...info });
      setOcupado(false);
    } catch(e: unknown){
      const err = e as { message?: string } | null;
      setErro(err?.message || String(e));
      setOcupado(false);
    }
  }

  async function salvarEdicao(){
    if(ocupado || !sel) return;
    setErro('');
    setSucesso('');
    try{
      setOcupado(true);
      const ajuste = await salvarAjuste({
        avaliacaoId: sel.registro.avaliacaoId,
        registroId: sel.registro.id,
        periodoId: sel.periodo.id,
        statusAjustado: editStatus,
        nivelAjustado: editNivel as Nivel,
        opcoes: statusOps
      });
      // Linha volta ao modo de leitura somente após a confirmação do banco.
      setEdicao('');
      setSucesso('Status e nível atualizados com sucesso.');
      onSalvo?.({ tipo: 'ajuste', ajuste });
      setOcupado(false);
    } catch(e: unknown){
      // Erro: linha permanece em edição, escolhas preservadas.
      const err = e as { message?: string } | null;
      setErro(err?.message || String(e));
      setOcupado(false);
    }
  }

  async function restaurar(){
    if(ocupado || !sel || !sel.periodo.ajustado) return;
    setErro('');
    setSucesso('');
    try{
      setOcupado(true);
      await restaurarValorImportado({ periodoId: sel.periodo.id });
      setEdicao('');
      setSucesso('Valor importado restaurado (ajuste manual removido).');
      onSalvo?.({ tipo: 'restaurar', registroId: sel.registro.id, periodoId: sel.periodo.id });
      setOcupado(false);
    } catch(e: unknown){
      const err = e as { message?: string } | null;
      setErro(err?.message || String(e));
      setOcupado(false);
    }
  }

  const fmtPar = (s: unknown, n: unknown): string => {
    const nivelTxt = typeof n === 'number' ? (ROMANOS[n] ? `(${ROMANOS[n]})` : 'Não informado') : mostra(n);
    return `${mostra(s)} · ${nivelTxt}`;
  };

  // Origem exibida por campo (Status/Nível). Com a regra atual as duas
  // origens coincidem; se divergirem (futuras camadas), mostra de forma
  // compacta "Status: X · Nível: Y".
  const origens = (p: Periodo) => {
    const base = origemDoPeriodo(p);
    return { status: base, nivel: base };
  };
  const rotuloOrigem = (p: Periodo): string => {
    const o = origens(p);
    if(o.status === o.nivel) return o.status;
    return `Status: ${o.status} · Nível: ${o.nivel}`;
  };

  function fechar(){
    if(ocupado) return;
    onFechar?.();
  }

  return <div className="modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)fechar();}}>
    <div className="modal-card editor-periodo pm-card" role="dialog" aria-modal="true" aria-labelledby="periodos-manuais-titulo">
      <h2 id="periodos-manuais-titulo">Atualizar dados do diretor</h2>
      <p className="modal-file">{registroAlvo ? `${registroAlvo.diretor} · ${registroAlvo.regional || '—'}${registroAlvo.unidade ? ` · ${registroAlvo.unidade}` : ''}` : 'Nenhum registro disponível para o diretor selecionado.'}</p>
      <p className="pm-nota" title="Ajuste manual tem prioridade sobre cadastro manual e valor importado; uma planilha futura não sobrescreve valores manuais.">Alterações manuais serão preservadas em futuras importações.</p>
      {erro && <p className="error" role="alert">{erro}</p>}
      {sucesso && <p className="pm-sucesso" role="status">{sucesso}</p>}

      <div className="pm-abas" role="tablist" aria-label="Áreas do painel">
        <button type="button" role="tab" aria-selected={aba === 'existentes'} className={aba === 'existentes' ? 'ativa' : ''} onClick={abrirTabela}>Períodos existentes</button>
        <button type="button" role="tab" aria-selected={aba === 'novo'} className={aba === 'novo' ? 'ativa' : ''} onClick={abrirNovo}>Novo período</button>
      </div>

      {aba === 'existentes' && <>
        {linhas.length === 0 && <p className="mx-empty">Nenhum período cadastrado para este diretor. Use “Novo período” para cadastrar o primeiro.</p>}
        {linhas.length > 0 && <div className="pm-scroll">
          <table className="pm-table">
            <thead>
              <tr>
                <th>Período</th>
                <th>Status</th>
                <th>Nível</th>
                <th>Origem</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(linha => {
                const p = linha.periodo;
                const editando = edicao === linha.chave;
                const destacada = destaque === linha.chave;
                const nivelTxt = p.nivelRoman != null && ROMANOS[p.nivelRoman] ? ROMANOS[p.nivelRoman] : 'Não informado';
                return <tr key={linha.chave} className={editando ? 'pm-editando' : (destacada ? 'pm-destaque' : '')}>
                  <td data-label="Período">
                    <b className="pm-periodo">{linha.info ? linha.info.label : mostra(p.rotulo)}</b>
                    {linha.info?.isQuarter && <span className="pm-tri">{linha.info.quarter}º trimestre</span>}
                  </td>
                  <td data-label="Status">
                    {editando
                      ? <select value={editStatus} onChange={(e)=>{setEditStatus(e.target.value);setErro('');}} disabled={ocupado} autoFocus aria-label="Status do período">
                          {statusOps.map(s=><option key={s} value={s}>{s}</option>)}
                        </select>
                      : mostra(p.estagio)}
                  </td>
                  <td data-label="Nível">
                    {editando
                      ? <select value={editNivel} onChange={(e)=>{setEditNivel(e.target.value);setErro('');}} disabled={ocupado} aria-label="Nível do período">
                          {nivelOps.map(o=><option key={o} value={o}>{o}</option>)}
                        </select>
                      : nivelTxt}
                  </td>
                  <td data-label="Origem" title={`Valor original da planilha: ${fmtPar(p.estagioOriginal, p.nivelOriginal)}`}>{rotuloOrigem(p)}</td>
                  <td data-label="Ação">
                    <div className="pm-acoes">
                      {editando ? <>
                        <button type="button" className="primary" onClick={salvarEdicao} disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar'}</button>
                        {p.ajustado && <button type="button" onClick={restaurar} disabled={ocupado}>Restaurar valor importado</button>}
                        <button type="button" onClick={cancelarEdicao} disabled={ocupado}>Cancelar</button>
                      </> : <>
                        <button type="button" onClick={()=>editar(linha)} disabled={ocupado || !!edicao}>Editar</button>
                        <button type="button" onClick={()=>{setErro('');setSucesso('');setIndicadores(linha.registro);}} disabled={ocupado || !!edicao}>Indicadores</button>
                      </>}
                    </div>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
        <div className="info">
          Status e Nível são editados na própria linha (uma por vez). Qualquer alteração vira ajuste manual vigente; o valor original da planilha permanece preservado. Campos vazios podem ser completados sem sobrescrever valores já preenchidos.
        </div>
        <div className="modal-actions">
          <button onClick={fechar} disabled={ocupado}>Fechar</button>
        </div>
      </>}

      {aba === 'novo' && <>
        <div className="meta-form">
          <div className="meta-row">
            <label>Mês
              <select value={mes} onChange={(e)=>{setMes(e.target.value);setErro('');}} disabled={ocupado}>
                <option value="" disabled>Selecione…</option>
                {MESES.map(m=><option key={m.valor} value={m.valor}>{m.nome}</option>)}
              </select>
            </label>
            <label>Ano
              <input type="text" inputMode="numeric" maxLength={4} value={ano} placeholder="Ex.: 2026" onChange={(e)=>{setAno(e.target.value.replace(/\D/g,''));setErro('');}} disabled={ocupado}/>
            </label>
          </div>
          <div className="meta-row">
            <label>Status
              <select value={status} onChange={(e)=>{setStatus(e.target.value);setErro('');}} disabled={ocupado}>
                <option value="" disabled>Selecione…</option>
                {(statusOpcoes||[]).map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>Nível
              <select value={nivel} onChange={(e)=>{setNivel(e.target.value);setErro('');}} disabled={ocupado}>
                <option value="" disabled>Selecione…</option>
                {NIVEL_OPCOES.map(o=><option key={o.valor} value={o.valor}>{o.valor}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="info">
          {rotuloPrevisto
            ? <>Será salvo como <b>{rotuloPrevisto}</b> · ordem cronológica automática{ehFechamentoTrimestral(Number(mes)) ? <> · fechamento do {trimestreDoMes(Number(mes))}º trimestre</> : null} · origem <b>cadastro manual</b>.</>
            : <>Escolha o mês (janeiro a dezembro) e o ano com quatro dígitos. O rótulo normalizado e a ordem cronológica são gerados ao salvar.</>}
        </div>
        <div className="modal-actions">
          <button onClick={abrirTabela} disabled={ocupado}>Cancelar</button>
          <button className="primary" onClick={cadastrar} disabled={ocupado || !registroAlvo}>{ocupado ? 'Salvando…' : 'Cadastrar período'}</button>
        </div>
      </>}

      {indicadores && <IndicadoresPainel
        registro={indicadores}
        onSalvo={(info)=>{ setIndicadores(null); setSucesso('Pontuações e indicadores atualizados com sucesso.'); onSalvo?.(info); }}
        onFechar={()=>setIndicadores(null)}
      />}
    </div>
  </div>;
}
