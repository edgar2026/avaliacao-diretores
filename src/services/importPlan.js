import {
  parseMonthHeader, nameKey, isPresentName, janelaDeAnos, buildMonthlyLabelMap
} from './dashboardService.js';
import { friendlyMetricName } from '../dataParser.js';

// ---------------------------------------------------------------------------
// REGRA DEFINITIVA DE IMPORTAÇÃO DA PLANILHA1 (módulo PURO: sem rede, sem UI)
//
// Fonte ÚNICA da decisão de importação: a mesma função `planejarAtualizacao`
// alimenta a PRÉVIA (previewService) e a GRAVAÇÃO (importService) — a tela de
// confirmação nunca promete algo diferente do que será escrito.
//
// 1) IDENTIDADE: o vínculo é (Diretor + Unidade) normalizados (espaços e
//    quebras de linha colapsados, caixa e acentos ignorados). NUNCA número de
//    linha, posição de coluna ou avaliacao_id. Linha sem diretor (ou sem
//    unidade) é IGNORADA — não vira registro.
// 2) REGISTRO = ENTIDADE reutilizável (não snapshot por importação):
//      * dupla já ativa           -> REUTILIZA (avaliacao_id imutável);
//      * dupla arquivada presente -> REATIVA (arquivado_em = null);
//      * dupla ativa ausente      -> ARQUIVA (arquivado_em = agora);
//      * dupla inexistente        -> CRIA registro novo.
// 3) PRIORIDADE (vigência): ajuste manual > cadastro manual > valor importado
//    > nova planilha. A planilha só escreve em:
//      * período NOVO do registro;
//      * campo VAZIO de período existente (completar);
//      * indicadores/notas do registro existente (EXCETO com ajuste manual);
//      * situação atual (regional, código, status de gestão, ciclo de vida,
//        nível atual) quando presente e diferente.
//    Valor de período já preenchido NUNCA é substituído: a diferença aparece
//    como DIVERGÊNCIA mantida.
// 4) DIVERGÊNCIAS: toda diferença planilha × sistema é listada com a ação
//    ("atualizado" para o que muda; "mantido" para o que a prioridade preserva).
// ---------------------------------------------------------------------------

const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Comparação de textos: caixa, acentos e espaços ignorados. */
export function normalizarTexto(v){
  return texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
}

const VAZIOS = new Set([
  '', 'não informado', 'nao informado', 'não informada', 'nao informada',
  '-', '—', '–', 'n/d', 'nd', 's/n', 'n/a', 'n.d.'
]);

/** Célula vazia/marcador ("-", "n/d", "Não informado"): não é valor. */
export function eValorVazio(v){
  return VAZIOS.has(normalizarTexto(v));
}

/** Status lido: presente e diferente de marcador de ausência. */
export function statusLido(v){
  const s = texto(v);
  return s && !eValorVazio(s) ? s : null;
}

/** Nível lido: mesma regra de célula presente (romano é validado à parte). */
export function nivelLido(v){
  const s = texto(v);
  return s && !eValorVazio(s) ? s : null;
}

/**
 * Chave de identidade de um PERÍODO entre planilha e sistema: mês/ano real
 * ("SET/3TRI 2026" → M:2026-09). Rótulo sem mês reconhecível cai para
 * comparação literal (nunca inventa período).
 */
export function chavePeriodo(rotulo, janela){
  const h = parseMonthHeader(rotulo, janela);
  if(h.isMonth && h.month && h.year != null){
    return `M:${h.year}-${String(h.month).padStart(2, '0')}`;
  }
  return `R:${normalizarTexto(rotulo).toUpperCase()}`;
}

/** Chave de identidade de um REGISTRO: Diretor + Unidade normalizados. */
export function chaveVinculo(diretor, unidade){
  return `${nameKey(diretor)}|${nameKey(unidade)}`;
}

function valorLinhaIndicador(ind){
  const num = ind?.valor_numerico;
  if(num != null && num !== '' && Number.isFinite(Number(num))){
    return { valor_numerico: Number(num), valor_texto: null };
  }
  const t = texto(ind?.valor_texto);
  if(t && !eValorVazio(t)) return { valor_numerico: null, valor_texto: t };
  return null;
}

