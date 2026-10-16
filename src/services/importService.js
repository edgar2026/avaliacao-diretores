import { computeSha256 } from './hashService.js';
import { uploadPlanilha, buildStoragePath, contentTypeFor, STORAGE_BUCKET } from './storageService.js';
import {
  findAvaliacoesByHash, classifyHashDuplicates, createAvaliacao, updateArquivoInfo,
  publishAvaliacao, markAvaliacaoErro, insertRegistros, insertPeriodos, insertIndicadores
} from './avaliacoesService.js';

export const STAGES = {
  VALIDANDO: 'validando',
  ENVIANDO: 'enviando',
  SALVANDO: 'salvando',
  ATUALIZANDO_PERIODOS: 'atualizando_periodos',
  ATUALIZANDO_INDICADORES: 'atualizando_indicadores',
  ATUALIZANDO_CADASTROS: 'atualizando_cadastros',
  CONCLUIDO: 'concluido'
};

export const STAGE_LABELS = {
  [STAGES.VALIDANDO]: 'Validando',
  [STAGES.ENVIANDO]: 'Salvando arquivo',
  [STAGES.SALVANDO]: 'Salvando dados',
  [STAGES.ATUALIZANDO_PERIODOS]: 'Atualizando períodos',
  [STAGES.ATUALIZANDO_INDICADORES]: 'Atualizando indicadores',
  [STAGES.ATUALIZANDO_CADASTROS]: 'Atualizando cadastros',
  [STAGES.CONCLUIDO]: 'Concluído'
};

export class ImportError extends Error {
  constructor(message, { stage, code, details } = {}){
    super(message);
    this.name = 'ImportError';
    this.stage = stage || null;
    this.code = code || 'IMPORT_ERROR';
    this.details = details || null;
  }
}

function buildRegistrosRows(analysis, avaliacaoId){
  return analysis.records.map((record, index) => ({
    id: crypto.randomUUID(),
    avaliacao_id: avaliacaoId,
    codigo_regional: record.regionalCode || null,
    regional: record.regional,
      diretor: record.director,
    unidade: record.unit,
    status_gestao: record.currentStage || null,
    ciclo_vida: record.lifeCycle || null,
    nivel_atual: record.currentLevel || null,
    numero_linha_origem: index + analysis.headerRow + 1,
    dados_originais: {
      regional: record.regional,
      regional_codigo: record.regionalCode,
    diretor: record.director,
      unidade: record.unit,
      status_gestao: record.currentStage,
      ciclo_vida: record.lifeCycle,
      nivel_atual: record.currentLevel,
      historico: record.history,
      metricas: record.metrics,
      indicadores: record.indicators
    },
    _record: record
  }));
}

function buildPeriodosRows(registrosRows, analysis){
  const rows = [];
  registrosRows.forEach(reg => {
    reg._record.history.forEach((entry, ordem) => {
      rows.push({
        id: crypto.randomUUID(),
        registro_id: reg.id,
        rotulo_periodo: entry.period,
        ordem,
        estagio: entry.stage,
        nivel: entry.level
      });
    });
  });
  return rows;
}

function buildIndicadoresRows(registrosRows){
  const rows = [];
  registrosRows.forEach(reg => {
    reg._record.indicators.forEach(ind => {
      rows.push({
        id: crypto.randomUUID(),
        registro_id: reg.id,
        nome_indicador: ind.name,
        valor_numerico: ind.valor_numerico,
        valor_texto: ind.valor_texto,
        unidade_medida: ind.unidade_medida,
        ordem: ind.ordem
      });
    });
  });
  return rows;
}

/**
 * Fluxo completo de importação (nunca apaga nem substitui avaliações anteriores).
 * 1) valida e calcula hash  2) bloqueia duplicidade  3) cria avaliação `processando`
 * 4) envia arquivo  5) grava registros/períodos/indicadores  6) publica
 * Em falha: marca a avaliação como `erro` e informa o estágio.
 */
