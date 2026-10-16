-- =============================================================================
-- Módulo: Avaliação de Diretores — AJUSTES MANUAIS DE PONTUAÇÕES/INDICADORES
-- Migration aditiva e idempotente: pode ser executada mais de uma vez sem erro.
--
-- Finalidade: permitir cadastrar/editar as NOTAS (Presencial, Acadêmico,
-- Pós-graduação, Nota geral, Avaliação institucional) e PERCENTUAIS (Ritmo de
-- captação, Crescimento de matrículas, Evasão, EBITDA) do diretor SEM alterar o
-- dado importado da planilha. O valor importado permanece em
-- public.avaliacoes_diretores_indicadores (EAV) para consulta e auditoria; o
-- valor VIGENTE é calculado em tempo de leitura pela regra centralizada do
-- frontend:
--   * ajuste manual ATIVO do PRÓPRIO registro -> usa valor_manual;
--   * ajuste manual ATIVO mais recente do MESMO diretor em avaliação ANTERIOR
--     -> usa valor_manual (a planilha futura nunca sobrescreve o manual e o
--     histórico anterior nunca é reescrito);
--   * sem ajuste -> valor importado.
--
-- Linha vincula identificadores REAIS (avaliacao_id, registro_id) + `chave`
-- amigável do indicador. No máximo UM ajuste ativo por (registro, chave)
-- (índice único parcial); editar de novo atualiza a MESMA linha, preservando
-- valor_original.
--
-- Unidade: `chave` usa os nomes amigáveis do sistema; percentuais são
-- guardados como FRAÇÃO (0.1 = 10%); valor_original pode ser nulo (cadastrado
-- sem valor importado).
--
-- Privilegios (fase provisória sem login, igual aos ajustes de período):
--   * SELECT e INSERT completos;
--   * UPDATE apenas em (valor_manual, origem, atualizado_por, updated_at,
--     arquivada_em) — valor_original nunca é alterado;
--   * DELETE físico continua sem política (bloqueado); arquivamento é lógico.
-- =============================================================================

-- 1) Tabela (idempotente)
create table if not exists public.avaliacoes_diretores_indicadores_ajustes (
  id               uuid primary key default gen_random_uuid(),
  avaliacao_id     uuid not null references public.avaliacoes_diretores(id) on delete cascade,
  registro_id      uuid not null references public.avaliacoes_diretores_registros(id) on delete cascade,
  -- Chave amigável do indicador ("Nota geral", "EBITDA", "Evasão", ...)
  chave            text not null,
  -- Valor IMPORTADO da planilha no momento do primeiro ajuste (nunca alterado).
  valor_original   numeric,
  -- Valor AJUSTADO manualmente (vigente enquanto o ajuste estiver ativo).
  valor_manual     numeric not null,
  -- Origem do vigente: cadastro manual (sem valor importado) ou edição manual.
  origem           text not null default 'edicao_manual',
  -- Exclusão lógica (NULL = ajuste ativo).
  arquivada_em     timestamptz,
  criado_por       uuid references auth.users(id) on delete set null,
  atualizado_por   uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.avaliacoes_diretores_indicadores_ajustes is
  'Avaliação de Diretores: ajustes manuais de pontuações/indicadores por registro (valor vigente tem prioridade sobre o dado importado; o original permanece em avaliacoes_diretores_indicadores).';
comment on column public.avaliacoes_diretores_indicadores_ajustes.chave is
  'Chave amigável do indicador, igual aos nomes usados pelo dashboard (ex.: "Nota geral", "EBITDA").';
comment on column public.avaliacoes_diretores_indicadores_ajustes.valor_original is
  'Valor importado da planilha no momento do primeiro ajuste — nunca é alterado pelo sistema de edição; nulo quando o registro não tinha valor importado.';
comment on column public.avaliacoes_diretores_indicadores_ajustes.valor_manual is
  'Valor ajustado manualmente — vigente enquanto arquivada_em for nulo. Percentuais em fração (0.1 = 10%).';
comment on column public.avaliacoes_diretores_indicadores_ajustes.origem is
  'Origem do vigente: cadastro_manual (não existia valor importado) ou edicao_manual (substituiu o importado).';

-- 2) Um ÚNICO ajuste ativo por (registro, chave)
create unique index if not exists avaliacoes_diretores_indicadores_ajustes_ativo_uniq
  on public.avaliacoes_diretores_indicadores_ajustes (registro_id, chave)
  where arquivada_em is null;