function formatarValorIndicador(alvo){
  if(alvo == null) return '—';
  if(alvo.valor_numerico != null) return alvo.valor_numerico;
  return texto(alvo.valor_texto) || '—';
}

function valoresIguais(a, b){
  if(a == null || b == null) return a == null && b == null;
  if(a.valor_numerico != null && b.valor_numerico != null){
    return Number(a.valor_numerico) === Number(b.valor_numerico);
  }
  const ta = a.valor_numerico != null ? String(a.valor_numerico) : texto(a.valor_texto);
  const tb = b.valor_numerico != null ? String(b.valor_numerico) : texto(b.valor_texto);
  return normalizarTexto(ta) === normalizarTexto(tb);
}

function valorAtualDaRow(row){
  const n = row?.valor_numerico;
  return {
    valor_numerico: n != null && n !== '' && Number.isFinite(Number(n)) ? Number(n) : null,
    valor_texto: texto(row?.valor_texto) || null
  };
}

function nivelPreenchido(periodo){
  if(!periodo) return false;
  if(nivelLido(periodo.nivel)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Estado por chave (uma entrada por Diretor+Unidade na planilha)
// ---------------------------------------------------------------------------
function criarEstadoNovo(rec, linha){
  const registroId = uuid();
  return {
    novo: true,
    arquivado: false,
    registroId,
    diretor: rec.director,
    unidade: rec.unit,
    registro: {
      id: registroId,
      codigo_regional: texto(rec.regionalCode) || null,
      regional: rec.regional,
      diretor: rec.director,
      unidade: rec.unit,
      status_gestao: rec.currentStage || null,
      ciclo_vida: rec.lifeCycle || null,
      nivel_atual: rec.currentLevel || null,
      numero_linha_origem: linha,
      dados_originais: {
        regional: rec.regional,
        regional_codigo: rec.regionalCode,
        diretor: rec.director,
        unidade: rec.unit,
        status_gestao: rec.currentStage,
        ciclo_vida: rec.lifeCycle,
        nivel_atual: rec.currentLevel,
        historico: rec.history,
        metricas: rec.metrics,
        indicadores: rec.indicators
      }
    },
    linhasIndicadores: [],
    periodosPorChave: new Map(),
    indicadoresPorNome: new Map(),
    situacaoAplicada: true,
    patchSituacao: {},
    completacoes: [],
    completacoesPorPeriodo: new Map(),
    divergencias: [],
    periodosNovos: [],
    indicadoresInsercoes: [],
    indicadoresAtualizacoes: [],
    indicadoresVistos: new Map()
  };
}

function criarEstadoExistente(reg, arquivado, janela){
  const periodosPorChave = new Map();
  for(const p of reg.periodos || []) periodosPorChave.set(chavePeriodo(p.rotulo, janela), p);
  const rows = (reg.indicadores || []).map(i => ({
    id: i.id ?? null,
    nome: i.nome,
    valor_numerico: i.valorNumerico ?? null,
    valor_texto: i.valorTexto ?? null,
    unidade_medida: i.unidadeMedida ?? null,
    ordem: i.ordem ?? 0
  }));
  const dbPorNome = new Map();
  const dbPorFriendly = new Map();
  rows.forEach(row => {
    if(!row.id) return;
    const nk = normalizarTexto(row.nome);
    if(!dbPorNome.has(nk)) dbPorNome.set(nk, row);
    const fr = friendlyMetricName(row.nome);
    if(fr && !dbPorFriendly.has(fr)) dbPorFriendly.set(fr, row);
  });
  return {
    novo: false,
    arquivado,
    registroId: reg.id,
    diretor: reg.diretor,
    unidade: reg.unidade,
    registro: reg,
    situacaoAplicada: false,
    patchSituacao: {},
    completacoes: [],
    completacoesPorPeriodo: new Map(),
    divergencias: [],
    periodosNovos: [],
    periodosNovosChaves: new Set(),
    indicadoresInsercoes: [],
    indicadoresAtualizacoes: [],
    indicadoresVistos: new Map(),
    periodosPorChave,
    dbPorNome,
    dbPorFriendly,
    usados: new Set(),
    ordemIndicadorBase: rows.length ? Math.max(...rows.map(r => Number(r.ordem) || 0)) : 0
  };
}

function registrarDivergencia(est, entrada){
  est.divergencias.push({
    tipo: entrada.tipo,
    registroId: est.registroId,
    diretor: est.diretor,
    unidade: est.unidade,
    ...entrada
  });
}

// ---------------------------------------------------------------------------
// Situação atual (snapshot do registro): só valor PRESENTE e DIFERENTE muda.
// ---------------------------------------------------------------------------
const CAMPOS_SITUACAO = [
  { coluna: 'codigo_regional', campoModelo: 'codigoRegional', rotulo: 'Código da regional', parser: 'regionalCode', tipo: 'nome' },
  { coluna: 'regional', campoModelo: 'regional', rotulo: 'Regional', parser: 'regional', tipo: 'nome' },
  { coluna: 'status_gestao', campoModelo: 'statusGestao', rotulo: 'Status de gestão', parser: 'currentStage', tipo: 'valor' },
  { coluna: 'ciclo_vida', campoModelo: 'cicloVida', rotulo: 'Ciclo de vida', parser: 'lifeCycle', tipo: 'valor' },
  { coluna: 'nivel_atual', campoModelo: 'nivelAtual', rotulo: 'Nível atual', parser: 'currentLevel', tipo: 'valor' }
];

function aplicarSituacao(est, rec){
  if(est.situacaoAplicada) return;
  est.situacaoAplicada = true;
  for(const campo of CAMPOS_SITUACAO){
    const bruto = texto(rec[campo.parser]);
    const presente = campo.tipo === 'nome'
      ? (isPresentName(bruto) && !eValorVazio(bruto))
      : statusLido(bruto) != null;
    if(!presente) continue;
    const atual = texto(est.registro[campo.campoModelo]);
    if(normalizarTexto(bruto) === normalizarTexto(atual)) continue;
    est.patchSituacao[campo.coluna] = bruto;
    registrarDivergencia(est, {
      tipo: 'situacao',
      campo: campo.rotulo,
      valorSistema: atual || '—',
      valorPlanilha: bruto,
      origem: 'Planilha',
      acao: 'atualizado'
    });
  }
}

// ---------------------------------------------------------------------------
// Períodos de um registro existente: completar vazio / manter divergência /
// inserir novo (com ordem cronológica calculada no final).
// ---------------------------------------------------------------------------
function aplicarPeriodos(est, rec, janela){
  if(est.novo) return; // registro novo: períodos saem do histórico da 1ª linha
  for(const h of rec.history || []){
    const kp = chavePeriodo(h.period, janela);
    const alvoStatus = statusLido(h.stage);
    const alvoNivel = nivelLido(h.level);

    const existente = est.periodosPorChave.get(kp);
    if(!existente){
      if(est.periodosNovosChaves.has(kp)) continue; // repetida na própria planilha
      est.periodosNovosChaves.add(kp);
      est.periodosNovos.push({
        id: uuid(),
        registro_id: est.registroId,
        rotulo_periodo: texto(h.period),
        ordem: 0,
        estagio: texto(h.stage) || 'Não informado',
        nivel: texto(h.level) || 'Não informado'
      });
      continue;
    }

    const vigenteStatus = texto(existente.estagio);
    const vigenteNivel = texto(existente.nivel);
    const preenchidoStatus = statusLido(vigenteStatus) != null;
    const preenchidoNivel = nivelPreenchido(existente);

    if(existente.ajustado){
      // PRIORIDADE MANUAL: nunca escreve; divergência registrada.
      if(alvoStatus && normalizarTexto(alvoStatus) !== normalizarTexto(vigenteStatus)){
        registrarDivergencia(est, {
          tipo: 'periodo', periodo: texto(h.period), campo: 'Status',
          valorSistema: vigenteStatus || '—', valorPlanilha: alvoStatus,
          origem: 'Ajuste manual', acao: 'mantido'
        });
      }
      if(alvoNivel && normalizarTexto(alvoNivel) !== normalizarTexto(vigenteNivel)){
        registrarDivergencia(est, {
          tipo: 'periodo', periodo: texto(h.period), campo: 'Nível',
          valorSistema: vigenteNivel || '—', valorPlanilha: alvoNivel,
          origem: 'Ajuste manual', acao: 'mantido'
        });
      }
      continue;
    }

    if(alvoStatus && !preenchidoStatus){
      completarPeriodo(est, existente, 'Status', alvoStatus, { estagio: texto(h.stage) });
    }else if(alvoStatus && normalizarTexto(alvoStatus) !== normalizarTexto(vigenteStatus)){
      registrarDivergencia(est, {
        tipo: 'periodo', periodo: texto(h.period), campo: 'Status',
        valorSistema: vigenteStatus || '—', valorPlanilha: alvoStatus,
        origem: 'Valor importado', acao: 'mantido'
      });
    }

    if(alvoNivel && !preenchidoNivel){
      completarPeriodo(est, existente, 'Nível', alvoNivel, { nivel: texto(h.level) });
    }else if(alvoNivel && normalizarTexto(alvoNivel) !== normalizarTexto(vigenteNivel)){
      registrarDivergencia(est, {
        tipo: 'periodo', periodo: texto(h.period), campo: 'Nível',
        valorSistema: vigenteNivel || '—', valorPlanilha: alvoNivel,
        origem: 'Valor importado', acao: 'mantido'
      });
    }
  }
}

function completarPeriodo(est, periodo, campo, valorNovo, patch){
  est.completacoes.push({
    periodoId: periodo.id,
    registroId: est.registroId,
    diretor: est.diretor,
    unidade: est.unidade,
    periodo: texto(periodo.rotulo),
    campo,
    valorNovo
  });
  const atual = est.completacoesPorPeriodo.get(periodo.id) || { periodoId: periodo.id, patch: {} };
  Object.assign(atual.patch, patch);
  est.completacoesPorPeriodo.set(periodo.id, atual);
}

// ---------------------------------------------------------------------------
// Indicadores/notas do registro: atualizar valores da planilha; ajuste manual
// bloqueia a escrita (prioridade) e vira divergência mantida.
// ---------------------------------------------------------------------------
function aplicarIndicadores(est, rec){
  for(const ind of rec.indicators || []){
    const alvo = valorLinhaIndicador(ind);
    const nomeChave = normalizarTexto(ind?.nome);
    if(!nomeChave) continue;

    const jaVisto = est.indicadoresVistos.has(nomeChave);
    const visto = jaVisto ? est.indicadoresVistos.get(nomeChave) : null;
    if(jaVisto){
      // repetida na própria planilha: a primeira linha com valor vence.
      if(alvo && visto && !valoresIguais(alvo, visto)){
        registrarDivergencia(est, {
          tipo: 'indicador', campo: texto(ind.nome),
          valorSistema: formatarValorIndicador(visto), valorPlanilha: formatarValorIndicador(alvo),
          origem: 'Linha repetida na planilha', acao: 'mantido'
        });
      }
      if(visto) continue;
    }
    est.indicadoresVistos.set(nomeChave, alvo || visto || null);
    if(!alvo) continue; // célula vazia: nunca apaga valor existente

    const friendly = friendlyMetricName(ind?.nome);

    if(est.novo){
      if(est.indicadoresPorNome.has(nomeChave)) continue;
      const row = {
        id: uuid(),
        registro_id: est.registroId,
        nome_indicador: texto(ind.nome),
        valor_numerico: alvo.valor_numerico,
        valor_texto: alvo.valor_texto,
        unidade_medida: texto(ind.unidade_medida) || null,
        ordem: Number.isFinite(Number(ind.ordem)) ? Number(ind.ordem) : est.linhasIndicadores.length
      };
      est.linhasIndicadores.push(row);
      est.indicadoresPorNome.set(nomeChave, row);
      continue;
    }

    let row = est.dbPorNome.get(nomeChave) || null;
    if(!row && friendly){
      const candidato = est.dbPorFriendly.get(friendly);
      if(candidato && !est.usados.has(candidato.id)) row = candidato;
    }
    if(row) est.usados.add(row.id);

    const chaveAjuste = friendly || (row ? friendlyMetricName(row.nome) : null);
    const ajustado = Boolean(chaveAjuste && est.registro.metricasInfo?.[chaveAjuste]?.ajustado);

    if(!row){
      if(ajustado){
        const vigente = est.registro.metricas?.[chaveAjuste];
        const difere = vigente == null
          || (alvo.valor_numerico != null ? Number(alvo.valor_numerico) !== Number(vigente)
            : normalizarTexto(alvo.valor_texto) !== normalizarTexto(vigente));
        if(difere){
          registrarDivergencia(est, {
            tipo: 'indicador', campo: chaveAjuste || texto(ind.nome),
            valorSistema: vigente ?? '—', valorPlanilha: formatarValorIndicador(alvo),
            origem: 'Ajuste manual', acao: 'mantido'
          });
        }
        continue; // prioridade manual: não cria linha nova por cima
      }
      est.ordemIndicadorBase += 1;
      est.indicadoresInsercoes.push({
        id: uuid(),
        registro_id: est.registroId,
        nome_indicador: texto(ind.nome),
        valor_numerico: alvo.valor_numerico,
        valor_texto: alvo.valor_texto,
        unidade_medida: texto(ind.unidade_medida) || null,
        ordem: est.ordemIndicadorBase
      });
      continue;
    }

    const atual = valorAtualDaRow(row);
    if(valoresIguais(alvo, atual)) continue;

    if(ajustado){
      const vigente = est.registro.metricas?.[chaveAjuste];
      registrarDivergencia(est, {
        tipo: 'indicador', campo: chaveAjuste || row.nome,
        valorSistema: vigente ?? '—', valorPlanilha: formatarValorIndicador(alvo),
        origem: 'Ajuste manual', acao: 'mantido'
      });
      continue;
    }

    est.indicadoresAtualizacoes.push({
      id: row.id,
      registroId: est.registroId,
      diretor: est.diretor,
      unidade: est.unidade,
      campo: chaveAjuste || row.nome,
      de: formatarValorIndicador(atual),
      para: formatarValorIndicador(alvo),
      patch: { valor_numerico: alvo.valor_numerico, valor_texto: alvo.valor_texto }
    });
    registrarDivergencia(est, {
      tipo: 'indicador', campo: chaveAjuste || row.nome,
      valorSistema: formatarValorIndicador(atual), valorPlanilha: formatarValorIndicador(alvo),
      origem: 'Valor importado', acao: 'atualizado'
    });
  }
}

// ---------------------------------------------------------------------------
// Ordem cronológica dos períodos novos inseridos em registro existente
// (mesma regra do cadastro manual: os vizinhos sem ano são preservados e as
//  linhas seguintes são reposicionadas — só a coluna `ordem` muda).
// ---------------------------------------------------------------------------
function posicionarPeriodos(est, avaliacoes){
  const existentes = (est.registro.periodos || [])
    .slice()
    .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0));
  const novos = est.periodosNovos;
  if(!novos.length) return;

  const sintetico = [{
    avaliacaoId: est.registro.avaliacaoId,
    periodos: [
      ...existentes.map(p => ({ rotulo: p.rotulo, ordem: Number(p.ordem) || 0 })),
      ...novos.map((n, i) => ({ rotulo: n.rotulo_periodo, ordem: 1000000 + i }))
    ]
  }];
  const { labelMap } = buildMonthlyLabelMap(sintetico, avaliacoes);
  const infoDe = rotulo => labelMap.get(`${est.registro.avaliacaoId}|${rotulo}`) || null;

  const lista = existentes.map(p => ({ ref: p, existe: true, info: infoDe(p.rotulo) }));
  for(const n of novos){
    const infoNovo = infoDe(n.rotulo_periodo);
    let pos = lista.length;
    if(infoNovo){
      pos = 0;
      for(const item of lista){
        if(!item.info){ pos++; continue; } // sem ano reconhecido: fica antes
        const maisAntigo = item.info.year < infoNovo.year
          || (item.info.year === infoNovo.year && item.info.month < infoNovo.month);
        if(maisAntigo) pos++;
      }
    }
    lista.splice(pos, 0, { ref: n, existe: false, info: infoNovo });
  }

  // A ordem final é calculada SEM tocar no model da prévia: os períodos já
  // existentes mantêm seu `ordem` em memória (a reordenação sai só como
  // `periodosReordenacoes` gravável) e apenas as linhas NOVAS recebem posição.
  const ordemAntiga = new Map(existentes.map(p => [p.id, Number(p.ordem) || 0]));
  est.periodosReordenacoes = [];
  lista.forEach((item, posFinal) => {
    if(item.existe){
      const antes = ordemAntiga.get(item.ref.id) ?? 0;
      if(antes !== posFinal) est.periodosReordenacoes.push({ id: item.ref.id, ordem: posFinal });
    }else{
      item.ref.ordem = posFinal;
    }
  });
}

