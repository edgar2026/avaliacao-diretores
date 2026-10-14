-- =============================================================================
-- Módulo: Avaliação de Diretores — ACESSO ANON PROVISÓRIO (protótipo)
-- Migration aditiva e idempotente. NÃO recria bucket, tabelas, índices ou
-- políticas existentes: apenas concede, temporariamente, acesso pelo papel
-- `anon` aos recursos exclusivos deste módulo, para o protótipo funcionar
-- sem login próprio.
--
-- PROVISÓRIO: quando o módulo for incorporado ao sistema maior, as políticas
-- `*_anon_provisorio` devem ser REMOVIDAS e substituídas pelas políticas
-- baseadas no usuário já autenticado pelo sistema principal.
-- O módulo continuará sem possuir login próprio.
--
-- Regras desta fase:
--   * SELECT e INSERT somente nas 5 tabelas do módulo;
--   * UPDATE em avaliacoes_diretores apenas de `processando` para
--     `publicada`/`erro` (avaliações publicadas ficam imutáveis);
--   * upload e leitura apenas no bucket privado avaliacoes-diretores-planilhas;
--   * NENHUMA política de DELETE (nem tabelas, nem arquivos);
--   * NENHUMA política de UPDATE em storage.objects (sem sobrescrita);
--   * nenhum acesso a outras tabelas, buckets ou módulos;
--   * service_role nunca é usado no frontend.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Coluna aditiva: ponto da falha quando a importação é marcada como `erro`
--    (atende ao fluxo "informar o ponto da falha" de forma persistente).
-- -----------------------------------------------------------------------------
alter table public.avaliacoes_diretores
  add column if not exists erro_detalhe text;

comment on column public.avaliacoes_diretores.erro_detalhe is
  'Avaliação de Diretores (provisório): descreve o estágio em que a importação falhou quando status = erro.';

-- -----------------------------------------------------------------------------
-- 2) Privilégios explícitos para `anon` — somente recursos do módulo.
--    (A migration anterior revogou tudo de `anon`; aqui é concedido o mínimo.)
--    DELETE/TRUNCATE nunca são concedidos.
-- -----------------------------------------------------------------------------
revoke delete, truncate on public.avaliacoes_diretores from anon;
revoke delete, truncate on public.avaliacoes_diretores_registros from anon;
revoke delete, truncate on public.avaliacoes_diretores_periodos from anon;
revoke delete, truncate on public.avaliacoes_diretores_indicadores from anon;
revoke delete, truncate on public.avaliacoes_diretores_observacoes from anon;

grant select, insert on public.avaliacoes_diretores to anon;
-- UPDATE limitado às colunas estritamente necessárias ao fluxo de importação:
-- caminho do arquivo, totais, status, data de publicação e detalhe do erro.
grant update (storage_bucket, storage_path, arquivo_nome_original,
              total_registros, total_colunas, status, publicado_em,
              erro_detalhe)
  on public.avaliacoes_diretores to anon;

grant select, insert on public.avaliacoes_diretores_registros to anon;
grant select, insert on public.avaliacoes_diretores_periodos to anon;
grant select, insert on public.avaliacoes_diretores_indicadores to anon;
grant select, insert on public.avaliacoes_diretores_observacoes to anon;

-- -----------------------------------------------------------------------------
-- 3) Políticas RLS PROVISÓRIAS para `anon` nas tabelas do módulo
-- -----------------------------------------------------------------------------
drop policy if exists "avaliacoes_diretores_select_anon_provisorio" on public.avaliacoes_diretores;
create policy "avaliacoes_diretores_select_anon_provisorio" on public.avaliacoes_diretores
  for select to anon using (true);

drop policy if exists "avaliacoes_diretores_insert_anon_provisorio" on public.avaliacoes_diretores;
create policy "avaliacoes_diretores_insert_anon_provisorio" on public.avaliacoes_diretores
  for insert to anon with check (true);

-- UPDATE estritamente necessário: somente linhas que o próprio fluxo criou como
-- `processando` podem mudar, e apenas para `processando`, `publicada` ou `erro`.
-- Avaliações já publicadas/arquivadas/erro ficam IMUTÁVEIS.
drop policy if exists "avaliacoes_diretores_update_importacao_anon_provisorio" on public.avaliacoes_diretores;
create policy "avaliacoes_diretores_update_importacao_anon_provisorio" on public.avaliacoes_diretores
  for update to anon
  using (status = 'processando')
  with check (status in ('processando', 'publicada', 'erro'));

drop policy if exists "avaliacoes_diretores_registros_select_anon_provisorio" on public.avaliacoes_diretores_registros;
create policy "avaliacoes_diretores_registros_select_anon_provisorio" on public.avaliacoes_diretores_registros
  for select to anon using (true);

drop policy if exists "avaliacoes_diretores_registros_insert_anon_provisorio" on public.avaliacoes_diretores_registros;
create policy "avaliacoes_diretores_registros_insert_anon_provisorio" on public.avaliacoes_diretores_registros
  for insert to anon with check (true);

drop policy if exists "avaliacoes_diretores_periodos_select_anon_provisorio" on public.avaliacoes_diretores_periodos;
create policy "avaliacoes_diretores_periodos_select_anon_provisorio" on public.avaliacoes_diretores_periodos
  for select to anon using (true);

drop policy if exists "avaliacoes_diretores_periodos_insert_anon_provisorio" on public.avaliacoes_diretores_periodos;
create policy "avaliacoes_diretores_periodos_insert_anon_provisorio" on public.avaliacoes_diretores_periodos
  for insert to anon with check (true);

