-- =============================================================================
-- Módulo: Avaliação de Diretores
-- Migration idempotente: pode ser executada mais de uma vez sem erro.
-- Cria: bucket privado no Storage + tabelas + índices + constraints + triggers
--       + RLS. Não insere dados fictícios.
-- Regras: sem login próprio (futuro sistema maior já autentica);
--         nenhum service_role no frontend; anon sem acesso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) STORAGE: bucket privado para planilhas (XLSX/XLS, limite 15 MB)
--    Convenção de caminho futuro dos arquivos:
--      avaliacoes/{ano}/{trimestre}/{avaliacao_id}/{timestamp}-{nome-seguro}.xlsx
--    Upload/exclusão/movimentação sempre pela API do Storage (nunca por DML
--    direta em storage.objects).
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avaliacoes-diretores-planilhas',
  'avaliacoes-diretores-planilhas',
  false,
  15728640, -- 15 MB
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS do Storage: somente SELECT e INSERT para autenticados neste bucket.
-- Sem política de UPDATE => impede sobrescrita/upsert.
-- Sem política de DELETE => impede remoção pelo usuário comum.
-- Sem política para anon => bucket não é acessível publicamente.
-- Futura restrição por perfil administrativo: trocar `to authenticated`
-- por `to authenticated` + checagem de papel do sistema principal.
drop policy if exists "avaliacoes_planilhas_storage_select" on storage.objects;
create policy "avaliacoes_planilhas_storage_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'avaliacoes-diretores-planilhas');

drop policy if exists "avaliacoes_planilhas_storage_insert" on storage.objects;
create policy "avaliacoes_planilhas_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avaliacoes-diretores-planilhas');

comment on policy avaliacoes_planilhas_storage_select on storage.objects is
  'Avaliação de Diretores: autenticados podem listar/ler objetos apenas do bucket privado de planilhas.';
comment on policy avaliacoes_planilhas_storage_insert on storage.objects is
  'Avaliação de Diretores: autenticados podem enviar apenas para o bucket privado de planilhas. Sem UPDATE/DELETE (sem sobrescrita nem exclusão pelo frontend).';

-- -----------------------------------------------------------------------------
-- 2) FUNÇÃO de trigger genérica do módulo (updated_at)
-- -----------------------------------------------------------------------------
create or replace function public.fn_avaliacoes_diretores_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- Imobiliza o search_path (evita o alerta de segurança do linter).
alter function public.fn_avaliacoes_diretores_updated_at() set search_path = '';

-- -----------------------------------------------------------------------------
-- 3) TABELA: avaliacoes_diretores (1 linha = 1 upload, nunca substituída)
-- -----------------------------------------------------------------------------
create table if not exists public.avaliacoes_diretores (
  id                      uuid primary key default gen_random_uuid(),
  titulo                  text not null,
  trimestre               smallint not null,
  ano                     smallint not null,
  status                  text not null default 'processando',
  arquivo_nome_original   text,
  storage_bucket          text not null default 'avaliacoes-diretores-planilhas',
  storage_path            text,
  arquivo_hash            text,
  total_registros         integer,
  total_colunas           integer,
  importado_por           uuid default auth.uid(),
  importado_em            timestamptz not null default now(),
  publicado_em            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.avaliacoes_diretores is
  'Avaliação de Diretores: uma linha por upload de planilha (histórico imutável de importações).';

-- -----------------------------------------------------------------------------
-- 4) TABELA: avaliacoes_diretores_registros (fotografia histórica por linha)
-- -----------------------------------------------------------------------------
create table if not exists public.avaliacoes_diretores_registros (
  id                  uuid primary key default gen_random_uuid(),
  avaliacao_id        uuid not null,
  codigo_regional     text,
  regional            text,
  diretor             text not null,
  unidade             text,
  status_gestao       text,
  ciclo_vida          text,
  nivel_atual         text,
  numero_linha_origem integer,
  dados_originais     jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

comment on table public.avaliacoes_diretores_registros is
  'Avaliação de Diretores: linhas importadas. regional/diretor/unidade são fotografia da importação e não mudam com o tempo.';

-- -----------------------------------------------------------------------------
-- 5) TABELA: avaliacoes_diretores_periodos (períodos horizontais da Planilha1)
-- -----------------------------------------------------------------------------
create table if not exists public.avaliacoes_diretores_periodos (
  id             uuid primary key default gen_random_uuid(),
  registro_id    uuid not null,
  rotulo_periodo text not null,
  ordem          integer,
  estagio        text,
  nivel          text,
  created_at     timestamptz not null default now()
);

comment on table public.avaliacoes_diretores_periodos is
  'Avaliação de Diretores: períodos/estágios por registro. Quantidade variável (a Planilha1 cresce horizontalmente).';

