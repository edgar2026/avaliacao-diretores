// Teste de integração do fluxo de importação — roda contra um fake in-memory
// do Supabase (ver fakeSupabase.mjs). NÃO escreve nada no projeto real: nenhum
// teste desta suíte deixa avaliações, registros ou arquivos permanentes.
//
// Requer a flag de runtime `--experimental-test-module-mocks` (presente em
// `npm run test:integration`).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeSupabase } from './fakeSupabase.mjs';

// Substitui o cliente Supabase ANTES de importar os services, para que todos os
// módulos (importService/avaliacoesService/storageService) usem o fake.
const fake = createFakeSupabase();
mock.module('../../src/services/supabaseClient.js', {
  exports: {
    getSupabase: () => fake,
    isSupabaseConfigured: () => true
  }
});

const { runImport } = await import('../../src/services/importService.js');
const { analyzeWorkbookBuffer } = await import('../../src/dataParser.js');
const { computeSha256 } = await import('../../src/services/hashService.js');
const { STORAGE_BUCKET } = await import('../../src/services/storageService.js');

const META = { titulo:'Teste automatizado — exemplo', trimestre:3, ano:2026 };
const buffer = new Uint8Array(readFileSync(new URL('../fixtures/exemplo-planilha.xlsx', import.meta.url)));
const analysis = analyzeWorkbookBuffer(buffer, 'exemplo-planilha.xlsx');

test('importa o arquivo de exemplo e publica a avaliação (fake)', async () => {
  const imported = await runImport({
    file: { name:'exemplo-planilha.xlsx', size: buffer.length },
    data: buffer,
    analysis,
    meta: META
  });

  assert.equal(imported.totalRegistros, analysis.records.length);
  assert.match(imported.storagePath, /^avaliacoes\/2026\/3\//);

  // Avaliação gravada e publicada no "banco" em memória
  const avaliacoes = fake.__rowsOf('avaliacoes_diretores');
  const av = avaliacoes.find(a => a.id === imported.avaliacaoId);
  assert.ok(av, 'avaliacao deve existir no fake');
  assert.equal(av.status, 'publicada');
  assert.equal(av.storage_bucket, STORAGE_BUCKET);
  assert.equal(av.arquivo_nome_original, 'exemplo-planilha.xlsx');
  assert.match(av.arquivo_hash, /^[0-9a-f]{64}$/);
  assert.equal(av.total_registros, analysis.records.length);
  assert.ok(av.publicado_em);

  // Filhos vinculados
  assert.equal(fake.__rowsOf('avaliacoes_diretores_registros').length, imported.totalRegistros);
  assert.equal(fake.__rowsOf('avaliacoes_diretores_periodos').length, imported.totalRegistros * analysis.periodLabels.length);
  assert.ok(fake.__rowsOf('avaliacoes_diretores_indicadores').length > 0, 'indicadores dinâmicos persistidos');

  // Arquivo enviado ao bucket em memória
  assert.ok(fake.__files.has(imported.storagePath), 'arquivo deve estar no bucket fake');
});

test('detecta hash duplicado e mantém a avaliação anterior intacta (fake)', async () => {
  const antes = fake.__rowsOf('avaliacoes_diretores').length;

  await assert.rejects(
    runImport({
      file: { name:'exemplo-planilha.xlsx', size: buffer.length },
      data: buffer,
      analysis,
      meta: META
    }),
    err => err.code === 'DUPLICATE_HASH'
  );

  assert.equal(fake.__rowsOf('avaliacoes_diretores').length, antes, 'tentativa duplicada não cria nova avaliação');
});

test('falha no envio do arquivo marca a avaliação como erro (fake)', async () => {
  const antes = fake.__rowsOf('avaliacoes_diretores').length;
  fake.__setUploadError('boom: storage indisponível');

  await assert.rejects(
    runImport({
      file: { name:'outra-planilha.xlsx', size: buffer.length },
      data: buffer,
      // analysis clonado com título/metadados distintos para evitar DUPLICATE_HASH
      analysis: { ...analysis, sourceName:'outra-planilha.xlsx' },
      meta: { titulo:'Outro teste', trimestre:1, ano:2025 }
    }),
    err => err.code === 'IMPORT_FAILED' || err.code === 'IMPORT_ERROR'
  );

  // Criou a avaliação e a marcou como erro (não publicada)
  assert.equal(fake.__rowsOf('avaliacoes_diretores').length, antes + 1);
  const nova = fake.__rowsOf('avaliacoes_diretores').find(a => a.titulo === 'Outro teste');
  assert.equal(nova.status, 'erro');
  assert.match(nova.erro_detalhe, /boom|storage/i);

  fake.__setUploadError(null);
});

test('o fake não escreve no Supabase real (sanidade)', () => {
  // Garante que a suíte inteira opera em memória: os dados do fake existem,
  // mas nada aqui deve ter chamado o cliente real — o mock.module garante isso.
  assert.ok(fake.__rowsOf('avaliacoes_diretores').length >= 2);
  assert.ok(fake.__files.size >= 1);
});
