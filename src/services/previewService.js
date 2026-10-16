import { parseMonthHeader, nameKey, normName, isPresentName, distinctNames, regionalsOf, matrixPeriodColumns } from './dashboardService.js';
import { opcoesStatus } from './ajustesService.js';
import { romanLevel } from '../dataParser.js';

// ---------------------------------------------------------------------------
// PRÉVIA DA ATUALIZAÇÃO PELA PLANILHA
//
// Comparação SOMENTE LEITURA entre a análise da nova planilha (em memória) e
// o estado atual do sistema (modelo já carregado do banco). Nada é gravado,
// enviado ao Storage ou alterado por esta camada — a prévia responde o que
// ACONTECERÁ quando o usuário confirmar a atualização incremental:
//   * períodos novos (que ainda não existem no sistema);
//   * campos vazios que serão completados (só campo vazio, nunca substitui);
//   * períodos existentes preservados (nenhuma linha atual é modificada);
//   * ajustes manuais preservados (prioridade sobre valor repetido);
//   * notas e indicadores que terão atualização na referência mais recente;
//   * referência ATUAL e NOVA dos indicadores (dinâmica, nunca um mês fixo);
//   * cadastros identificados (regionais/diretores/unidades novos ou existentes);
//   * pendências e alertas simples.
// ---------------------------------------------------------------------------

const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V'];

// Nome amigável de um rótulo de período — MESMA regra do título da tela
// ("SET/3TRI 2026" → "Setembro de 2026"). Nenhum mês é fixado no código: o
// valor vem sempre do último período mensal válido reconhecido nos dados.
const MESES_NOME = { JAN:'janeiro', FEV:'fevereiro', MAR:'março', ABR:'abril', MAI:'maio', JUN:'junho', JUL:'julho', AGO:'agosto', SET:'setembro', OUT:'outubro', NOV:'novembro', DEZ:'dezembro' };