drop policy if exists "avaliacoes_diretores_indicadores_select_anon_provisorio" on public.avaliacoes_diretores_indicadores;
create policy "avaliacoes_diretores_indicadores_select_anon_provisorio" on public.avaliacoes_diretores_indicadores
  for select to anon using (true);

drop policy if exists "avaliacoes_diretores_indicadores_insert_anon_provisorio" on public.avaliacoes_diretores_indicadores;
create policy "avaliacoes_diretores_indicadores_insert_anon_provisorio" on public.avaliacoes_diretores_indicadores
  for insert to anon with check (true);

-- Observações: anon só lê e insere (sem autoria possível sem login);
-- a política de UPDATE continua restrita ao autor autenticado (existente).
drop policy if exists "avaliacoes_diretores_observacoes_select_anon_provisorio" on public.avaliacoes_diretores_observacoes;
create policy "avaliacoes_diretores_observacoes_select_anon_provisorio" on public.avaliacoes_diretores_observacoes
  for select to anon using (true);

drop policy if exists "avaliacoes_diretores_observacoes_insert_anon_provisorio" on public.avaliacoes_diretores_observacoes;
create policy "avaliacoes_diretores_observacoes_insert_anon_provisorio" on public.avaliacoes_diretores_observacoes
  for insert to anon
  with check (criado_por is null or criado_por = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 4) Storage: upload e leitura SOMENTE no bucket privado do módulo
--    (sem UPDATE => sem sobrescrita; sem DELETE => sem exclusão de arquivos)
-- -----------------------------------------------------------------------------
drop policy if exists "avaliacoes_planilhas_storage_select_anon_provisorio" on storage.objects;
create policy "avaliacoes_planilhas_storage_select_anon_provisorio" on storage.objects
  for select to anon
  using (bucket_id = 'avaliacoes-diretores-planilhas');

drop policy if exists "avaliacoes_planilhas_storage_insert_anon_provisorio" on storage.objects;
create policy "avaliacoes_planilhas_storage_insert_anon_provisorio" on storage.objects
  for insert to anon
  with check (bucket_id = 'avaliacoes-diretores-planilhas');

-- -----------------------------------------------------------------------------
-- 5) Comentários identificando cada política como PROVISÓRIA
-- -----------------------------------------------------------------------------
comment on policy avaliacoes_diretores_select_anon_provisorio on public.avaliacoes_diretores is
  'PROVISÓRIO (protótipo sem login): anon pode ler as avaliações. Substituir por política de usuário autenticado do sistema maior.';
comment on policy avaliacoes_diretores_insert_anon_provisorio on public.avaliacoes_diretores is
  'PROVISÓRIO (protótipo sem login): anon pode criar avaliações. Substituir por política de usuário autenticado do sistema maior.';
comment on policy avaliacoes_diretores_update_importacao_anon_provisorio on public.avaliacoes_diretores is
  'PROVISÓRIO (protótipo sem login): anon só altera avaliações em processando (path/totais/status -> publicada|erro). Publicadas ficam imutáveis. Substituir na integração.';
comment on policy avaliacoes_diretores_registros_select_anon_provisorio on public.avaliacoes_diretores_registros is
  'PROVISÓRIO (protótipo sem login): anon pode ler registros. Substituir na integração com o sistema maior.';
comment on policy avaliacoes_diretores_registros_insert_anon_provisorio on public.avaliacoes_diretores_registros is
  'PROVISÓRIO (protótipo sem login): anon pode inserir registros. Substituir na integração com o sistema maior.';
comment on policy avaliacoes_diretores_periodos_select_anon_provisorio on public.avaliacoes_diretores_periodos is
  'PROVISÓRIO (protótipo sem login): anon pode ler períodos. Substituir na integração com o sistema maior.';
comment on policy avaliacoes_diretores_periodos_insert_anon_provisorio on public.avaliacoes_diretores_periodos is
  'PROVISÓRIO (protótipo sem login): anon pode inserir períodos. Substituir na integração com o sistema maior.';
comment on policy avaliacoes_diretores_indicadores_select_anon_provisorio on public.avaliacoes_diretores_indicadores is
  'PROVISÓRIO (protótipo sem login): anon pode ler indicadores. Substituir na integração com o sistema maior.';
comment on policy avaliacoes_diretores_indicadores_insert_anon_provisorio on public.avaliacoes_diretores_indicadores is
  'PROVISÓRIO (protótipo sem login): anon pode inserir indicadores. Substituir na integração com o sistema maior.';
comment on policy avaliacoes_diretores_observacoes_select_anon_provisorio on public.avaliacoes_diretores_observacoes is
  'PROVISÓRIO (protótipo sem login): anon pode ler observações. Substituir na integração com o sistema maior.';
comment on policy avaliacoes_diretores_observacoes_insert_anon_provisorio on public.avaliacoes_diretores_observacoes is
  'PROVISÓRIO (protótipo sem login): anon pode inserir observações sem autoria. Substituir na integração com o sistema maior.';
comment on policy avaliacoes_planilhas_storage_select_anon_provisorio on storage.objects is
  'PROVISÓRIO (protótipo sem login): anon pode ler apenas objetos do bucket avaliacoes-diretores-planilhas.';
comment on policy avaliacoes_planilhas_storage_insert_anon_provisorio on storage.objects is
  'PROVISÓRIO (protótipo sem login): anon pode enviar apenas para o bucket avaliacoes-diretores-planilhas. Sem UPDATE (sem sobrescrita) e sem DELETE.';