// ---------------------------------------------------------------------------
// PLANO COMPLETO — mesma entrada (base + análise) para prévia e gravação.
// ---------------------------------------------------------------------------
/**
 * @param base  { avaliacoes, registros, registrosArquivados } — estado atual
 *              (model do dashboard ou leitura fresca do banco).
 * @param analysis  saída do dataParser (analyzeWorkbookBuffer).
 * @returns plano com ações graváveis + listas para a prévia + resumo.
 */
export function planejarAtualizacao({ base, analysis, agora, avaliacaoId } = {}){
  const avaliacoes = base?.avaliacoes || [];
  const { janela } = janelaDeAnos(avaliacoes);
  const agoraIso = agora || new Date().toISOString();
  const ativas = base?.registros || [];
  const arquivadasBase = base?.registrosArquivados || [];

  const idxAtiva = new Map();
  const idxArquivada = new Map();
  for(const r of ativas){
    if(!isPresentName(r.diretor) || !isPresentName(r.unidade)) continue;
    const k = chaveVinculo(r.diretor, r.unidade);
    if(!idxAtiva.has(k)) idxAtiva.set(k, r);
  }
  for(const r of arquivadasBase){
    if(!isPresentName(r.diretor) || !isPresentName(r.unidade)) continue;
    const k = chaveVinculo(r.diretor, r.unidade);
    if(!idxAtiva.has(k) && !idxArquivada.has(k)) idxArquivada.set(k, r);
  }

  const headerRow = Number(analysis?.headerRow) || 0;
  const records = analysis?.records || [];
  const ignoradas = [];
  const estados = new Map();
  const novos = [];

  records.forEach((rec, index) => {
    const linha = index + headerRow + 1;
    const semDiretor = !isPresentName(rec.director);
    const semUnidade = !isPresentName(rec.unit);
    if(semDiretor || semUnidade){
      ignoradas.push({
        linha,
        diretor: texto(rec.director),
        unidade: texto(rec.unit),
        motivo: semDiretor ? 'sem-diretor' : 'sem-unidade'
      });
      return;
    }
    const chave = chaveVinculo(rec.director, rec.unit);
    let est = estados.get(chave);
    if(!est){
      const ativa = idxAtiva.get(chave);
      const arq = idxArquivada.get(chave);
      est = ativa
        ? criarEstadoExistente(ativa, false, janela)
        : arq
          ? criarEstadoExistente(arq, true, janela)
          : criarEstadoNovo(rec, linha);
      est.chave = chave;
      estados.set(chave, est);
      if(est.novo) novos.push(est);
    }
    aplicarSituacao(est, rec);
    aplicarPeriodos(est, rec, janela);
    aplicarIndicadores(est, rec);
  });

  // Arquivamento: registro ativo cuja dupla Diretor+Unidade NÃO está na planilha.
  const presentes = new Set(estados.keys());
  const arquivados = ativas.filter(r =>
    isPresentName(r.diretor) && isPresentName(r.unidade)
    && !presentes.has(chaveVinculo(r.diretor, r.unidade)));

  // Atribuição de criação: registros novos recebem o avaliacao_id desta
  // importação (nos demais ele é IMUTÁVEL — vira divergência/bloqueio no banco).
  for(const est of novos) est.registro.avaliacao_id = avaliacaoId ?? null;

  // Reordenação cronológica dos períodos novos em registros existentes.
  const periodosReordenacoes = [];
  const periodosInsercoes = [];
  for(const est of estados.values()){
    if(est.novo) continue;
    posicionarPeriodos(est, avaliacoes);
    for(const r of est.periodosReordenacoes || []) periodosReordenacoes.push(r);
    if(est.periodosNovos.length){
      periodosInsercoes.push({
        registroId: est.registroId,
        diretor: est.diretor,
        unidade: est.unidade,
        rows: est.periodosNovos
      });
    }
  }

  const reutilizados = [...estados.values()].filter(e => !e.novo && !e.arquivado);
  const reativados = [...estados.values()].filter(e => !e.novo && e.arquivado);

  const registrosAtualizacoes = [];
  for(const est of estados.values()){
    if(est.novo) continue;
    const patch = { ...est.patchSituacao };
    if(est.arquivado) patch.arquivado_em = null;
    if(Object.keys(patch).length){
      registrosAtualizacoes.push({ id: est.registroId, patch, reativado: est.arquivado });
    }
  }
  for(const r of arquivados){
    registrosAtualizacoes.push({ id: r.id, patch: { arquivado_em: agoraIso }, arquivado: true });
  }

  const completacoes = [];
  const completacoesPorPeriodo = [];
  const divergencias = [];
  const indicadoresAtualizacoes = [];
  const indicadoresInsercoes = [];
  const situacoes = [];
  for(const est of [...estados.values()]){
    completacoes.push(...est.completacoes);
    completacoesPorPeriodo.push(...est.completacoesPorPeriodo.values());
    divergencias.push(...est.divergencias);
    indicadoresAtualizacoes.push(...est.indicadoresAtualizacoes);
    indicadoresInsercoes.push(...est.indicadoresInsercoes);
    if(Object.keys(est.patchSituacao).length && !est.novo){
      situacoes.push({
        registroId: est.registroId,
        diretor: est.diretor,
        unidade: est.unidade,
        patch: est.patchSituacao
      });
    }
  }

  const registrosNovosLinhas = novos.map(est => est.registro);
  const periodosNovosLinhas = novos.flatMap(est => montarPeriodosDoRegistroNovo(est));
  const indicadoresNovosLinhas = novos.flatMap(est => est.linhasIndicadores);

  const resumo = {
    ignoradas: ignoradas.length,
    ignoradasSemDiretor: ignoradas.filter(i => i.motivo === 'sem-diretor').length,
    ignoradasSemUnidade: ignoradas.filter(i => i.motivo === 'sem-unidade').length,
    novos: novos.length,
    existentes: reutilizados.length + reativados.length,
    reutilizados: reutilizados.length,
    reativados: reativados.length,
    arquivados: arquivados.length,
    periodosNovos: periodosNovosLinhas.length + periodosInsercoes.reduce((n, i) => n + i.rows.length, 0),
    completacoes: completacoes.length,
    divergencias: divergencias.length,
    divergenciasMantidas: divergencias.filter(d => d.acao === 'mantido').length,
    divergenciasAtualizadas: divergencias.filter(d => d.acao === 'atualizado').length,
    situacoes: situacoes.length,
    indicadoresAtualizados: indicadoresAtualizacoes.length,
    indicadoresNovos: indicadoresInsercoes.length,
    registrosComIndicadores: new Set([
      ...indicadoresAtualizacoes.map(a => a.registroId),
      ...indicadoresInsercoes.map(a => a.registro_id),
      ...novos.filter(e => e.linhasIndicadores.length).map(e => e.registroId)
    ]).size
  };

  return {
    janela,
    agora: agoraIso,
    ignoradas,
    novos,
    reutilizados,
    reativados,
    arquivados,
    registros: {
      insercoes: registrosNovosLinhas,
      atualizacoes: registrosAtualizacoes
    },
    periodos: {
      insercoesNovos: periodosNovosLinhas,
      insercoesExistentes: periodosInsercoes,
      completacoes,
      completacoesPorPeriodo,
      reordenacoes: periodosReordenacoes
    },
    indicadores: {
      insercoesNovos: indicadoresNovosLinhas,
      insercoesExistentes: indicadoresInsercoes,
      atualizacoes: indicadoresAtualizacoes
    },
    situacoes,
    divergencias,
    resumo
  };
}

/** Períodos de um registro NOVO: ordem = posição horizontal da planilha. */
function montarPeriodosDoRegistroNovo(est){
  const history = est.registro.dados_originais?.historico || [];
  return history.map((entry, ordem) => ({
    id: uuid(),
    registro_id: est.registroId,
    rotulo_periodo: texto(entry.period),
    ordem,
    estagio: texto(entry.stage) || 'Não informado',
    nivel: texto(entry.level) || 'Não informado'
  }));
}

/** Base do modelo em memória (prévia) no mesmo formato da leitura fresca. */
export function baseDoModelo(model){
  return {
    avaliacoes: model?.avaliacoes || [],
    registros: model?.registros || [],
    registrosArquivados: model?.registrosArquivados || [],
    ajustesIndicadores: model?.ajustesIndicadores || []
  };
}
