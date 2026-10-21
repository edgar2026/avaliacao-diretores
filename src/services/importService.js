import { computeSha256 } from './hashService.js';
import { uploadPlanilha, buildStoragePath, contentTypeFor, STORAGE_BUCKET } from './storageService.js';
import {
  findAvaliacoesByHash, classifyHashDuplicates, createAvaliacao, updateArquivoInfo,
  publishAvaliacao, markAvaliacaoErro, insertRegistros, insertPeriodos, insertIndicadores,
  carregarBaseImportacao, updatePeriodo, updateIndicador, updateRegistrosEmLote
} from './avaliacoesService.js';
import { planejarAtualizacao } from './importPlan.js';

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

/**
 * Fluxo completo de importação com a REGRA DEFINITIVA (importPlan.js):
 * identidade Diretor+Unidade reutiliza/arquiva/reativa registros; a planilha
 * só cria registro novo, insere período novo, completa campo vazio e atualiza
 * indicadores (exceto os protegidos por ajuste manual). O plano é recalculado
 * AQUI a partir de uma leitura fresca do banco — a prévia usa a MESMA função
 * pura sobre o model em memória.
 * 1) valida e calcula hash  2) bloqueia duplicidade  3) cria avaliação
 *    `processando`  4) envia arquivo  5) monta o plano  6) grava as ações do
 *    plano  7) publica. Em falha: avaliação `erro` + estágio.
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
    const base = await carregarBaseImportacao();
    const plano = planejarAtualizacao({ base, analysis, avaliacaoId });

    // Registros: só os NOVOS entram com o avaliacao_id desta importação;
    // os reutilizados/reativados/arquivados mudam apenas situação/arquivamento.
    if(plano.registros.insercoes.length){
      await insertRegistros(plano.registros.insercoes);
    }

    setStage(STAGES.ATUALIZANDO_PERIODOS);
    for(const r of plano.periodos.reordenacoes){
      await updatePeriodo(r.id, { ordem: r.ordem });
    }
    const periodosParaInserir = [
      ...plano.periodos.insercoesNovos,
      ...plano.periodos.insercoesExistentes.flatMap(i => i.rows)
    ];
    if(periodosParaInserir.length){
      await insertPeriodos(periodosParaInserir);
    }
    for(const c of plano.periodos.completacoesPorPeriodo){
      await updatePeriodo(c.periodoId, c.patch);
    }

    setStage(STAGES.ATUALIZANDO_INDICADORES);
    const indicadoresParaInserir = [
      ...plano.indicadores.insercoesNovos,
      ...plano.indicadores.insercoesExistentes
    ];
    if(indicadoresParaInserir.length){
      await insertIndicadores(indicadoresParaInserir);
    }
    for(const a of plano.indicadores.atualizacoes){
      await updateIndicador(a.id, a.patch);
    }

    // Cadastros: situação atual, arquivamento (dupla fora da planilha) e
    // reativação (dupla de volta) — nunca identidade nem avaliacao_id.
    setStage(STAGES.ATUALIZANDO_CADASTROS);
    await updateRegistrosEmLote(plano.registros.atualizacoes);

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
      totalPeriodos: periodosParaInserir.length,
      totalIndicadores: indicadoresParaInserir.length,
      plano: plano.resumo,
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
