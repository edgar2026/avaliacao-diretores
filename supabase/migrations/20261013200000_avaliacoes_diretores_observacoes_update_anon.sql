-- =============================================================================
-- Módulo: Avaliação de Diretores — UPDATE de observações para anon
-- Migration aditiva e idempotente. Permite ao papel `anon` (acesso provisório
-- sem login) editar e arquivar logicamente observações já criadas.
--
-- Regras:
--   * UPDATE apenas nas colunas: observacao (texto), arquivada_em (exclusão
--     lógica) e updated_at (preenchido pelo frontend ou pelo trigger);
--   * DELETE físico permanece BLOQUEADO (nenhuma política de DELETE existe);
--   * não altera permissões de outras tabelas;
--   * idempotente: pode ser executada mais de vez sem erro.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Privilégio de UPDATE em colunas específicas para anon em observações.
--    (Revoke prévio garante idempotência mesmo se a migration rodar 2x.)
-- -----------------------------------------------------------------------------
revoke update on public.avaliacoes_diretores_observacoes from anon;
grant update (observacao, arquivada_em, updated_at)
  on public.avaliacoes_diretores_observacoes to anon;

-- -----------------------------------------------------------------------------
-- 2) Política RLS de UPDATE para anon: permite editar/arquivar qualquer
--    observação (fase sem identidade de usuário). DELETE continua sem política.
-- -----------------------------------------------------------------------------
drop policy if exists avaliacoes_diretores_observacoes_update_anon_provisorio
  on public.avaliacoes_diretores_observacoes;

create policy avaliacoes_diretores_observacoes_update_anon_provisorio
  on public.avaliacoes_diretores_observacoes
  for update
  to anon
  using (true)
  with check (true);

comment on policy avaliacoes_diretores_observacoes_update_anon_provisorio
  on public.avaliacoes_diretores_observacoes is
  'PROVISÓRIO: anon pode editar texto e arquivar (exclusão lógica) observações. DELETE físico bloqueado.';