-- -----------------------------------------------------------------------------
-- 6) TABELA: avaliacoes_diretores_indicadores (indicadores não fixos)
-- -----------------------------------------------------------------------------
create table if not exists public.avaliacoes_diretores_indicadores (
  id               uuid primary key default gen_random_uuid(),
  registro_id      uuid not null,
  nome_indicador   text not null,
  valor_numerico   numeric,
  valor_texto      text,
  unidade_medida   text,
  ordem            integer,
  created_at       timestamptz not null default now()
);

comment on table public.avaliacoes_diretores_indicadores is
  'Avaliação de Diretores: indicadores em linhas (EAV), permitindo novos indicadores sem alterar o schema.';

-- -----------------------------------------------------------------------------
-- 7) TABELA: avaliacoes_diretores_observacoes (autoria + histórico)
-- -----------------------------------------------------------------------------
create table if not exists public.avaliacoes_diretores_observacoes (
  id             uuid primary key default gen_random_uuid(),
  avaliacao_id   uuid not null,
  registro_id    uuid,
  escopo         text not null,
  regional       text,
  diretor        text,
  observacao     text not null,
  criado_por     uuid default auth.uid(),
  atualizado_por uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  arquivada_em   timestamptz
);

comment on table public.avaliacoes_diretores_observacoes is
  'Avaliação de Diretores: observações com autoria e histórico. Nunca são excluídas pelo frontend (apenas arquivadas).';

-- -----------------------------------------------------------------------------
-- 8) CONSTRAINTS idempotentes (CHECK + FK)
-- -----------------------------------------------------------------------------
do $constraints$
declare
  item record;
begin
  for item in
    select * from (values
      ('avaliacoes_diretores',
       'avaliacoes_diretores_trimestre_check',
       'alter table public.avaliacoes_diretores add constraint avaliacoes_diretores_trimestre_check check (trimestre between 1 and 4)'),
      ('avaliacoes_diretores',
       'avaliacoes_diretores_status_check',
       'alter table public.avaliacoes_diretores add constraint avaliacoes_diretores_status_check check (status in (''processando'', ''publicada'', ''arquivada'', ''erro''))'),
      ('avaliacoes_diretores',
       'avaliacoes_diretores_importado_por_fkey',
       'alter table public.avaliacoes_diretores add constraint avaliacoes_diretores_importado_por_fkey foreign key (importado_por) references auth.users(id) on delete set null'),
      ('avaliacoes_diretores_registros',
       'avaliacoes_diretores_registros_avaliacao_id_fkey',
       'alter table public.avaliacoes_diretores_registros add constraint avaliacoes_diretores_registros_avaliacao_id_fkey foreign key (avaliacao_id) references public.avaliacoes_diretores(id) on delete restrict'),
      ('avaliacoes_diretores_periodos',
       'avaliacoes_diretores_periodos_registro_id_fkey',
       'alter table public.avaliacoes_diretores_periodos add constraint avaliacoes_diretores_periodos_registro_id_fkey foreign key (registro_id) references public.avaliacoes_diretores_registros(id) on delete restrict'),
      ('avaliacoes_diretores_indicadores',
       'avaliacoes_diretores_indicadores_registro_id_fkey',
       'alter table public.avaliacoes_diretores_indicadores add constraint avaliacoes_diretores_indicadores_registro_id_fkey foreign key (registro_id) references public.avaliacoes_diretores_registros(id) on delete restrict'),
      ('avaliacoes_diretores_observacoes',
       'avaliacoes_diretores_observacoes_escopo_check',
       'alter table public.avaliacoes_diretores_observacoes add constraint avaliacoes_diretores_observacoes_escopo_check check (escopo in (''geral'', ''regional'', ''diretor''))'),
      ('avaliacoes_diretores_observacoes',
       'avaliacoes_diretores_observacoes_avaliacao_id_fkey',
       'alter table public.avaliacoes_diretores_observacoes add constraint avaliacoes_diretores_observacoes_avaliacao_id_fkey foreign key (avaliacao_id) references public.avaliacoes_diretores(id) on delete restrict'),
      ('avaliacoes_diretores_observacoes',
       'avaliacoes_diretores_observacoes_registro_id_fkey',
       'alter table public.avaliacoes_diretores_observacoes add constraint avaliacoes_diretores_observacoes_registro_id_fkey foreign key (registro_id) references public.avaliacoes_diretores_registros(id) on delete restrict'),
      ('avaliacoes_diretores_observacoes',
       'avaliacoes_diretores_observacoes_criado_por_fkey',
       'alter table public.avaliacoes_diretores_observacoes add constraint avaliacoes_diretores_observacoes_criado_por_fkey foreign key (criado_por) references auth.users(id) on delete set null'),
      ('avaliacoes_diretores_observacoes',
       'avaliacoes_diretores_observacoes_atualizado_por_fkey',
       'alter table public.avaliacoes_diretores_observacoes add constraint avaliacoes_diretores_observacoes_atualizado_por_fkey foreign key (atualizado_por) references auth.users(id) on delete set null')
    ) as def(tabela, nome, ddl)
  loop
    if not exists (
      select 1
      from pg_constraint c
      where c.conname = item.nome
        and c.conrelid = format('%I.%I', 'public', item.tabela)::regclass
    ) then
      execute item.ddl;
    end if;
  end loop;
