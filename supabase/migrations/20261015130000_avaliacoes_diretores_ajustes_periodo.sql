-- =============================================================================
-- Módulo: Avaliação de Diretores — AJUSTES MANUAIS DE STATUS/NÍVEL POR PERÍODO
-- Migration aditiva e idempotente: pode ser executada mais de uma vez sem erro.
--
-- Finalidade: permitir editar o Status (estágio) e o Nível do ÚLTIMO PERÍODO
-- VÁLIDO do diretor SEM alterar o dado importado da planilha. O registro
-- original permanece intacto em public.avaliacoes_diretores_periodos
-- (estagio, nivel) para consulta e auditoria; o valor VIGENTE é calculado em
-- tempo de leitura pela regra centralizada do frontend:
--   * existe ajuste manual ATIVO para o período -> usa status_ajustado/nivel_ajustado;
--   * não existe ajuste              -> usa estagio/nivel importados.
--
-- Ajuste vincula identificadores REAIS (avaliacao_id, registro_id, periodo_id)
-- — nunca somente pelo nome do diretor. No máximo UM ajuste ativo por período
-- (índice único parcial); editar de novo atualiza a MESMA linha (novos valores
-- vigentes), preservando status_original/nivel_original.
--
-- Privilegios (fase provisória sem login, igual às observações):
--   * SELECT e INSERT completos;
--   * UPDATE apenas em (status_ajustado, nivel_ajustado, atualizado_por,
--     updated_at, arquivada_em) — nada mexe nos campos originais;
--   * DELETE físico continua sem política (bloqueado); arquivamento é lógico.
-- =============================================================================

-- 1) Tabela (idempotente). Não duplica estrutura existente: as tabelas atuais
--    (avaliacoes_diretores, registros, periodos, indicadores, observacoes)
--    não têm campos de ajuste manual — esta é a estrutura separada pedida.
create table if not exists public.avaliacoes_diretores_ajustes (
  id              uuid primary key default gen_random_uuid(),
  avaliacao_id    uuid not null references public.avaliacoes_diretores(id) on delete cascade,
  registro_id     uuid not null references public.avaliacoes_diretores_registros(id) on delete cascade,
  periodo_id      uuid not null references public.avaliacoes_diretores_periodos(id) on delete cascade,
  -- Valores IMPORTADOS da planilha, capturados no momento do primeiro ajuste.
  status_original text,
  nivel_original  text,
  -- Valores AJUSTADOS manualmente (vigentes enquanto o ajuste estiver ativo).
  status_ajustado text not null,
  nivel_ajustado  text not null,
  -- Exclusão lógica (NULL = ajuste ativo).
  arquivada_em    timestamptz,
  criado_por      uuid references auth.users(id) on delete set null,
  atualizado_por  uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.avaliacoes_diretores_ajustes is
  'Avaliação de Diretores: ajustes manuais de status/nível por período (valor vigente tem prioridade sobre o dado importado; o original permanece em avaliacoes_diretores_periodos).';
comment on column public.avaliacoes_diretores_ajustes.status_original is
  'Status (estágio) importado da planilha no momento do ajuste — nunca é alterado pelo sistema de edição.';
comment on column public.avaliacoes_diretores_ajustes.nivel_original is
  'Nível importado da planilha no momento do ajuste (algarismo romano I–V) — nunca é alterado pelo sistema de edição.';
comment on column public.avaliacoes_diretores_ajustes.status_ajustado is
  'Status (estágio) ajustado manualmente — vigente enquanto arquivada_em for nulo.';
comment on column public.avaliacoes_diretores_ajustes.nivel_ajustado is
  'Nível ajustado manualmente (algarismo romano I–V) — vigente enquanto arquivada_em for nulo.';

-- 2) Um ÚNICO ajuste ativo por período (editar de novo atualiza a mesma linha)
create unique index if not exists avaliacoes_diretores_ajustes_periodo_ativo_uniq
  on public.avaliacoes_diretores_ajustes (periodo_id)
  where arquivada_em is null;

comment on index public.avaliacoes_diretores_ajustes_periodo_ativo_uniq is
  'Avaliação de Diretores: garante no máximo um ajuste manual ativo por período.';

-- 3) Índice de consulta do ajuste do diretor/avaliação
create index if not exists idx_avaliacoes_diretores_ajustes_registro
  on public.avaliacoes_diretores_ajustes (registro_id);

-- 4) CHECK idempotente: valores ajustados nunca vazios
do $ajustes_check$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conname = 'avaliacoes_diretores_ajustes_valores_check'
      and c.conrelid = 'public.avaliacoes_diretores_ajustes'::regclass
  ) then
    alter table public.avaliacoes_diretores_ajustes
      add constraint avaliacoes_diretores_ajustes_valores_check
      check (status_ajustado <> '' and nivel_ajustado <> '');
  end if;
end;
$ajustes_check$;

-- 5) RLS ligado (mesma fase provisória das demais tabelas do módulo)
alter table public.avaliacoes_diretores_ajustes enable row level security;

-- 6) Privilégios (idempotentes)
grant select, insert on public.avaliacoes_diretores_ajustes to anon;
revoke update on public.avaliacoes_diretores_ajustes from anon;
grant update (status_ajustado, nivel_ajustado, atualizado_por, updated_at, arquivada_em)
  on public.avaliacoes_diretores_ajustes to anon;

-- 7) Políticas RLS (drop + create = idempotente)
drop policy if exists avaliacoes_diretores_ajustes_select_anon_provisorio
  on public.avaliacoes_diretores_ajustes;
create policy avaliacoes_diretores_ajustes_select_anon_provisorio
  on public.avaliacoes_diretores_ajustes
  for select
  to anon
  using (true);

drop policy if exists avaliacoes_diretores_ajustes_insert_anon_provisorio
  on public.avaliacoes_diretores_ajustes;
create policy avaliacoes_diretores_ajustes_insert_anon_provisorio
  on public.avaliacoes_diretores_ajustes
  for insert
  to anon
  with check (true);

drop policy if exists avaliacoes_diretores_ajustes_update_anon_provisorio
  on public.avaliacoes_diretores_ajustes;
create policy avaliacoes_diretores_ajustes_update_anon_provisorio
  on public.avaliacoes_diretores_ajustes
  for update
  to anon
  using (true)
  with check (true);

comment on policy avaliacoes_diretores_ajustes_select_anon_provisorio
  on public.avaliacoes_diretores_ajustes is
  'PROVISÓRIO: anon pode ler os ajustes manuais de status/nível por período.';
comment on policy avaliacoes_diretores_ajustes_insert_anon_provisorio
  on public.avaliacoes_diretores_ajustes is
  'PROVISÓRIO: anon pode criar ajuste manual de status/nível (fase sem identidade de usuário).';
comment on policy avaliacoes_diretores_ajustes_update_anon_provisorio
  on public.avaliacoes_diretores_ajustes is
  'PROVISÓRIO: anon pode atualizar/arquivar logicamente o ajuste. DELETE físico bloqueado. Campos originais da planilha nunca são alterados.';
