import { nameKey, normName, isPresentName, distinctNames, regionalsOf, matrixPeriodColumns } from './dashboardService.js';
import { opcoesStatus } from './ajustesService.js';
import { romanLevel } from '../lib/dataParser.js';
import {
  planejarAtualizacao, baseDoModelo, chavePeriodo, statusLido, nivelLido
} from './importPlan.js';
import type { DashboardModel, Registro, Periodo } from '../types/modelo';
import type { WorkbookAnalysis } from '../types/planilha';
import type { AvaliacaoHashInfo } from './avaliacoesService.js';
import type {
  PreviewResult, Pendencia, PeriodoNovoResumo, AjustePreservado, IndicadorDetalhe, MudancaCadastro
} from '../types/importacao';

// ---------------------------------------------------------------------------
// PRÉVIA DA ATUALIZAÇÃO PELA PLANILHA
//
// Comparação SOMENTE LEITURA. O coração da prévia é `planejarAtualizacao`
// (src/services/importPlan.js) — a MESMA função pura que a gravação executa
// (runImport), só que aqui sobre o model em memória e sem tocar em rede/
// banco. A tela, portanto, mostra exatamente o que acontecerá:
//   * registros NOVOS, REUTILIZADOS, REATIVADOS e ARQUIVADOS (identidade
//     Diretor+Unidade normalizada — nunca linha/posição/avaliação);
//   * períodos novos e campos vazios que serão completados;
//   * DIVERGÊNCIAS entre planilha e sistema com a ação de cada uma
//     ("atualizado" = muda; "mantido" = a prioridade preserva);
//   * prioridade manual intacta (ajuste manual > cadastro manual > valor
//     importado > nova planilha);
//   * referência DINÂMICA dos indicadores (nunca um mês fixo);
//   * pendências e bloqueios (arquivo idêntico, linhas ignoradas etc.).
// ---------------------------------------------------------------------------

const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V'];

// Nome amigável de um rótulo de período — MESMA regra do título da tela
// ("SET/3TRI 2026" → "Setembro de 2026"). Nenhum mês é fixado no código: o
// valor vem sempre do último período mensal válido reconhecido nos dados.
const MESES_NOME: Record<string, string> = { JAN:'janeiro', FEV:'fevereiro', MAR:'março', ABR:'abril', MAI:'maio', JUN:'junho', JUL:'julho', AGO:'agosto', SET:'setembro', OUT:'outubro', NOV:'novembro', DEZ:'dezembro' };