end;
$constraints$;

-- -----------------------------------------------------------------------------
-- 9) ÍNDICES
-- -----------------------------------------------------------------------------
create index if not exists idx_avaliacoes_diretores_ano_trimestre
  on public.avaliacoes_diretores (ano, trimestre);
create index if not exists idx_avaliacoes_diretores_status
  on public.avaliacoes_diretores (status);
create index if not exists idx_avaliacoes_diretores_importado_por
  on public.avaliacoes_diretores (importado_por);

-- Impede reimportar o MESMO arquivo (hash) para o mesmo ano/trimestre,
-- sem bloquear novas avaliações. Hash nulo não participa da unicidade.
create unique index if not exists uq_avaliacoes_diretores_hash_periodo
  on public.avaliacoes_diretores (ano, trimestre, arquivo_hash)
  where arquivo_hash is not null;

-- Cada avaliação aponta para um caminho único no Storage (nunca sobrescrito).
create unique index if not exists uq_avaliacoes_diretores_storage_path
  on public.avaliacoes_diretores (storage_path)
  where storage_path is not null;

create index if not exists idx_avaliacoes_diretores_registros_avaliacao_id
  on public.avaliacoes_diretores_registros (avaliacao_id);
create index if not exists idx_avaliacoes_diretores_registros_regional
  on public.avaliacoes_diretores_registros (regional);
create index if not exists idx_avaliacoes_diretores_registros_diretor
  on public.avaliacoes_diretores_registros (diretor);
create index if not exists idx_avaliacoes_diretores_registros_avaliacao_diretor
  on public.avaliacoes_diretores_registros (avaliacao_id, diretor);

create index if not exists idx_avaliacoes_diretores_periodos_registro_id
  on public.avaliacoes_diretores_periodos (registro_id);
create index if not exists idx_avaliacoes_diretores_periodos_registro_ordem
  on public.avaliacoes_diretores_periodos (registro_id, ordem);

create index if not exists idx_avaliacoes_diretores_indicadores_registro_id
  on public.avaliacoes_diretores_indicadores (registro_id);
create index if not exists idx_avaliacoes_diretores_indicadores_nome
  on public.avaliacoes_diretores_indicadores (nome_indicador);
create index if not exists idx_avaliacoes_diretores_indicadores_registro_ordem
  on public.avaliacoes_diretores_indicadores (registro_id, ordem);

create index if not exists idx_avaliacoes_diretores_observacoes_avaliacao_id
  on public.avaliacoes_diretores_observacoes (avaliacao_id);
create index if not exists idx_avaliacoes_diretores_observacoes_registro_id
  on public.avaliacoes_diretores_observacoes (registro_id);
create index if not exists idx_avaliacoes_diretores_observacoes_regional
  on public.avaliacoes_diretores_observacoes (regional);
create index if not exists idx_avaliacoes_diretores_observacoes_diretor
  on public.avaliacoes_diretores_observacoes (diretor);
create index if not exists idx_avaliacoes_diretores_observacoes_criado_por
  on public.avaliacoes_diretores_observacoes (criado_por);
create index if not exists idx_avaliacoes_diretores_observacoes_atualizado_por
  on public.avaliacoes_diretores_observacoes (atualizado_por);
create index if not exists idx_avaliacoes_diretores_observacoes_escopo
  on public.avaliacoes_diretores_observacoes (escopo);

-- -----------------------------------------------------------------------------
-- 10) TRIGGERS de updated_at
-- -----------------------------------------------------------------------------
drop trigger if exists trg_avaliacoes_diretores_updated_at
  on public.avaliacoes_diretores;
create trigger trg_avaliacoes_diretores_updated_at
  before update on public.avaliacoes_diretores
  for each row execute function public.fn_avaliacoes_diretores_updated_at();

drop trigger if exists trg_avaliacoes_diretores_observacoes_updated_at
  on public.avaliacoes_diretores_observacoes;
create trigger trg_avaliacoes_diretores_observacoes_updated_at
  before update on public.avaliacoes_diretores_observacoes
  for each row execute function public.fn_avaliacoes_diretores_updated_at();

