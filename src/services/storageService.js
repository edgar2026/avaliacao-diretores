import { getSupabase } from './supabaseClient.js';
import { getExtension } from './fileValidator.js';

export const STORAGE_BUCKET = 'avaliacoes-diretores-planilhas';

const MIME_BY_EXTENSION = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel'
};

export function contentTypeFor(fileName){
  return MIME_BY_EXTENSION[getExtension(fileName)] || 'application/octet-stream';
}

export function sanitizeFileName(fileName = ''){
  const extension = getExtension(fileName);
  const base = extension ? fileName.slice(0, fileName.length - extension.length) : fileName;
  const safe = base
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,60) || 'planilha';
  return `${safe}${extension}`;
}

// Convenção: avaliacoes/{ano}/{trimestre}/{avaliacao_id}/{timestamp}-{nome-seguro}.xlsx
export function buildStoragePath({ ano, trimestre, avaliacaoId, fileName, timestamp = Date.now() }){
  return `avaliacoes/${ano}/${trimestre}/${avaliacaoId}/${timestamp}-${sanitizeFileName(fileName)}`;
}

export async function uploadPlanilha(path, data, contentType){
  const { error } = await getSupabase().storage.from(STORAGE_BUCKET).upload(path, data, {
    contentType,
    upsert: false,      // nunca sobrescrever
    cacheControl: '0'
  });
  if(error) throw new Error(`Falha no envio do arquivo ao Storage: ${error.message}`);
  return path;
}