function nomeAmigavel(label: string | null | undefined): string | null {
  if(!label) return null;
  const up = String(label).toUpperCase();
  const mes = up.match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\b/);
  const ano = up.match(/(20\d{2})/);
  if(mes && ano){
    const nome = MESES_NOME[mes[1]];
    return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano[1]}`;
  }
  return String(label);
}

function nivelPreenchido(periodo: Partial<Pick<Periodo, 'nivel'>> | null | undefined): boolean {
  if(periodo == null) return false;
  if(romanLevel(periodo.nivel) != null) return true;
  return nivelLido(periodo.nivel) != null;
}

/** Valor exibido em divergências (números formatados no pt-BR). */
function valorExibido(v: unknown): string {
  if(v == null || v === '') return '—';
  if(typeof v === 'number') return v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  return normName(v) || '—';
}

// Entrada de buildUpdatePreview (análise local + modelo em memória).
export interface PreviewUpdateParams {
  analysis?: Partial<WorkbookAnalysis> | null;
  model?: Partial<DashboardModel> | null;
  arquivosIguais?: AvaliacaoHashInfo[] | null;
  meta?: { ano?: number | string; trimestre?: number | string } | null;
}

/**
 * Monta a prévia COMPLETA da atualização incremental.
 * Entradas: análise local da planilha (dataParser) + modelo atual do sistema
 * (buildDashboardModel) + lista de avaliações com o MESMO hash (arquivo
 * binariamente idêntico, consulta apenas). Retorna objeto pronto para a UI.
 */
export function buildUpdatePreview({ analysis, model, arquivosIguais = [], meta = null }: PreviewUpdateParams): PreviewResult {
  const registros: Registro[] = model?.registros || [];
  const registrosArquivados: Registro[] = model?.registrosArquivados || [];
  const todosRegistros = [...registros, ...registrosArquivados];
  const avaliacoes = model?.avaliacoes || [];
  const records = analysis?.records || [];

  // -------------------------------------------------------------------------
  // PLANO (fonte única da regra) — mesma função usada na gravação.
  // -------------------------------------------------------------------------
  const plano = planejarAtualizacao({ base: baseDoModelo(model), analysis });
  const janela = plano.janela;
  const resumo = plano.resumo;

  // -------------------------------------------------------------------------
  // Estado ATUAL do sistema por diretor/unidade (identidade normalizada).
  // -------------------------------------------------------------------------
  const ordemAval = new Map(avaliacoes.map((a, i) => [a.id, i]));
  const porChave = new Map<string, { record: Registro; ordem: number }>();
  const porDiretor = new Map<string, { record: Registro; ordem: number }>();
  for(const r of todosRegistros){
    const o = ordemAval.has(r.avaliacaoId) ? ordemAval.get(r.avaliacaoId) : -1;
    if(isPresentName(r.diretor)){
      const kd = nameKey(r.diretor);
      const atualD = porDiretor.get(kd);
      if(!atualD || o >= atualD.ordem) porDiretor.set(kd, { record: r, ordem: o });
      if(isPresentName(r.unidade)){
        const k = `${kd}|${nameKey(r.unidade)}`;
        const atual = porChave.get(k);
        if(!atual || o >= atual.ordem) porChave.set(k, { record: r, ordem: o });
      }
    }
  }
  const chavesExistentes = new Set<string>();
  let ultimoMesExistente = null;
  for(const r of todosRegistros){
    for(const p of r.periodos ||[]){
      const k = chavePeriodo(p.rotulo, janela);
      chavesExistentes.add(k);
      if(k.startsWith('M:') && (ultimoMesExistente == null || k > ultimoMesExistente)){
        ultimoMesExistente = k;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Resumo do arquivo analisado.
  // -------------------------------------------------------------------------
  const chavesPlanilha = (analysis?.periodLabels || []).map(l => ({ label: l, chave: chavePeriodo(l, janela) }));
  const periodoMaisRecente = chavesPlanilha.slice().sort((a, b) =>
    (a.chave.startsWith('M:') ? a.chave : '') < (b.chave.startsWith('M:') ? b.chave : '') ? 1 : -1
  )[0]?.label || '—';
  const totalDiretores = distinctNames(analysis?.directors).length;
  const totalUnidades = distinctNames(analysis?.units).length;
  const totalPeriodosIdentificados = (analysis?.periodLabels || []).length;

  // -------------------------------------------------------------------------
  // Referência dos INDICADORES: qual é hoje e qual será depois da atualização
  // (último período mensal válido da nova planilha — nunca um mês fixo).
  // -------------------------------------------------------------------------
  const colunasAtuais = matrixPeriodColumns(registros, avaliacoes);
  const rotuloAtual = colunasAtuais.length ? colunasAtuais[colunasAtuais.length - 1] : null;
  const referenciaAtual = nomeAmigavel(rotuloAtual);
  let ultimoMesPlanilha = null;
  for(let i = (analysis?.periodLabels || []).length - 1; i >= 0; i--){
    const lab = analysis.periodLabels[i];
    if(chavePeriodo(lab, janela).startsWith('M:')){ ultimoMesPlanilha = lab; break; }
  }
  const chaveAtual = rotuloAtual ? chavePeriodo(rotuloAtual, janela) : null;
  const chaveNova = ultimoMesPlanilha ? chavePeriodo(ultimoMesPlanilha, janela) : null;
  const avanca = Boolean(chaveNova && (!chaveAtual || chaveNova >= chaveAtual));
  const referenciaNova = (avanca ? nomeAmigavel(ultimoMesPlanilha) : referenciaAtual) || referenciaAtual;
  const referencia = { atual: referenciaAtual || '—', nova: referenciaNova || '—', avanca };

  // -------------------------------------------------------------------------
  // 1) Registros da planilha: novos / reutilizados / reativados / arquivados
  //    / ignorados (sem diretor ou sem unidade) — identidade Diretor+Unidade.
  // -------------------------------------------------------------------------
  const rotuloPessoa = (d: string | null, u: string | null) => `${normName(d) || '—'} · ${normName(u) || '—'}`;
  const registrosPrev = {
    novos: resumo.novos,
    reutilizados: resumo.reutilizados,
    reativados: resumo.reativados,
    arquivados: resumo.arquivados,
    ignoradas: resumo.ignoradas,
    ignoradasSemDiretor: resumo.ignoradasSemDiretor,
    ignoradasSemUnidade: resumo.ignoradasSemUnidade,
    novosDetalhes: plano.novos.map(n => rotuloPessoa(n.diretor, n.unidade)),
    reativadosDetalhes: plano.reativados.map(n => rotuloPessoa(n.diretor, n.unidade)),
    arquivadosDetalhes: plano.arquivados.map(r => rotuloPessoa(r.diretor, r.unidade)),
    ignoradasDetalhes: plano.ignoradas.map(i =>
      `Linha ${i.linha} — ${rotuloPessoa(i.diretor, i.unidade)} (${i.motivo === 'sem-diretor' ? 'sem diretor' : 'sem unidade'})`)
  };

  // -------------------------------------------------------------------------
  // 2) Períodos NOVOS que serão inseridos (agregados por rótulo).
  // -------------------------------------------------------------------------
  const linhasNovasPeriodos = [
    ...plano.periodos.insercoesNovos,
    ...plano.periodos.insercoesExistentes.flatMap(i => i.rows)
  ] as { rotulo_periodo: string; estagio?: string | null; nivel?: string | null }[];
  const porRotulo = new Map<string, { label: string; comStatus: number; comNivel: number; semPreenchimento: number; registros: number }>();
  for(const row of linhasNovasPeriodos){
    const ent = porRotulo.get(row.rotulo_periodo)
      || { label: row.rotulo_periodo, comStatus: 0, comNivel: 0, semPreenchimento: 0, registros: 0 };
    ent.registros++;
    const s = statusLido(row.estagio);
    const n = nivelLido(row.nivel);
    if(s) ent.comStatus++;
    if(n) ent.comNivel++;
    if(!s && !n) ent.semPreenchimento++;
    porRotulo.set(row.rotulo_periodo, ent);
  }
  const ordemLabels = new Map((analysis?.periodLabels || []).map((l, i) => [l, i]));
  const novosPeriodos: PeriodoNovoResumo[] = [...porRotulo.values()].sort((a, b) =>
    (ordemLabels.get(a.label) ?? Number.MAX_SAFE_INTEGER) - (ordemLabels.get(b.label) ?? Number.MAX_SAFE_INTEGER));

  // -------------------------------------------------------------------------
  // 3) Campos VAZIOS que serão completados (período existente + sistema com
  //    campo vazio + planilha com valor). Nunca substitui valor preenchido.
  // -------------------------------------------------------------------------
  const completacoes = plano.periodos.completacoes;

  // -------------------------------------------------------------------------
  // 4) DIVERGÊNCIAS: toda diferença planilha × sistema com a ação real.
  // -------------------------------------------------------------------------
  const divergencias = plano.divergencias.map(d => ({
    ...d,
    valorSistemaExibido: valorExibido(d.valorSistema),
    valorPlanilhaExibido: valorExibido(d.valorPlanilha)
  }));
  const divergenciasMantidas = divergencias.filter(d => d.acao === 'mantido');
  const conflitosAjuste = divergencias.filter(d => d.origem === 'Ajuste manual').length;

  // -------------------------------------------------------------------------
  // 5) Períodos existentes preservados (nenhuma linha atual é modificada).
  // -------------------------------------------------------------------------
  const rotulosPreservados = new Map<string, string>();
  for(const r of todosRegistros){
    for(const p of r.periodos ||[]){
      const k = chavePeriodo(p.rotulo, janela);
      if(!rotulosPreservados.has(k)) rotulosPreservados.set(k, normName(p.rotulo));
    }
  }
  const periodosPreservados = {
    total: chavesExistentes.size,
    registros: registros.length,
    rotulos: [...rotulosPreservados.values()]
  };

  // -------------------------------------------------------------------------
  // 6) Ajustes manuais preservados (prioridade sobre valor repetido).
  // -------------------------------------------------------------------------
  const ajustesDetalhes: AjustePreservado[] = [];
  for(const r of todosRegistros){
    for(const p of r.periodos ||[]){
      if(!p.ajustado) continue;
      ajustesDetalhes.push({
        diretor: r.diretor,
        unidade: r.unidade,
        periodo: p.rotulo,
        statusOriginal: normName(p.estagioOriginal) || '—',
        nivelOriginal: p.nivelOriginal != null && ROMANOS[p.nivelOriginal] ? `(${ROMANOS[p.nivelOriginal]})` : '—',
        statusVigente: normName(p.estagio) || '—',
        nivelVigente: normName(p.nivel) || '—'
      });
    }
  }
  const ajustesPreservados = { total: ajustesDetalhes.length, detalhes: ajustesDetalhes };

  // -------------------------------------------------------------------------
  // 7) Notas e indicadores (referência mais recente) + o que muda de fato.
  // -------------------------------------------------------------------------
  const nomesReconhecidos = [...new Set(records.flatMap(r =>
    Object.entries(r.metrics || {}).filter(([, v]) => v != null).map(([n]) => n)))];
  const registrosIndicadores = records.filter(r =>
    (r.indicators || []).length > 0 || Object.values(r.metrics || {}).some(v => v != null));
  const indicadoresDetalhes: IndicadorDetalhe[] = registrosIndicadores.map(r => ({
    diretor: r.director,
    unidade: r.unit,
    valores: Object.entries(r.metrics || {}).filter(([, v]) => v != null).map(([nome, valor]) => ({ nome, valor }))
  }));
  const indicadores = {
    totalRegistros: registrosIndicadores.length,
    referencia: periodoMaisRecente,
    nomes: nomesReconhecidos,
    detalhes: indicadoresDetalhes,
    atualizados: resumo.indicadoresAtualizados,
    novos: resumo.indicadoresNovos,
    registrosComMudanca: resumo.registrosComIndicadores,
    preservadosPorAjuste: divergencias.filter(d => d.tipo === 'indicador' && d.origem === 'Ajuste manual')
      .map(d => ({ diretor: d.diretor, unidade: d.unidade, campo: d.campo, valorSistema: valorExibido(d.valorSistema), valorPlanilha: valorExibido(d.valorPlanilha) }))
  };

  // -------------------------------------------------------------------------
  // 8) Cadastros identificados (somente identificação — nada é re-vinculado).
  // -------------------------------------------------------------------------
  function diretorExisteNoSistema(d: string): boolean {
    // Mesmo diretor com unidade totalmente diferente continua "existente"
    // (mudança de unidade é sinalizada à parte).
    return porDiretor.has(nameKey(d));
  }
  const diretoresPlanilha = (analysis?.directors || []).filter(isPresentName);
  const diretoresNovos = diretoresPlanilha.filter(d => !diretorExisteNoSistema(d));
  const diretoresExistentes = diretoresPlanilha.filter(diretorExisteNoSistema);

  const regionaisNoSistema = new Set(regionalsOf(todosRegistros).map(nameKey));
  const regionaisNovas = distinctNames(analysis?.regionals).filter(x => !regionaisNoSistema.has(nameKey(x)));

  const unidadesNoSistema = new Set(todosRegistros.filter(r => isPresentName(r.unidade)).map(r => nameKey(r.unidade)));
  const unidadesNovas = (analysis?.units || []).filter(isPresentName).filter(u => !unidadesNoSistema.has(nameKey(u)));
  const unidadesExistentes = (analysis?.units || []).filter(isPresentName).filter(u => unidadesNoSistema.has(nameKey(u)));

  const mudancasRegional: MudancaCadastro[] = [];
  const mudancasUnidade: MudancaCadastro[] = [];
  for(const rec of records){
    if(!isPresentName(rec.director)) continue;
    const atualD = porDiretor.get(nameKey(rec.director));
    if(!atualD) continue;
    const anterior = atualD.record;
    if(nameKey(rec.regional) !== nameKey(anterior.regional)){
      mudancasRegional.push({ diretor: rec.director, unidade: rec.unit, anterior: normName(anterior.regional), novo: normName(rec.regional) });
    }
    if(isPresentName(rec.unit) && isPresentName(anterior.unidade) && nameKey(rec.unit) !== nameKey(anterior.unidade)){
      mudancasUnidade.push({ diretor: rec.director, anterior: normName(anterior.unidade), novo: normName(rec.unit) });
    }
  }
  const cadastros = {
    regionaisNovas,
    diretoresExistentes: diretoresExistentes.length,
    diretoresNovos,
    unidadesExistentes: unidadesExistentes.length,
    unidadesNovas,
    semDiretor: analysis?.rowsWithoutDirector || 0,
    mudancasRegional,
    mudancasUnidade
  };

  // -------------------------------------------------------------------------
  // 9) Pendências e alertas (somente quando necessário; não bloqueiam salvo
  //    risco de corrupção — arquivo idêntico bloqueia na prévia).
  // -------------------------------------------------------------------------
  const pendencias: Pendencia[] = [];
  // Arquivo binariamente idêntico (hash): bloqueia quando já importado no
  // MESMO período (runImport aplica a mesma regra via classifyHashDuplicates);
  // em outro período é apenas aviso — a avaliação anterior permanece intacta.
  const identico = (arquivosIguais || []).filter(a => a && a.status !== 'erro');
  const mesmoPeriodo = meta
    ? identico.filter(a => Number(a.ano) === Number(meta.ano) && Number(a.trimestre) === Number(meta.trimestre))
    : identico;
  const outroPeriodo = meta ? identico.filter(a => !mesmoPeriodo.includes(a)) : [];
  if(mesmoPeriodo.length > 0){
    pendencias.push({ tipo: 'arquivo-identico', mensagem: 'Este mesmo arquivo já foi importado neste período.', bloqueia: true });
  }
  if(outroPeriodo.length > 0){
    pendencias.push({
      tipo: 'arquivo-identico-outro',
      mensagem: `Este mesmo arquivo já foi importado em ${outroPeriodo.map(d => `${d.trimestre}/${d.ano}`).join(', ')} — as avaliações anteriores permanecem intactas.`
    });
  }
  if(resumo.ignoradasSemDiretor > 0){
    pendencias.push({ tipo: 'sem-diretor', mensagem: `${resumo.ignoradasSemDiretor} linha(s) sem diretor serão IGNORADAS (não viram registro).` });
  }
  if(resumo.ignoradasSemUnidade > 0){
    pendencias.push({ tipo: 'sem-unidade', mensagem: `${resumo.ignoradasSemUnidade} linha(s) sem unidade informada serão IGNORADAS (a identidade é Diretor + Unidade).` });
  }
  if(resumo.arquivados > 0){
    pendencias.push({ tipo: 'arquivado', mensagem: `${resumo.arquivados} registro(s) existente(s) não está(ão) na planilha e serão ARQUIVADOS (nada é apagado).` });
  }
  let periodosVazios = 0;
  for(const rec of records){
    for(const h of rec.history ||[]){
      if(!statusLido(h.stage) && !nivelLido(h.level)) periodosVazios++;
    }
  }
  if(periodosVazios > 0){
    pendencias.push({ tipo: 'periodo-vazio', mensagem: `${periodosVazios} período(s) estão sem Status e sem Nível na planilha.` });
  }
  if((analysis?.missingOptional || []).length > 0){
    pendencias.push({ tipo: 'cabecalho', mensagem: `Colunas opcionais não reconhecidas: ${analysis.missingOptional.map(f => f.label).join(', ')}.` });
  }
  if((analysis?.duplicates || []).length > 0){
    pendencias.push({ tipo: 'duplicado', mensagem: `${analysis.duplicates.length} combinação(ões) de regional/diretor/unidade repetida(s) de forma inconsistente.` });
  }
  if((analysis?.invalidMetricCells || []).length > 0){
    pendencias.push({ tipo: 'indicador-invalido', mensagem: `${analysis.invalidMetricCells.length} célula(s) de indicador(es) com valor inválido (não numérico).` });
  }
  // Status/Nível que o sistema não sabe interpretar (Nível fora de I–V; Status
  // fora das opções conhecidas). Alerta simples, nunca bloqueia a atualização.
  const estagiosSistema: string[] = [];
  for(const r of todosRegistros) for(const p of r.periodos || []){
    const s = normName(p.estagio);
    if(s) estagiosSistema.push(s);
  }
  const opcoesConhecidas = new Set(opcoesStatus(estagiosSistema).map(s => s.toLocaleLowerCase('pt-BR')));
  let nivelInvalido = 0;
  const statusNaoPrevistos = new Set<string>();
  for(const rec of records){
    for(const h of rec.history ||[]){
      const n = nivelLido(h.level);
      if(n && romanLevel(n) == null) nivelInvalido++;
      const s = statusLido(h.stage);
      if(s && !opcoesConhecidas.has(s.toLocaleLowerCase('pt-BR'))) statusNaoPrevistos.add(s);
    }
  }
  if(nivelInvalido > 0){
    pendencias.push({ tipo: 'nivel-invalido', mensagem: `${nivelInvalido} período(s) com Nível fora da faixa aceita (I a V).` });
  }
  if(statusNaoPrevistos.size > 0){
    pendencias.push({ tipo: 'status-invalido', mensagem: `Status não reconhecido pelo sistema: ${[...statusNaoPrevistos].join(', ')}.` });
  }
  const retroativos = novosPeriodos.filter(p => {
    const k = chavePeriodo(p.label, janela);
    return k.startsWith('M:') && ultimoMesExistente != null && k < ultimoMesExistente;
  });
  for(const p of retroativos){
    pendencias.push({ tipo: 'retroativo', mensagem: `O período “${p.label}” é anterior ao último período já cadastrado no sistema.` });
  }
  if(conflitosAjuste > 0){
    pendencias.push({ tipo: 'conflito-ajuste', mensagem: `${conflitosAjuste} ajuste(s) manual(is) tem prioridade sobre valores repetidos na nova planilha.` });
  }
  const mantidasSemAjuste = divergenciasMantidas.length - conflitosAjuste;
  if(mantidasSemAjuste > 0){
    pendencias.push({ tipo: 'divergencia', mensagem: `${mantidasSemAjuste} divergência(s) entre planilha e sistema serão MANTIDAS (a prioridade do sistema preserva o valor já existente).` });
  }

  const bloqueado = pendencias.some(p => p.bloqueia) || !analysis?.ok;

  return {
    analisadoEm: analysis?.importedAt || new Date().toISOString(),
    arquivoNome: analysis?.sourceName || '—',
    periodoMaisRecente,
    totalRegistros: records.length,
    totalDiretores,
    totalUnidades,
    totalPeriodosIdentificados,
    referencia,
    registros: registrosPrev,
    novosPeriodos,
    completacoes,
    divergencias,
    divergenciasMantidas,
    periodosPreservados,
    ajustesPreservados,
    indicadores,
    cadastros,
    pendencias,
    bloqueado
  };
}

export { chavePeriodo };
