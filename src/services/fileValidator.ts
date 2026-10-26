export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB (limite do bucket)
export const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'];

// Objeto mínimo de arquivo aceito (File do DOM ou mock de teste).
export interface ArquivoLike {
  name?: string;
  size?: number;
}

export interface ResultadoValidacaoArquivo {
  ok: boolean;
  errors: string[];
  name: string;
  size: number;
  extension: string;
}

export function getExtension(fileName = ''): string {
  const i = String(fileName).lastIndexOf('.');
  return i < 0 ? '' : String(fileName).slice(i).toLowerCase();
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB`;
  return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
}

export function validateSpreadsheetFile(file?: ArquivoLike | null): ResultadoValidacaoArquivo {
  const name = file?.name || '';
  const size = Number(file?.size ?? 0);
  const extension = getExtension(name);
  const errors: string[] = [];

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    errors.push(`Extensão "${extension || '(sem extensão)'}" não permitida. Use apenas ${ALLOWED_EXTENSIONS.join(' ou ')}.`);
  }
  if (size <= 0) {
    errors.push('Arquivo vazio ou sem tamanho informado.');
  } else if (size > MAX_FILE_BYTES) {
    errors.push(`Arquivo com ${formatBytes(size)} excede o limite de ${formatBytes(MAX_FILE_BYTES)}.`);
  }

  return { ok: errors.length === 0, errors, name, size, extension };
}
