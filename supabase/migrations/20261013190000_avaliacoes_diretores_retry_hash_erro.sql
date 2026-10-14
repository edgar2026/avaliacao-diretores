-- =============================================================================
-- Módulo: Avaliação de Diretores — RETRY APÓS FALHA (hash × período)
-- Paridade local com a migration `avaliacoes_diretores_retry_hash_erro`
-- aplicada via MCP em 2026-10-13 (arquivo local criado na fase 3 para manter
-- o repositório como fonte de verdade). Idempotente.
--
-- O índice único de hash passa a IGNORAR tentativas com status 'erro', para
-- que o mesmo arquivo possa ser reenviado após uma importação falha.
-- `publicada` e `processando` no mesmo ano/trimestre continuam bloqueando.
-- =============================================================================

drop index if exists public.uq_avaliacoes_diretores_hash_periodo;

create unique index uq_avaliacoes_diretores_hash_periodo
  on public.avaliacoes_diretores (ano, trimestre, arquivo_hash)
  where arquivo_hash is not null and status <> 'erro';

comment on index public.uq_avaliacoes_diretores_hash_periodo is
  'Avaliação de Diretores: bloqueia reenvio do mesmo hash no mesmo ano/trimestre; tentativas com status erro não bloqueiam o retry.';