comment on index public.avaliacoes_diretores_indicadores_ajustes_ativo_uniq is
  'Avaliação de Diretores: garante no máximo um ajuste manual ativo por registro e indicador.';

-- 3) Índice de consulta por registro
create index if not exists idx_avaliacoes_diretores_indicadores_ajustes_registro
  on public.avaliacoes_diretores_indicadores_ajustes (registro_id);

-- 4) CHECKs idempotentes
do $indic_ajustes_check$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conname = 'avaliacoes_diretores_indicadores_ajustes_chave_check'
      and c.conrelid = 'public.avaliacoes_diretores_indicadores_ajustes'::regclass
  ) then
    alter table public.avaliacoes_diretores_indicadores_ajustes
      add constraint avaliacoes_diretores_indicadores_ajustes_chave_check
      check (chave <> '');
  end if;
  if not exists (
    select 1
    from pg_constraint c
    where c.conname = 'avaliacoes_diretores_indicadores_ajustes_origem_check'
      and c.conrelid = 'public.avaliacoes_diretores_indicadores_ajustes'::regclass
  ) then
    alter table public.avaliacoes_diretores_indicadores_ajustes
      add constraint avaliacoes_diretores_indicadores_ajustes_origem_check
      check (origem in ('cadastro_manual', 'edicao_manual'));
  end if;
end;
$indic_ajustes_check$;

-- 5) RLS ligado (mesma fase provisória das demais tabelas do módulo)
alter table public.avaliacoes_diretores_indicadores_ajustes enable row level security;

-- 6) Privilégios (idempotentes)
grant select, insert on public.avaliacoes_diretores_indicadores_ajustes to anon;
revoke update on public.avaliacoes_diretores_indicadores_ajustes from anon;
grant update (valor_manual, origem, atualizado_por, updated_at, arquivada_em)
  on public.avaliacoes_diretores_indicadores_ajustes to anon;

-- 7) Políticas RLS (drop + create = idempotente)
drop policy if exists avaliacoes_diretores_indicadores_ajustes_select_anon_provisorio
  on public.avaliacoes_diretores_indicadores_ajustes;
create policy avaliacoes_diretores_indicadores_ajustes_select_anon_provisorio
  on public.avaliacoes_diretores_indicadores_ajustes
  for select
  to anon
  using (true);

drop policy if exists avaliacoes_diretores_indicadores_ajustes_insert_anon_provisorio
  on public.avaliacoes_diretores_indicadores_ajustes;
create policy avaliacoes_diretores_indicadores_ajustes_insert_anon_provisorio
  on public.avaliacoes_diretores_indicadores_ajustes
  for insert
  to anon
  with check (true);

drop policy if exists avaliacoes_diretores_indicadores_ajustes_update_anon_provisorio
  on public.avaliacoes_diretores_indicadores_ajustes;
create policy avaliacoes_diretores_indicadores_ajustes_update_anon_provisorio
  on public.avaliacoes_diretores_indicadores_ajustes
  for update
  to anon
  using (true)
  with check (true);

comment on policy avaliacoes_diretores_indicadores_ajustes_select_anon_provisorio
  on public.avaliacoes_diretores_indicadores_ajustes is
  'PROVISÓRIO: anon pode ler os ajustes manuais de pontuações/indicadores.';
comment on policy avaliacoes_diretores_indicadores_ajustes_insert_anon_provisorio
  on public.avaliacoes_diretores_indicadores_ajustes is
  'PROVISÓRIO: anon pode criar ajuste manual de pontuação/indicador (fase sem identidade de usuário).';
comment on policy avaliacoes_diretores_indicadores_ajustes_update_anon_provisorio
  on public.avaliacoes_diretores_indicadores_ajustes is
  'PROVISÓRIO: anon pode atualizar/arquivar logicamente o ajuste de pontuação/indicador. DELETE físico bloqueado. valor_original nunca é alterado.';