export async function runImport({ file, data, analysis, meta, onProgress }){
  const progress = onProgress || (() => {});
  let stage = STAGES.VALIDANDO;
  let avaliacaoId = null;
  const setStage = next => { stage = next; progress(next); };

  try{
    setStage(STAGES.VALIDANDO);

    if(!analysis?.ok){
      const missing = (analysis?.missingRequired || []).map(f => f.label).join(', ');
      throw new ImportError(missing ? `Campos obrigatórios ausentes na Planilha1: ${missing}.` : 'A planilha não gerou registros válidos.',
        { stage, code: 'INVALID_SHEET' });
    }
    const titulo = String(meta?.titulo || '').trim();
    const trimestre = Number(meta?.trimestre);
    const ano = Number(meta?.ano);
    if(!titulo) throw new ImportError('Informe o título da avaliação.', { stage, code: 'INVALID_META' });
    if(!(trimestre >= 1 && trimestre <= 4)) throw new ImportError('Trimestre deve estar entre 1 e 4.', { stage, code: 'INVALID_META' });
    if(!(ano >= 2000 && ano <= 2100)) throw new ImportError('Ano deve estar entre 2000 e 2100.', { stage, code: 'INVALID_META' });

    const hash = await computeSha256(data);
    const existing = await findAvaliacoesByHash(hash);
    const duplicates = classifyHashDuplicates(existing, { ano, trimestre });
    if(duplicates.blocked){
      throw new ImportError(
        `Arquivo já importado: este conteúdo (hash ${hash.slice(0,12)}…) já existe como avaliação ${ano}/${trimestre}.`,
        { stage, code: 'DUPLICATE_HASH', details: duplicates }
      );
    }

    avaliacaoId = crypto.randomUUID();
    const storagePath = buildStoragePath({ ano, trimestre, avaliacaoId, fileName: file.name });

    await createAvaliacao({
      id: avaliacaoId,
      titulo,
      trimestre,
      ano,
      status: 'processando',
      arquivo_nome_original: file.name,
      storage_bucket: STORAGE_BUCKET,
      arquivo_hash: hash,
      total_registros: analysis.records.length,
      total_colunas: analysis.columnCount
    });

    setStage(STAGES.ENVIANDO);
    await uploadPlanilha(storagePath, data, contentTypeFor(file.name));
    await updateArquivoInfo(avaliacaoId, {
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      arquivo_nome_original: file.name
    });

    setStage(STAGES.SALVANDO);
    const registrosRows = buildRegistrosRows(analysis, avaliacaoId);
    const periodosRows = buildPeriodosRows(registrosRows, analysis);
    const indicadoresRows = buildIndicadoresRows(registrosRows);

    // Acompanhamento para a interface (não altera o que nem a ordem gravada):
    // registros e períodos primeiro, depois os indicadores.
    setStage(STAGES.ATUALIZANDO_PERIODOS);
    await insertRegistros(registrosRows.map(({ _record, ...row }) => row));
    await insertPeriodos(periodosRows);
    setStage(STAGES.ATUALIZANDO_INDICADORES);
    await insertIndicadores(indicadoresRows);
    // Acompanhamento para a interface (publicação = cadastros novos passam a
    // aparecer nos filtros): nenhum dado extra é gravado neste estágio.
    setStage(STAGES.ATUALIZANDO_CADASTROS);
    await publishAvaliacao(avaliacaoId, {
      totalRegistros: analysis.records.length,
      totalColunas: analysis.columnCount
    });

    setStage(STAGES.CONCLUIDO);
    return {
      avaliacaoId,
      titulo,
      ano,
      trimestre,
      hash,
      arquivoNome: file.name,
      storagePath,
      totalRegistros: analysis.records.length,
      totalPeriodos: periodosRows.length,
      totalIndicadores: indicadoresRows.length,
      duplicateInOtherPeriod: duplicates.otherPeriod
    };
  }catch(err){
    const stageLabel = STAGE_LABELS[stage] || stage;
    if(avaliacaoId){
      await markAvaliacaoErro(avaliacaoId, `${stageLabel}: ${err.message}`);
    }
    if(err instanceof ImportError){
      err.stage = err.stage || stage;
      throw err;
    }
    throw new ImportError(`Falha em "${stageLabel}": ${err.message}`, { stage, code: 'IMPORT_FAILED', details: err });
  }
}