-- -----------------------------------------------------------------------------
-- 11) RLS habilitado em todas as tabelas do módulo
-- -----------------------------------------------------------------------------
alter table public.avaliacoes_diretores enable row level security;
alter table public.avaliacoes_diretores_registros enable row level security;
alter table public.avaliacoes_diretores_periodos enable row level security;
alter table public.avaliacoes_diretores_indicadores enable row level security;
alter table public.avaliacoes_diretores_observacoes enable row level security;

-- -----------------------------------------------------------------------------
-- 12) POLÍTICAS RLS
-- Políticas iniciais (preparadas para futura troca por papéis do sistema
-- principal): authenticated consulta e insere; somente observações são
-- atualizáveis (pelo autor); nenhuma exclusão pelo frontend; anon sem acesso.
-- -----------------------------------------------------------------------------

-- avaliacoes_diretores
drop policy if exists "avaliacoes_diretores_select_authenticated" on public.avaliacoes_diretores;
create policy "avaliacoes_diretores_select_authenticated" on public.avaliacoes_diretores
  for select to authenticated using (true);

drop policy if exists "avaliacoes_diretores_insert_authenticated" on public.avaliacoes_diretores;
create policy "avaliacoes_diretores_insert_authenticated" on public.avaliacoes_diretores
  for insert to authenticated with check (true);

-- avaliacoes_diretores_registros
drop policy if exists "avaliacoes_diretores_registros_select_authenticated" on public.avaliacoes_diretores_registros;
create policy "avaliacoes_diretores_registros_select_authenticated" on public.avaliacoes_diretores_registros
  for select to authenticated using (true);

drop policy if exists "avaliacoes_diretores_registros_insert_authenticated" on public.avaliacoes_diretores_registros;
create policy "avaliacoes_diretores_registros_insert_authenticated" on public.avaliacoes_diretores_registros
  for insert to authenticated with check (true);

-- avaliacoes_diretores_periodos
drop policy if exists "avaliacoes_diretores_periodos_select_authenticated" on public.avaliacoes_diretores_periodos;
create policy "avaliacoes_diretores_periodos_select_authenticated" on public.avaliacoes_diretores_periodos
  for select to authenticated using (true);

drop policy if exists "avaliacoes_diretores_periodos_insert_authenticated" on public.avaliacoes_diretores_periodos;
create policy "avaliacoes_diretores_periodos_insert_authenticated" on public.avaliacoes_diretores_periodos
  for insert to authenticated with check (true);

-- avaliacoes_diretores_indicadores
drop policy if exists "avaliacoes_diretores_indicadores_select_authenticated" on public.avaliacoes_diretores_indicadores;
create policy "avaliacoes_diretores_indicadores_select_authenticated" on public.avaliacoes_diretores_indicadores
  for select to authenticated using (true);

drop policy if exists "avaliacoes_diretores_indicadores_insert_authenticated" on public.avaliacoes_diretores_indicadores;
create policy "avaliacoes_diretores_indicadores_insert_authenticated" on public.avaliacoes_diretores_indicadores
  for insert to authenticated with check (true);

-- avaliacoes_diretores_observacoes (select/insert + update apenas pelo autor)
drop policy if exists "avaliacoes_diretores_observacoes_select_authenticated" on public.avaliacoes_diretores_observacoes;
create policy "avaliacoes_diretores_observacoes_select_authenticated" on public.avaliacoes_diretores_observacoes
  for select to authenticated using (true);

drop policy if exists "avaliacoes_diretores_observacoes_insert_authenticated" on public.avaliacoes_diretores_observacoes;
create policy "avaliacoes_diretores_observacoes_insert_authenticated" on public.avaliacoes_diretores_observacoes
  for insert to authenticated
  with check (criado_por is null or criado_por = (select auth.uid()));

drop policy if exists "avaliacoes_diretores_observacoes_update_autor" on public.avaliacoes_diretores_observacoes;
create policy "avaliacoes_diretores_observacoes_update_autor" on public.avaliacoes_diretores_observacoes
  for update to authenticated
  using (criado_por = (select auth.uid()))
  with check (criado_por = (select auth.uid()));

comment on policy avaliacoes_diretores_observacoes_update_autor on public.avaliacoes_diretores_observacoes is
  'Avaliação de Diretores: somente o autor da observação pode atualizá-la. Sem exclusão pelo frontend.';

-- Nenhuma política DELETE em nenhuma tabela do módulo (default deny).
-- Nenhuma política para anon (default deny).

-- -----------------------------------------------------------------------------
-- 13) anon sem acesso (defesa em profundidade além do RLS)
-- -----------------------------------------------------------------------------
revoke all on public.avaliacoes_diretores from anon;
revoke all on public.avaliacoes_diretores_registros from anon;
revoke all on public.avaliacoes_diretores_periodos from anon;
revoke all on public.avaliacoes_diretores_indicadores from anon;
revoke all on public.avaliacoes_diretores_observacoes from anon;
