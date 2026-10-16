-- =============================================================================
-- Módulo: Avaliação de Diretores — CADASTRO E EDIÇÃO MANUAL DE PERÍODOS
-- (Matriz histórica → botão discreto "Atualizar dados")
-- Migration aditiva e idempotente: pode ser executada mais de uma vez sem erro.
--
-- Reutiliza a estrutura manual já existente (NADA de tabela duplicada):
--   * CADASTRO de período novo → linha em avaliacoes_diretores_periodos com
--     origem = 'cadastro_manual', vinculada por registro_id (→ avaliacao_id)
--     e mês/ano normalizados (rotulo_periodo "OUT/2026", fechamento de
--     trimestre "DEZ/4TRI 2026") + ordem cronológica;
--   * EDIÇÃO / completamento de Status e Nível de qualquer período → camada de
--     ajustes já criada em avaliacoes_diretores_ajustes (origem "ajuste
--     manual"), preservando o valor original importado da planilha;
--   * linhas importadas NUNCA têm estagio/nivel/rotulo alterados. Somente a
--     coluna ordem pode ser reposicionada (privilégio de coluna), para
--     manter a ordem cronológica quando o mês cadastrado fica no meio do
--     histórico.
--
-- ORIGENS E PRIORIDADE (vigência calculada no frontend, regra centralizada):
--   ajuste manual > cadastro manual > valor importado.
--   Uma planilha futura só insere novas linhas; não sobrescreve valores
--   manuais.
-- =============================================================================

-- 1) Coluna de origem do período (idempotente)
alter table public.avaliacoes_diretores_periodos
  add column if not exists origem text not null default 'planilha';

-- 2) CHECK idempotente: somente as origens conhecidas
do $origem_check$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conname = 'avaliacoes_diretores_periodos_origem_check'
      and c.conrelid = 'public.avaliacoes_diretores_periodos'::regclass
  ) then
    alter table public.avaliacoes_diretores_periodos
      add constraint avaliacoes_diretores_periodos_origem_check
      check (origem in ('planilha', 'cadastro_manual'));
  end if;
end;
$origem_check$;

comment on column public.avaliacoes_diretores_periodos.origem is
  'Avaliação de Diretores: origem do período — planilha (importado) ou cadastro manual (Matriz histórica → "Atualizar dados"). O valor ajustado manualmente fica em avaliacoes_diretores_ajustes (origem "ajuste manual") e tem prioridade sobre estes dois.';

-- 3) anon: UPDATE restrito à coluna ordem (reposição cronológica do cadastro
--    manual). estagio, nivel e rotulo_periodo ficam SEM privilégio de coluna:
--    o dado importado da planilha não pode ser alterado; DELETE continua
--    bloqueado (sem política).
revoke update on public.avaliacoes_diretores_periodos from anon;
grant update (ordem) on public.avaliacoes_diretores_periodos to anon;

-- 4) Política de UPDATE (não existe nenhuma para periodos; sem ela o UPDATE é
--    negado mesmo com o privilégio de coluna acima)
drop policy if exists avaliacoes_diretores_periodos_update_ordem_anon_provisorio
  on public.avaliacoes_diretores_periodos;
create policy avaliacoes_diretores_periodos_update_ordem_anon_provisorio
  on public.avaliacoes_diretores_periodos
  for update
  to anon
  using (true)
  with check (true);

comment on policy avaliacoes_diretores_periodos_update_ordem_anon_provisorio
  on public.avaliacoes_diretores_periodos is
  'PROVISÓRIO: anon atualiza APENAS a coluna ordem (privilégio de coluna) para manter a ordem cronológica dos períodos ao cadastrar um mês manualmente pela Matriz histórica. estagio/nivel/rotulo_periodo não têm privilégio de alteração e o DELETE continua bloqueado.';
