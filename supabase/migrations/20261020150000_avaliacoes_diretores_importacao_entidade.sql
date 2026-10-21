-- =============================================================================
-- Módulo: Avaliação de Diretores — REGRA DEFINITIVA DE IMPORTAÇÃO DA PLANILHA1
-- (identidade Diretor+Unidade, arquivamento/reativação, completação de campo
--  vazio e atualização de indicadores — prioridade manual preservada)
-- Migration aditiva e idempotente: pode ser executada mais de uma vez sem erro.
--
-- REGRA DE IDENTIDADE: o vínculo de um registro é (Diretor + Unidade)
-- normalizados (espaços/quebras de linha normalizados, caixa ignorada). O
-- registro é uma ENTIDADE REUTILIZÁVEL entre importações (não um snapshot por
-- importação):
--   * planilha traz a mesma dupla Diretor+Unidade -> REUTILIZA o registro
--     (avaliacao_id permanece o da criação — atribuição imutável);
--   * dupla ausente da planilha -> registro é ARQUIVADO (arquivado_em);
--   * dupla arquivada que volta -> registro é REATIVADO (arquivado_em = null);
--   * dupla inexistente -> registro NOVO (avaliacao_id da importação atual).
--
-- O QUE A PLANILHA PODE ESCREVER (e só isto):
--   * período NOVO para o registro (inserção, com ordem cronológica);
--   * campo VAZIO de período existente (estágio/nível sem valor) -> completar;
--   * indicadores/notas do registro existente -> atualizar, EXCETO quando
--     existe ajuste manual ativo (a prioridade manual continua vencendo);
--   * situação atual do registro (regional, código, status de gestão, ciclo de
--     vida, nível atual) -> atualizado para o valor presente da planilha;
--   * NUNCA altera valores de período já preenchidos, ajustes manuais,
--     rotulo_periodo, diretor, unidade, avaliacao_id ou created_at.
--
-- Esta migration cria as colunas/privilégios/políticas que sustentam essa
-- regra e TRIGGERS que a garantem também no banco (defesa em profundidade).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Coluna de arquivamento LÓGICO do registro (nunca DELETE)
-- -----------------------------------------------------------------------------
alter table public.avaliacoes_diretores_registros
  add column if not exists arquivado_em timestamptz;

comment on column public.avaliacoes_diretores_registros.arquivado_em is
  'Avaliação de Diretores: quando preenchido, o registro (Diretor+Unidade) não aparece nos dashboards — foi substituído/ausente na última planilha. Voltou à planilha? O valor volta a null (reativação). Nenhum dado é apagado.';

-- -----------------------------------------------------------------------------
-- 2) Privilégios de UPDATE por COLUNA para `anon` (somente o necessário)
--    Sem privilégio de coluna, a alteração é negada mesmo com política RLS.
-- -----------------------------------------------------------------------------
revoke update on public.avaliacoes_diretores_registros from anon;
grant update (codigo_regional, regional, status_gestao, ciclo_vida, nivel_atual, arquivado_em)
  on public.avaliacoes_diretores_registros to anon;

-- periodos: além de `ordem` (reposição cronológica, migration 20261016100000),
-- passa a permitir completar estagio/nivel SOMENTE quando estão vazios — a
-- restrição de "só vazio" é imposta pela trigger da seção 4.
revoke update on public.avaliacoes_diretores_periodos from anon;
grant update (ordem, estagio, nivel)
  on public.avaliacoes_diretores_periodos to anon;

-- indicadores: atualizar os valores importados do registro reutilizado.
revoke update on public.avaliacoes_diretores_indicadores from anon;
grant update (valor_numerico, valor_texto)
  on public.avaliacoes_diretores_indicadores to anon;

-- -----------------------------------------------------------------------------
-- 3) Políticas RLS de UPDATE para `anon` (colunas já limitadas acima)
-- -----------------------------------------------------------------------------
drop policy if exists avaliacoes_diretores_registros_update_anon_provisorio
  on public.avaliacoes_diretores_registros;
create policy avaliacoes_diretores_registros_update_anon_provisorio
  on public.avaliacoes_diretores_registros
  for update to anon
  using (true)
  with check (true);

drop policy if exists avaliacoes_diretores_indicadores_update_anon_provisorio
  on public.avaliacoes_diretores_indicadores;
create policy avaliacoes_diretores_indicadores_update_anon_provisorio
  on public.avaliacoes_diretores_indicadores
  for update to anon
  using (true)
  with check (true);

-- periodos: política de UPDATE inexistente até aqui (só SELECT/INSERT) — sem
-- ela a completação de campo vazio e a reposição cronológica seriam negadas.
-- As colunas ficam limitadas pelo grant da seção 2 e o conteúdo pela trigger 4a.
drop policy if exists avaliacoes_diretores_periodos_update_anon_provisorio
  on public.avaliacoes_diretores_periodos;
create policy avaliacoes_diretores_periodos_update_anon_provisorio
  on public.avaliacoes_diretores_periodos
  for update to anon
  using (true)
  with check (true);