function nomeAmigavel(label){
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

const eNaoInformado = v => /^n[ãa]o informad[oa]$/i.test(normName(v));

// Marcador de célula vazia usada na planilha ("-", "—", "n/d"): não é valor.
const eMarcador = v => /^[-—–]$/.test(normName(v)) || /^(n\/?d|s\/n|n\.d\.)$/i.test(normName(v));

/** Status lido de um período: presente e diferente de "Não informado". */
function statusLido(v){
  const s = normName(v);
  return s && !eNaoInformado(s) && !eMarcador(s) ? s : null;
}

/** Nível lido de um período: algarismo romano I–V ou texto presente. */
function nivelLido(v){
  const s = normName(v);
  if(!s || eNaoInformado(s) || eMarcador(s)) return null;
  return s;
}

function nivelPreenchido(periodo){
  if(periodo == null) return false;
  if(romanLevel(periodo.nivel) != null) return true;
  return nivelLido(periodo.nivel) != null;
}

function janelaAnos(avaliacoes){
  const anos = (avaliacoes || []).map(a => Number(a?.ano)).filter(y => Number.isFinite(y));
  if(!anos.length) return [2000, new Date().getFullYear() + 2];
  return [Math.min(...anos) - 2, Math.max(...anos) + 2];
}

/**
 * Chave de identidade de um PERÍODO entre planilha e sistema: mês/ano real
 * ("SET/3TRI 2026" e "01/09/2026" → M:2026-09). Rótulo sem mês reconhecível
 * cai para comparação literal (nunca inventa período).
 */
export function chavePeriodo(rotulo, janela){
  const h = parseMonthHeader(rotulo, janela);
  if(h.isMonth && h.month && h.year != null){
    return `M:${h.year}-${String(h.month).padStart(2, '0')}`;
  }
  return `R:${normName(rotulo).toUpperCase()}`;
}

/**
 * Monta a prévia COMPLETA da atualização incremental.
 * Entradas: análise local da planilha (dataParser) + modelo atual do sistema
 * (buildDashboardModel) + lista de avaliações com o MESMO hash (arquivo
 * binariamente idêntico, consulta apenas). Retorna objeto pronto para a UI.
 */
export function buildUpdatePreview({ analysis, model, arquivosIguais = [] }){
  const registros = model?.registros || [];
  const avaliacoes = model?.avaliacoes || [];
  const janela = janelaAnos(avaliacoes);
  const records = analysis?.records || [];

  // -------------------------------------------------------------------------
  // Estado ATUAL do sistema: registro mais recente por diretor + unidade,
  // conjunto de períodos já existentes e último mês já cadastrado.
  // -------------------------------------------------------------------------
  const ordemAval = new Map(avaliacoes.map((a, i) => [a.id, i]));
  const porChave = new Map();
  const porDiretor = new Map();
  for(const r of registros){
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
  const chavesExistentes = new Set();
  let ultimoMesExistente = null;
  for(const r of registros){
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
  // 1) Períodos NOVOS (não existem no sistema).
  // -------------------------------------------------------------------------
  const novosPeriodos = chavesPlanilha
    .filter(p => !chavesExistentes.has(p.chave))
    .map(p => {
      let comStatus = 0, comNivel = 0, semPreenchimento = 0;
      for(const rec of records){
        const h = (rec.history || []).find(x => x.period === p.label);
        const s = h ? statusLido(h.stage) : null;
        const n = h ? nivelLido(h.level) : null;
        if(s) comStatus++;
        if(n) comNivel++;
        if(!s && !n) semPreenchimento++;
      }
      return { label: p.label, comStatus, comNivel, semPreenchimento };
    });

  // -------------------------------------------------------------------------
  // 2) Campos VAZIOS que serão completados (período já existente + sistema
  //    com campo vazio + planilha com valor). Campo já preenchido nunca é
  //    substituído; ajuste manual ativo tem prioridade e é pulado.
  // -------------------------------------------------------------------------
  const completacoes = [];
  for(const rec of records){
    if(!isPresentName(rec.director)) continue;
    const atual = isPresentName(rec.unit)
      ? porChave.get(`${nameKey(rec.director)}|${nameKey(rec.unit)}`)
      : null;
    if(!atual) continue; // diretor/unidade novo: não é "completar"
    for(const h of rec.history ||[]){
      const kp = chavePeriodo(h.period, janela);
      if(!chavesExistentes.has(kp)) continue;
      let alvo = null;
      for(const p of atual.record.periodos ||[]){
        if(chavePeriodo(p.rotulo, janela) === kp){ alvo = p; break; }
      }
      if(!alvo || alvo.ajustado) continue;
      const novoStatus = statusLido(h.stage);
      const novoNivel = nivelLido(h.level);
      if(novoStatus && !statusLido(alvo.estagio)){
        completacoes.push({ diretor: rec.director, unidade: rec.unit, periodo: h.period, campo: 'Status', valorNovo: novoStatus });
      }
      if(novoNivel && !nivelPreenchido(alvo)){
        completacoes.push({ diretor: rec.director, unidade: rec.unit, periodo: h.period, campo: 'Nível', valorNovo: novoNivel });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3) Períodos existentes preservados (nenhuma linha atual é modificada).
  // -------------------------------------------------------------------------
  const rotulosPreservados = new Map();
  for(const r of registros){
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
  // 4) Ajustes manuais preservados (prioridade sobre valor repetido).
  // -------------------------------------------------------------------------
  const ajustesDetalhes = [];
  let conflitosAjuste = 0;
  for(const r of registros){
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
      // Conflito: a nova planilha traz valor diferente do ajuste vigente.
      const rec = records.find(x => isPresentName(x.director) && nameKey(x.director) === nameKey(r.diretor)
        && nameKey(x.unit) === nameKey(r.unidade));
      const h = rec && (rec.history || []).find(x => chavePeriodo(x.period, janela) === chavePeriodo(p.rotulo, janela));
      if(h){
        const s = statusLido(h.stage);
        if(s && normName(s).toLocaleLowerCase('pt-BR') !== normName(p.estagio).toLocaleLowerCase('pt-BR')) conflitosAjuste++;
      }
    }
  }
  const ajustesPreservados = { total: ajustesDetalhes.length, detalhes: ajustesDetalhes };

  // -------------------------------------------------------------------------
  // 5) Notas e indicadores que serão atualizados (referência mais recente).
  // -------------------------------------------------------------------------
  const nomesReconhecidos = [...new Set(records.flatMap(r =>
    Object.entries(r.metrics || {}).filter(([, v]) => v != null).map(([n]) => n)))];
  const registrosIndicadores = records.filter(r =>
    (r.indicators || []).length > 0 || Object.values(r.metrics || {}).some(v => v != null));
  const indicadoresDetalhes = registrosIndicadores.map(r => ({
    diretor: r.director,
    unidade: r.unit,
    valores: Object.entries(r.metrics || {}).filter(([, v]) => v != null).map(([nome, valor]) => ({ nome, valor }))
  }));
  const indicadores = {
    totalRegistros: registrosIndicadores.length,
    referencia: periodoMaisRecente,
    nomes: nomesReconhecidos,
    detalhes: indicadoresDetalhes
  };

  // -------------------------------------------------------------------------
  // 6) Cadastros identificados (somente identificação — nada é re-vinculado).
  // -------------------------------------------------------------------------
  function diretorExisteNoSistema(d){
    // Mesmo diretor com unidade totalmente diferente continua "existente"
    // (mudança de unidade é sinalizada à parte).
    return porDiretor.has(nameKey(d));
  }
  const diretoresPlanilha = (analysis?.directors || []).filter(isPresentName);
  const diretoresNovos = diretoresPlanilha.filter(d => !diretorExisteNoSistema(d));
  const diretoresExistentes = diretoresPlanilha.filter(diretorExisteNoSistema);

  const regionaisNoSistema = new Set(regionalsOf(registros).map(nameKey));
  const regionaisNovas = distinctNames(analysis?.regionals).filter(x => !regionaisNoSistema.has(nameKey(x)));

  const unidadesNoSistema = new Set(registros.filter(r => isPresentName(r.unidade)).map(r => nameKey(r.unidade)));
  const unidadesNovas = (analysis?.units || []).filter(isPresentName).filter(u => !unidadesNoSistema.has(nameKey(u)));
  const unidadesExistentes = (analysis?.units || []).filter(isPresentName).filter(u => unidadesNoSistema.has(nameKey(u)));

  const mudancasRegional = [];
  const mudancasUnidade = [];
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
  // 7) Pendências e alertas (somente quando necessário; não bloqueiam salvo
  //    risco de corrupção — arquivo idêntico bloqueia na prévia).
  // -------------------------------------------------------------------------
  const pendencias = [];
  const identico = (arquivosIguais || []).filter(a => a?.status !== 'erro');
  if(identico.length > 0){
    pendencias.push({ tipo: 'arquivo-identico', mensagem: 'Este mesmo arquivo já foi importado anteriormente.', bloqueia: true });
  }
  if(cadastros.semDiretor > 0){
    pendencias.push({ tipo: 'sem-diretor', mensagem: `${cadastros.semDiretor} registro(s) está(ão) sem diretor informado.` });
  }
  const semUnidade = records.filter(r => !isPresentName(r.unit)).length;
  if(semUnidade > 0){
    pendencias.push({ tipo: 'sem-unidade', mensagem: `${semUnidade} registro(s) está(ão) sem unidade informada.` });
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
  const estagiosSistema = [];
  for(const r of registros) for(const p of r.periodos || []){
    const s = normName(p.estagio);
    if(s) estagiosSistema.push(s);
  }
  const opcoesConhecidas = new Set(opcoesStatus(estagiosSistema).map(s => s.toLocaleLowerCase('pt-BR')));
  let nivelInvalido = 0;
  const statusNaoPrevistos = new Set();
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
    novosPeriodos,
    completacoes,
    periodosPreservados,
    ajustesPreservados,
    indicadores,
    cadastros,
    pendencias,
    bloqueado
  };
}
