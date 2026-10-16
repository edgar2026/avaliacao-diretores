-- =============================================================================
-- Modulo: Avaliacao de Diretores — TIPO DE PARECER (regional | operacoes)
-- Migration aditiva e idempotente: pode ser executada mais de uma vez sem erro.
-- NAO cria tabela duplicada: reutiliza public.avaliacoes_diretores_observacoes,
-- que ja possui id, avaliacao_id, registro_id, regional, diretor, texto
-- (coluna `observacao`), created_at, updated_at e arquivada_em.
--
-- A coluna `tipo` diferencia os dois pareceres exibidos no topo da tela:
--   'regional'  -> Parecer do Regional
--   'operacoes' -> Parecer de Operacoes
--   NULL        -> observacao comum do regional (linhas existentes intactas)
--
-- Privilegios: nada a conceder. `anon` ja tem SELECT/INSERT em todas as
-- colunas desta tabela e UPDATE apenas em (observacao, arquivada_em,
-- updated_at) — o que e exatamente o necessario para criar, editar e
-- excluir (logicamente) um parecer. DELETE fisico continua sem politica.
-- =============================================================================

-- 1) Coluna aditiva (idempotente)
alter table public.avaliacoes_diretores_observacoes
  add column if not exists tipo text;

comment on column public.avaliacoes_diretores_observacoes.tipo is
  'Avaliacao de Diretores: tipo do parecer (regional|operacoes). NULL = observacao comum do regional.';

-- 2) CHECK idempotente (criada apenas se ainda nao existir)
do $tipo_check$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conname = 'avaliacoes_diretores_observacoes_tipo_check'
      and c.conrelid = 'public.avaliacoes_diretores_observacoes'::regclass
  ) then
    alter table public.avaliacoes_diretores_observacoes
      add constraint avaliacoes_diretores_observacoes_tipo_check
      check (tipo is null or tipo in ('regional', 'operacoes'));
  end if;
end;
$tipo_check$;

-- 3) Indice da consulta de pareceres (tipo do parecer)
create index if not exists idx_avaliacoes_diretores_observacoes_tipo
  on public.avaliacoes_diretores_observacoes (tipo);

comment on index public.idx_avaliacoes_diretores_observacoes_tipo is
  'Avaliacao de Diretores: localiza rapido o parecer (regional|operacoes) de um diretor.';