comment on policy avaliacoes_diretores_periodos_update_anon_provisorio
  on public.avaliacoes_diretores_periodos is
  'PROVISÓRIO: anon atualiza APENAS (ordem, estagio, nivel) dos períodos — reposição cronológica e completação de campo vazio. rotulo_periodo/registro_id imutáveis e sobreescrita bloqueadas pela trigger da seção 4.';

comment on policy avaliacoes_diretores_registros_update_anon_provisorio
  on public.avaliacoes_diretores_registros is
  'PROVISÓRIO: anon atualiza APENAS as colunas concedidas (situação atual + arquivado_em) para reutilizar/arquivar/reativar o registro Diretor+Unidade. id, avaliacao_id, diretor, unidade e created_at são bloqueados por trigger. DELETE continua bloqueado.';
comment on policy avaliacoes_diretores_indicadores_update_anon_provisorio
  on public.avaliacoes_diretores_indicadores is
  'PROVISÓRIO: anon atualiza APENAS valor_numerico/valor_texto dos indicadores do registro reutilizado (planilha vigente), nunca nome_indicador/registro_id. Ajustes manuais (tabela separada) continuam com prioridade na leitura. DELETE continua bloqueado.';

-- -----------------------------------------------------------------------------
-- 4) TRIGGERS de invariantes (defesa em profundidade)
--    4a. Valor de período só pode ser preenchido quando estava VAZIO.
--    4b. Identidade e atribuição do registro são imutáveis.
-- -----------------------------------------------------------------------------

-- Texto vazio/marcador de "sem informação" (mesma semântica do frontend).
create or replace function public.avaliacoes_diretores_valor_vazio(text)
returns boolean
language sql
immutable
as $$
  select $1 is null
    or regexp_replace(lower(trim($1)), '\s+', ' ', 'g') in (
      '', 'não informado', 'nao informado', 'não informada', 'nao informada',
      '-', '—', '–', 'n/d', 'nd', 's/n', 'n/a', 'n.d.'
    );
$$;

comment on function public.avaliacoes_diretores_valor_vazio(text) is
  'Avaliação de Diretores: true quando o texto de um campo é vazio ou marcador de ausência (Não informado, -, n/d...). Usado pelas triggers de importação para permitir apenas COMPLETAR campo vazio.';

create or replace function public.avaliacoes_diretores_periodos_bloqueia_sobreescrita()
returns trigger
language plpgsql
as $$
begin
  if new.rotulo_periodo is distinct from old.rotulo_periodo then
    raise exception 'Período imutável: rotulo_periodo não pode ser alterado (identidade do período na planilha).';
  end if;
  if new.registro_id is distinct from old.registro_id then
    raise exception 'Período imutável: registro_id não pode ser alterado (vínculo ao registro Diretor+Unidade).';
  end if;
  if new.estagio is distinct from old.estagio
     and not public.avaliacoes_diretores_valor_vazio(old.estagio) then
    raise exception 'Sobreescrita bloqueada: o estágio "%" já está preenchido — a planilha só completa campos vazios (o ajuste manual fica em avaliacoes_diretores_ajustes).', coalesce(old.estagio, '');
  end if;
  if new.nivel is distinct from old.nivel
     and not public.avaliacoes_diretores_valor_vazio(old.nivel) then
    raise exception 'Sobreescrita bloqueada: o nível "%" já está preenchido — a planilha só completa campos vazios (o ajuste manual fica em avaliacoes_diretores_ajustes).', coalesce(old.nivel, '');
  end if;
  return new;
end;
$$;

comment on function public.avaliacoes_diretores_periodos_bloqueia_sobreescrita() is
  'Avaliação de Diretores: garante no banco a regra de importação — estagio/nivel só mudam quando estavam vazios; rotulo_periodo e registro_id nunca mudam. ordem pode mudar (ordem cronológica).';

drop trigger if exists trg_avaliacoes_diretores_periodos_bloqueia_sobreescrita
  on public.avaliacoes_diretores_periodos;
create trigger trg_avaliacoes_diretores_periodos_bloqueia_sobreescrita
  before update on public.avaliacoes_diretores_periodos
  for each row execute function public.avaliacoes_diretores_periodos_bloqueia_sobreescrita();

create or replace function public.avaliacoes_diretores_registros_bloqueia_identidade()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.avaliacao_id is distinct from old.avaliacao_id
     or new.diretor is distinct from old.diretor
     or new.unidade is distinct from old.unidade
     or new.created_at is distinct from old.created_at then
    raise exception 'Registro imutável: id, avaliacao_id, diretor, unidade e created_at não mudam (identidade Diretor+Unidade e atribuição da importação de criação).';
  end if;
  return new;
end;
$$;

comment on function public.avaliacoes_diretores_registros_bloqueia_identidade() is
  'Avaliação de Diretores: garante no banco que o registro é uma entidade — a identidade (diretor+unidade) e o avaliacao_id de criação são imutáveis; só situação atual e arquivado_em podem mudar.';

drop trigger if exists trg_avaliacoes_diretores_registros_bloqueia_identidade
  on public.avaliacoes_diretores_registros;
create trigger trg_avaliacoes_diretores_registros_bloqueia_identidade
  before update on public.avaliacoes_diretores_registros
  for each row execute function public.avaliacoes_diretores_registros_bloqueia_identidade();
