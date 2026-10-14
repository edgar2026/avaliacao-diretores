# Diagnóstico Supabase — Módulo Avaliação de Diretores

Data: 2026-10-13
Projeto Supabase: `tmawxagholhwxfekqvkm` (`https://tmawxagholhwxfekqvkm.supabase.co`)
Escopo desta etapa: **somente** infraestrutura de dados (Storage + tabelas + RLS).
Nenhuma tela, gráfico, filtro ou layout foi alterado. Nenhum dado foi inserido.
A planilha **não** foi importada. Integração de upload React **não** iniciada (aguarda aprovação).

> **Atualização (fase 2):** a integração do upload foi implementada e executada; ver a Seção 7 ao final. As frases "sem acesso anon", "nenhum dado" etc. descrevem o estado da fase 1.

---

## 1. O que foi inspecionado antes de agir

### 1.1 Projeto React + Vite (local)

| Item | Situação encontrada |
| --- | --- |
| Stack | React + Vite + `xlsx` (`package.json`, scripts `dev/build/preview`) |
| Arquivos | `src/App.jsx`, `src/main.jsx`, `src/dataParser.js`, `src/components/Charts.jsx`, `src/data/initialRows.json`, `src/styles.css` |
| Cliente Supabase | **Inexistente** — nenhuma ocorrência de `supabase`/`createClient` em `src/` |
| Variáveis de ambiente | **Inexistentes** — não há `.env`, `.env.example` nem variáveis `VITE_SUPABASE_*` |
| `@supabase/supabase-js` | **Não instalado** (não está em `dependencies`) |
| Pasta `supabase/` | **Inexistente** antes desta etapa (nenhuma migration local) |
| Pasta `docs/` | **Inexistente** antes desta etapa |
| `.gitignore` | Já ignora `.env` e `.env.*` (exceto `.env.example`) |
| README | Confirma protótipo sem login, upload só no navegador, observações em `localStorage` |

Conclusão: o protótipo é 100% client-side hoje. A camada Supabase é **nova** e foi criada sem tocar no código da interface.

### 1.2 Conexão / credenciais

- Conexão ativa via MCP remoto configurado em `opencode.json` (project_ref `tmawxagholhwxfekqvkm`).
- ~~**Atenção:** `opencode.json` contém um *personal access token* (`sbp_...`) em texto plano e o arquivo **não** está no `.gitignore`.~~ — **RESOLVIDO**: o token está na variável de ambiente do usuário (`SUPABASE_MCP_TOKEN`; o `opencode.json` usa `{env:...}`) e o `.gitignore` passou a ignorar `opencode.json` na preparação para publicação (2026-10-14, ver `docs/DOCUMENTACAO_AVALIACAO_DIRETORES.md` §15).
- Nenhum `service_role` é (ou será) usado no frontend. O único papel usado nas políticas é `authenticated`, via `auth.uid()`.

### 1.3 Banco de dados (estado anterior à migration)

| Verificação | Resultado |
| --- | --- |
| Tabelas no schema `public` | **0** (schema vazio — nada para duplicar) |
| Migrations registradas | **0** |
| Edge Functions | **0** |
| Buckets em `storage.buckets` | **0** |
| Políticas RLS em `storage` | **0** (nenhuma política existia) |
| Usuários em `auth.users` | **0** |
| Papéis disponíveis | `anon`, `authenticated`, `service_role`, `postgres`, `dashboard_user` |
| Default privileges em `public` | `anon`/`authenticated`/`service_role` recebem privilégios em tabelas novas (RLS é o portão real) |
| Advisors (segurança/performance) | limpos antes da mudança |

Verificação de capacidade: teste `create policy` em `storage.objects` dentro de transação com `rollback` → permitido (o papel `postgres` pode criar políticas nessa tabela).

---

## 2. O que foi criado

**Migration local:** `supabase/migrations/20261013120000_avaliacoes_diretores_inicial.sql`
**Migration aplicada no Supabase:** nome `avaliacoes_diretores_inicial` (versão registrada `20261013150133`)
**Natureza:** idempotente (executada 3x em validação, inclusive o artefato final completo, sem erro e sem duplicar estruturas).

### 2.1 Storage

| Item | Valor |
| --- | --- |
| Bucket | `avaliacoes-diretores-planilhas` |
| Público | `false` (privado) |
| Limite por arquivo | `15728640` bytes = 15 MB |
| MIME aceitos | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (XLSX), `application/vnd.ms-excel` (XLS) |
| Políticas | `avaliacoes_planilhas_storage_select` (SELECT) e `avaliacoes_planilhas_storage_insert` (INSERT), ambas `to authenticated` e restritas a `bucket_id = 'avaliacoes-diretores-planilhas'` |
| UPDATE / DELETE | **sem política** → sobrescrita, upsert e exclusão negados por default |
| anon | **sem política** → sem acesso |
| DML direta em `storage.objects` | **não utilizada** — bucket criado via `insert into storage.buckets` (mecanismo oficial de migrations); arquivos nunca serão movidos/excluídos por SQL |

Caminho convenção (registrado na migration, ainda não utilizado):

```
avaliacoes/{ano}/{trimestre}/{avaliacao_id}/{timestamp}-{nome-seguro}.xlsx
```

Observação: a validação de tipo acontece pelo `Content-Type` enviado no upload. Na etapa de upload o frontend deve enviar `contentType` explícito derivado da extensão (`.xlsx`/`.xls`) e validar a extensão antes de enviar.

### 2.2 Tabelas (schema `public`)

| Tabela | Colunas | RLS | Políticas |
| --- | --- | --- | --- |
| `avaliacoes_diretores` | 16 | habilitado | SELECT + INSERT (`authenticated`) |
| `avaliacoes_diretores_registros` | 12 | habilitado | SELECT + INSERT (`authenticated`) |
| `avaliacoes_diretores_periodos` | 7 | habilitado | SELECT + INSERT (`authenticated`) |
| `avaliacoes_diretores_indicadores` | 8 | habilitado | SELECT + INSERT (`authenticated`) |
| `avaliacoes_diretores_observacoes` | 12 | habilitado | SELECT + INSERT + UPDATE pelo autor |

Colunas conforme especificação. Acrescentos de implementação (padrões, não conflitam com o pedido):

- `storage_bucket` com default `avaliacoes-diretores-planilhas` (rastro de onde o arquivo está).
- `importado_por`, `criado_por` com `default auth.uid()` — a autenticação virá do sistema maior via JWT.
- `dados_originais jsonb not null default '{}'` — preserva a linha original da planilha.
- `ordem` e campos opcionais permanecem anuláveis (nenhum dado inventado).

### 2.3 Constraints (16)

- **CHECK:** `trimestre between 1 and 4`; `status in ('processando','publicada','arquivada','erro')`; `escopo in ('geral','regional','diretor')`.
- **FK:** `registros.avaliacao_id → avaliacoes(id) ON DELETE RESTRICT`; `periodos.registro_id → registros(id) RESTRICT`; `indicadores.registro_id → registros(id) RESTRICT`; `observacoes.avaliacao_id → avaliacoes(id) RESTRICT`; `observacoes.registro_id → registros(id) RESTRICT`; `avaliacoes.importado_por → auth.users(id) SET NULL`; `observacoes.criado_por/atualizado_por → auth.users(id) SET NULL`.
- **Unicidade (índices únicos parciais):** `uq_avaliacoes_diretores_hash_periodo (ano, trimestre, arquivo_hash) WHERE arquivo_hash IS NOT NULL AND status <> 'erro'` — impede reimportar o mesmo arquivo (hash) no mesmo período, sem impedir novas avaliações nem reenvio após falha (`status = 'erro'`); `uq_avaliacoes_diretores_storage_path (storage_path)` — cada avaliação ocupa um caminho único (nunca sobrescrito). *(O predicado `status <> 'erro'` foi acrescentado na fase 2, migration `avaliacoes_diretores_retry_hash_erro`.)*
- Implementação: bloco `DO` que só cria a constraint se ela não existir (idempotência real, não apenas `IF NOT EXISTS`).

### 2.4 Índices (26 = 5 PK + 21)

| Demanda | Índices |
| --- | --- |
| avaliação | `registros(avaliacao_id)`, `registros(avaliacao_id, diretor)`, `observacoes(avaliacao_id)` |
| ano/trimestre | `avaliacoes(ano, trimestre)` |
| status | `avaliacoes(status)` |
| regional | `registros(regional)`, `observacoes(regional)` |
| diretor | `registros(diretor)`, `observacoes(diretor)` |
| registro | `periodos(registro_id)`, `indicadores(registro_id)`, `observacoes(registro_id)` |
| período | `periodos(registro_id, ordem)`, `indicadores(registro_id, ordem)` |
| indicador | `indicadores(nome_indicador)` |
| apoio | `avaliacoes(importado_por)`, `observacoes(criado_por)`, `observacoes(atualizado_por)`, `observacoes(escopo)` + 2 únicos parciais |

### 2.5 Triggers

- Função `public.fn_avaliacoes_diretores_updated_at()` com `search_path` imobilizado (`set search_path = ''`) — atende ao linter de segurança.
- `trg_avaliacoes_diretores_updated_at` (BEFORE UPDATE em `avaliacoes_diretores`).
- `trg_avaliacoes_diretores_observacoes_updated_at` (BEFORE UPDATE em `observacoes`).
- `atualizado_por` é preenchido pelo frontend (default `auth.uid()` apenas em `criado_por`).

### 2.6 Políticas RLS (13 no total: 11 em `public` + 2 em `storage`)

| Tabela | Comandos | Regra |
| --- | --- | --- |
| `avaliacoes_diretores` | SELECT, INSERT | `authenticated`, `true` |
| `avaliacoes_diretores_registros` | SELECT, INSERT | `authenticated`, `true` |
| `avaliacoes_diretores_periodos` | SELECT, INSERT | `authenticated`, `true` |
| `avaliacoes_diretores_indicadores` | SELECT, INSERT | `authenticated`, `true` |
| `avaliacoes_diretores_observacoes` | SELECT, INSERT, UPDATE | INSERT com `criado_por is null or criado_por = (select auth.uid())`; UPDATE `using`/`with check` = autor |
| `storage.objects` | SELECT, INSERT | apenas bucket `avaliacoes-diretores-planilhas` |

- **Nenhuma política DELETE** em nenhuma tabela do módulo (0 ocorrências) → exclusão negada por default.
- **Nenhuma política UPDATE** fora de `observacoes`.
- **Nenhuma política para `anon`**; além do RLS, foi feito `revoke all ... from anon` nas 5 tabelas (defesa em profundidade).
- `auth.uid()` sempre usado como `(select auth.uid())` (corrige o alerta `auth_rls_initplan`).
- Todas as políticas usam o padrão `drop policy if exists` + `create policy` e nome com prefixo do módulo, preparadas para futura troca por papéis do sistema principal (basta acrescentar a checagem de papel nas expressões).

### 2.7 Comentários no banco

Comentário em cada tabela e nas políticas de storage/observações, explicando o papel de cada estrutura.

---

## 3. Validações executadas (resultado final)

| Verificação | Resultado |
| --- | --- |
| Bucket privado com 15 MB e 2 MIMEs | ✅ `bucket_ok = 1` |
| Tabelas em `public` | ✅ 5 |
| Colunas por tabela | ✅ 16 / 12 / 7 / 8 / 12 |
| Constraints em `public` | ✅ 16 (nenhuma duplicada após reexecução) |
| Índices totais | ✅ 26 |
| RLS habilitado | ✅ 5/5 tabelas |
| Políticas em `public` | ✅ 11 |
| Políticas em `storage.objects` do módulo | ✅ 2 |
| Políticas DELETE | ✅ 0 |
| Políticas UPDATE/DELETE em storage do módulo | ✅ 0 |
| Triggers `updated_at` | ✅ 2 |
| `anon` sem privilégio de leitura | ✅ `false` em todas as tabelas |
| `authenticated` com SELECT/INSERT | ✅ `true` em todas as tabelas |
| Linhas de dados inseridas | ✅ 0 (nenhum dado fictício) |
| Objetos em `storage.objects` | ✅ 0 (planilha não importada) |
| Idempotência (reexecução do artefato final) | ✅ sem erro, sem duplicações |
| Advisor de segurança | ✅ 0 lints |
| Advisor de performance | ⚠️ apenas `unused_index` (INFO) — esperado, tabelas vazias e sem consultas ainda |

---

## 4. Pontos de decisão pendentes (precisam de aprovação)

1. **Transição de `status` nas avaliações.** — **RESOLVIDO na fase 2** com a opção **(b)**: política de UPDATE restrita (colunas do fluxo, apenas linhas `processando` → `publicada`/`erro`) + `grant update` colunar para `anon`; avaliadas publicadas ficam imutáveis.
2. **Política de hash.** Unicidade atual é `(ano, trimestre, arquivo_hash) WHERE arquivo_hash IS NOT NULL AND status <> 'erro'` (retry permitido após falha). A mesma planilha pode ser importada em outro ano/trimestre; se o hash for nulo, a unicidade é ignorada.
3. **Extensão do arquivo.** O bucket valida MIME, não extensão. Se quiser garantia por extensão, avaliar trigger/Edge Function na etapa de upload.
4. **Autenticação vinda do sistema maior.** O JWT precisa entregar o papel `authenticated` (e, no futuro, papéis/perfis para as restrições administrativas). Hoje `auth.users` está vazio — `auth.uid()` será nulo até a integração.
5. **Segredo no `opencode.json`** (token `sbp_...` versionado) — mover para ambiente/secret antes de publicar o repositório.

---

## 5. Arquivos alterados / criados

| Arquivo | Ação |
| --- | --- |
| `supabase/migrations/20261013120000_avaliacoes_diretores_inicial.sql` | **criado** — migration idempotente completa |
| `docs/DIAGNOSTICO_SUPABASE_DIRETORES.md` | **criado** — este documento |
| `docs/MODELO_DADOS_AVALIACOES_DIRETORES.md` | **criado** — modelo de dados, relacionamentos, histórico, storage e segurança |
| `src/**`, `package.json`, `index.html`, `README.md` | **não modificados** |

Registro remoto: migration `avaliacoes_diretores_inicial` aplicada via MCP. Após a aplicação inicial foram feitos 3 ajustes de linter (função com `search_path` fixo, políticas com `(select auth.uid())` e índice em `observacoes.atualizado_por`) — todos já incorporados ao arquivo local, que é a fonte de verdade e reproduz o estado atual do banco (validado por execução completa).

## 6. Próxima etapa

A integração do upload React foi implementada na fase 2 (Seção 7). Próximos passos: leitura dos dashboards a partir do Supabase, observações autenticadas e substituição das políticas `anon` provisórias — **aguardando aprovação**.

---

## 7. Fase 2 — acesso `anon` provisório, retry de hash e integração do upload (2026-10-13)

Escopo executado nesta fase: políticas provisórias de `anon` restritas ao módulo, coluna `erro_detalhe`, retry de hash após falha, integração React↔Supabase do botão "Atualizar pela planilha", testes e documentação. A planilha de exemplo **foi importada de verdade** (ver §7.5).

### 7.1 Migrations aplicadas

| Migration | Nome remoto | Conteúdo |
| --- | --- | --- |
| `20261013180000_avaliacoes_diretores_acesso_anon_provisorio.sql` | `avaliacoes_diretores_acesso_anon_provisorio` | Coluna `erro_detalhe text`; `grant` explícitos para `anon` (select/insert nas 5 tabelas; update colunar só em `avaliacoes_diretores`); políticas `*_anon_provisorio` (select/insert ×5; update `using status='processando'` / `with check status in ('processando','publicada','erro')`; storage select+insert só no bucket do módulo); comentários `PROVISÓRIO` em todas |
| `avaliacoes_diretores_retry_hash_erro` (aplicada via MCP) | `avaliacoes_diretores_retry_hash_erro` | Troca do índice único de hash para `... WHERE arquivo_hash IS NOT NULL AND status <> 'erro'`, permitindo reenvio do mesmo arquivo após tentativa falhada |

Nenhuma política de DELETE, nenhuma política de UPDATE em `storage.objects` e nenhum acesso a outras tabelas/buckets foram criados.

### 7.2 Frontend (arquivos novos/alterados)

`src/services/{supabaseClient,fileValidator,hashService,storageService,avaliacoesService,importService}.js`, `src/components/ImportDialog.jsx`, reescrita de `src/dataParser.js` (análise/ prévia dinâmica), `src/App.jsx` (upload → diálogo → importação), `.env`/`.env.example` (chave pública apenas), estilos do modal em `src/styles.css`. Documentação em `docs/DOCUMENTACAO_AVALIACAO_DIRETORES.md`.

### 7.3 Correções encontradas pelos testes

- `norm()` compara sem acentos, mas o código comparava com `'NÍVEL'` → períodos nunca eram detectados (corrigido para `'NIVEL'`).
- `record.diretor` (undefined) — o parser usa chaves em inglês (`director`) → `INSERT` falhava com NOT NULL.
- `reg._record.indicadores` → campo correto `indicators`.
- Índice único de hash incluía tentativas `erro` e impedia retry → predicate `status <> 'erro'`.
- A API do Storage não retorna erro quando a RLS nega a exclusão (0 linhas) → teste confirma permanência do objeto.

### 7.4 Dependências e auditoria

`@supabase/supabase-js` instalado. O `xlsx` do npm estava com 1 advisory alto sem correção publicada no registro; migrado para o **CDN oficial do SheetJS `0.20.3`** → `npm audit` com **0 vulnerabilidades**.

### 7.5 Dados reais no banco (foram inseridos nesta fase)

| Dado | Situação |
| --- | --- |
| Avaliação `publicada` de `exemplo-planilha.xlsx` (2026/3) | criada pela suíte de integração, com 61 registros, períodos e indicadores |
| Arquivos no bucket | 1 objeto da avaliação publicada + resíduos de tentativas `erro` |
| Avaliações `erro` (resíduos de testes deliberados) | permanecem (sem DELETE no protótipo); não bloqueiam reimportação; limpeza é pendência administrativa |

### 7.6 Validações executadas

| Verificação | Resultado |
| --- | --- |
| Testes unitários (`npm test`) | ✅ 19/19 |
| Testes de integração reais (`npm run test:integration`) | ✅ 3/3 (importar, duplicidade, bloqueios) |
| `npm run build` | ✅ (chunk > 500 kB é só aviso do bundle do `xlsx`) |
| `npm audit` | ✅ 0 vulnerabilidades |
| Políticas `anon` restritas ao módulo | ✅ (validado pelos testes de bloqueio) |
| Advisors após as migrations | ✅ sem novos alertas de segurança |

### 7.7 Pendências da integração com o sistema maior

1. Remover as políticas `*_anon_provisorio` e substituir por políticas de usuário autenticado (o protótipo continua sem login próprio).
2. Limpar dados de teste (avaliações `erro` e objetos órfãos no bucket — requer privilégio administrativo).
3. Observações por usuário autenticado (nesta fase o rascunho de observação permanece só no navegador).
4. ~~Mover o token `sbp_...` do `opencode.json`~~ — **RESOLVIDO na fase 3** (token movido para a variável de ambiente do usuário `SUPABASE_MCP_TOKEN`; `opencode.json` usa `{env:SUPABASE_MCP_TOKEN}`; exigir restart do OpenCode). Se o arquivo já tiver sido compartilhado, revogar o token antigo no Supabase.

---

## 8. Fase 3 — Dashboards pelo Supabase (2026-10-13)

Escopo: os dashboards passam a ser alimentados exclusivamente pelas avaliações **publicadas** no Supabase; upload manual continua o mesmo fluxo; token pessoal removido do `opencode.json`; paridade local da migration de retry.

### 8.1 O que mudou no frontend

| Item | Situação |
| --- | --- |
| Fonte dos dashboards | `src/services/dashboardService.js` — `loadPublishedDashboard()` consulta `status = 'publicada'` nas tabelas `avaliacoes_diretores`, `_registros`, `_periodos` e `_indicadores` (lotes/paginação, sem N+1, sem `dados_originais`) |
| Modelo de comparação | `buildDashboardModel()` (função pura): avaliações ordenadas por ano/trimestre, registros com `avaliacaoLabel`, métricas EAV mapeadas aos nomes amigáveis (matchers compartilhados com o `dataParser`), agregados por avaliação, rótulos compostos de períodos internos |
| `src/App.jsx` | Sem seed local; estados **carregando / erro / vazio informativo**; filtros em cascata (regional → diretor; trocar regional limpa diretor); **todas as avaliações publicadas visíveis ao mesmo tempo**; recarrega do Supabase após publicação e no mount (F5 mantém os dados) |
| `src/data/initialRows.json` | **Removido** (não é mais fonte operacional; `exemplo-planilha.xlsx` permanece apenas como material de teste automatizado) |
| `LineChart` | Série opcional secundária (`pontosB`/`recordsB`) para comparar seleção × consolidado geral — sem mudança de layout |
| Observações | Rascunho local (localStorage) mantido temporariamente; integração com `avaliacoes_diretores_observacoes` fica para a etapa autenticada |

Identificação na tela: sidebar “Supabase · N avaliação(ões) publicada(s)”; cartões por avaliação com **título, trimestre, ano e nome real do arquivo**; tabela de composição com coluna “Avaliação”.

### 8.2 Segurança / configuração

- Token pessoal `sbp_...` **removido** do `opencode.json` (movido para fora do arquivo versionado; ver Seção 8.4).
- `.gitignore` ampliado: `opencode.local.json`, `.secrets/`, `*.local.json`.
- Nenhum valor real de chave registrado na documentação (apenas nomes de variáveis `VITE_SUPABASE_*`).
- Nenhuma mudança de RLS: dashboards usam o mesmo acesso `anon` provisório de leitura já autorizado.

### 8.3 Validações executadas (fase 3)

| Verificação | Resultado |
| --- | --- |
| Testes unitários (`npm test`) | ✅ 25/25 (inclui modelo dos dashboards) |
| Testes de integração (`npm run test:integration`) | ✅ 5/5 (dashboard somente publicadas + fluxo de importação) |
| `npm run build` | ✅ |
| Avaliação `publicada` de teste carregada pelo dashboard | ✅ (exemplo 2026/3, 61 registros) |
| Migração retry local (`20261013190000_avaliacoes_diretores_retry_hash_erro.sql`) | ✅ criada em paridade com a aplicada via MCP |

### 8.4 Pendências

1. **Teste manual obrigatório**: upload de uma planilha **real** escolhida pelo usuário pelo input (o `exemplo-planilha.xlsx` cobre apenas o teste automatizado) — publicar, conferir prévia/hash/Storage/tabelas, recarregar a página e confirmar os dados.
2. Observações no Supabase (etapa autenticada).
3. Substituição das políticas `anon` provisórias.
4. Limpeza administrativa dos dados de teste (avaliações `erro` e objetos órfãos).

---

## 9. Correção da tela branca pós-"Carregando avaliações publicadas..." (2026-10-13)

### 9.1 Sintoma

O app mostrava o estado de carregamento ("Carregando avaliações publicada..."), o Supabase respondia e, **alguns segundos depois** (justamente quando o carregamento terminava e a área de dashboards renderizava), a tela ficava **inteiramente branca**.

### 9.2 Causa exata

`RadarChart` (`src/components/Charts.jsx`) lia as métricas dos registros com a propriedade **inglesa** `r.metrics[n]`, mas o modelo do Supabase (`buildDashboardModel`, `src/services/dashboardService.js`) expõe as métricas com a propriedade **portuguesa** `r.metricas[n]`.

Consequência, reproduzida e confirmada em execução:

- `r.metrics` era `undefined` → `undefined['Nota geral']` lançava `TypeError: Cannot read properties of undefined (reading 'Nota geral')` **durante o render**.
- Como não havia Error Boundary, o React desmontava a árvore inteira → tela branca.

O contrato real é: `dataParser.js` gera `metrics` (inglês) → `importService.js` grava `metricas` (português) no banco → `buildDashboardModel` devolve `metricas`. **O RadarChart era o único ponto que ainda lia o nome antigo.**

### 9.3 Correções aplicadas

| Arquivo | Correção |
| --- | --- |
| `src/components/Charts.jsx` | `RadarChart` agora lê `r?.metricas?.[n]` (português + acesso defensivo a `null`/`undefined`); `avg` tolera lista ausente; `<title>` dos pontos usa template string (evita Array como children do React 19). |
| `src/components/ErrorBoundary.jsx` | **Novo**: Error Boundary da área principal — captura erro de render, registra o detalhe técnico no console (sem chaves/segredos) e mostra estado de erro com botão "Tentar novamente", mantendo o restante da tela. |
| `src/App.jsx` | `<main>` (header + conteúdo) envolto por `<ErrorBoundary>`; `reload()` registra o erro técnico no console antes de exibir a mensagem. |
| `tests/unit/dashboardModel.test.mjs` | Teste de regressão do contrato: registros do modelo expõem `metricas` e **não** `metrics`; o padrão `r?.metricas?.[n]` (usado pelo RadarChart) não lança exceção. |

Nenhuma alteração em banco, migrations ou políticas foi necessária — a falha era 100% de renderização no frontend.

### 9.4 Validações executadas

| Verificação | Resultado |
| --- | --- |
| Reprodução do `TypeError` original (acesso `r.metrics` em registro do modelo) | ✅ confirmado antes da correção |
| Smoke test de renderização (SSR via `vite.ssrLoadModule`): RadarChart com registros do modelo, vazio e com `null`/`undefined`; LineChart em modo pontos (valor `null`), history e vazio | ✅ 6/6 sem exceção; warning de `<title>` eliminado |
| Error Boundary (fallback com título, mensagem e "Tentar novamente"; `getDerivedStateFromError`; log sem expor segredos) | ✅ validado |
| `npm test` | ✅ 26/26 |
| `npm run build` | ✅ |

Observação: como a causa era um bug de renderização do frontend (e não de upload de planilha), o registro ficou nesta seção — não foi criado `DIAGNOSTICO_UPLOAD_PLANILHA_REAL.md` para este caso.

---

## 10. Causa exata da tela branca confirmada e reforçada (2026-10-13)

### 10.1 Causa exata (registrada a pedido do usuário)

**Objeto `metrics` ausente na renderização do `RadarChart`.** O componente lia os indicadores com a propriedade **inglesa** `record.metrics['Presencial']`, mas os registros reconstruídos a partir do Supabase (`buildDashboardModel`, `src/services/dashboardService.js`) expõem os indicadores com a propriedade **portuguesa** `record.metricas`. Com o objeto ausente, o acesso `undefined['Presencial']` lançava `TypeError: Cannot read properties of undefined (reading 'Presencial')` **durante o render**; sem Error Boundary, o React desmontava a árvore inteira → **tela branca**.

Fluxo do contrato de nomes (ponto único de conversão):

| Etapa | Propriedade | Arquivo |
| --- | --- | --- |
| Parser da planilha (importação) | `metrics` (inglês) | `src/dataParser.js` |
| Gravação no Supabase (`dados_originais` + tabelas EAV) | `metricas` (português) | `src/services/importService.js` |
| Reconstrução do modelo do dashboard | `metricas` (sempre `{}` quando não há indicadores) | `src/services/dashboardService.js` → `buildDashboardModel` |
| Leitura na interface (KPIs, cards e radar) | via conversão única `recordMetric` | `src/services/dashboardService.js` |

O erro `404` de `/favicon.ico` é secundário e não causa tela branca.

### 10.2 Verificações obrigatórias (checklist) e resultado

| # | Verificação | Resultado |
| --- | --- | --- |
| 1 | Inspecionar `Charts.jsx` (linha 165 do bundle antigo = acesso `record.metrics['Presencial']`) | ✅ causa identificada; o arquivo atual não possui mais esse acesso |
| 2 | Inspecionar o serviço que reconstrói registros/períodos/indicadores | ✅ `loadPublishedDashboard` + `buildDashboardModel` |
| 3 | Todo registro reconstruído possui `metricas: {}` quando não há indicadores | ✅ `buildDashboardModel` sempre monta o objeto (vazio se nada vier) |
| 4 | Indicadores agrupados por `registro_id` | ✅ `Map` `indicadoresPorRegistro` (e períodos em `periodosPorRegistro`) |
| 5 | Nome real usado pela interface | ✅ `metricas` (português) no modelo do dashboard |
| 6 | Nomes `indicadores`/`metrics`/`metricas` não misturados sem conversão | ✅ conversão ÚNICA em `recordMetric()`; nenhum componente lê a propriedade direto |
| 7 | `RadarChart` nunca lê `record.metrics`/`record.metricas` sem proteção | ✅ leitura passa por `buildRadarSeries` → `recordMetric` |
| 8 | Tratamento `record?.metrics?.[nome] ?? null` | ✅ equivalente em `recordMetric` (retorna `null` para ausente) |
| 9 | Somente valores numéricos válidos na média | ✅ `avgNumbers` filtra `Number.isFinite` |
| 10 | Ausência do indicador não vira zero | ✅ `normalized()` devolve `null` para ausente (antes virava `0` e distorcia o radar) |
| 11 | Sem nenhum indicador → "Indicadores não disponíveis" | ✅ `RadarChart` renderiza o estado vazio no lugar do radar |
| 12 | Error Boundary impedindo página branca | ✅ `main.jsx` (última linha), `App.jsx` (área principal) e **por gráfico** (radar e evolução) |

### 10.3 Correções aplicadas nesta rodada

| Arquivo | Correção |
| --- | --- |
| `src/services/dashboardService.js` | Novos `recordMetric()` (conversão única `metricas`/`metrics` → número ou `null`) e `buildRadarSeries()` (só eixos numéricos; `disponivel:false` quando não há nenhum) |
| `src/components/Charts.jsx` | `RadarChart` reconstruído sobre `buildRadarSeries`; `normalized()` não converte ausente em `0`; estado "Indicadores não disponíveis"; eixo/rótulos seguem só os indicadores existentes |
| `src/App.jsx` | KPI "Nota geral" e o card "Indicadores da seleção" usam `recordMetric` (antes liam `r.metricas[...]` sem proteção); radar e linha envolvidos em Error Boundary por gráfico |
| `src/main.jsx` | Error Boundary de última linha em torno de `<App/>` |
| `src/components/ErrorBoundary.jsx` | Título configurável (`props.titulo`) para os fallbacks |
| `src/styles.css` | Classe `.chart-empty` para o estado "Indicadores não disponíveis" |
| `tests/unit/dashboardModel.test.mjs` | Testes de regressão: `recordMetric` (conversão e ausência ≠ 0) e `buildRadarSeries` (indisponível sem indicadores; média não puxada por registro sem indicador) |

### 10.4 Validações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test` | ✅ 28/28 |
| `npm run test:integration` | ✅ 5/5 (dashboard real do Supabase + fluxo de importação) |
| `npm run build` | ✅ (bundle novo gerado em `dist/`) |
| Smoke de render (SSR): `RadarChart` com registro **sem** `metricas`, com `metricas` parcial, com `metrics` (parser), lista vazia e `undefined` | ✅ 6/6 sem exceção; sem indicadores mostra "Indicadores não disponíveis" |
| `npm run preview` servindo `dist/` | ✅ HTTP 200 |

Pendente do usuário (teste manual): abrir o sistema, aguardar ~15 s, confirmar que **não** fica branco, pressionar F5, conferir o Console e registrar o resultado.

---

## 11. Limpeza dos dados de teste automatizado (2026-10-13)

### 11.1 Objetivo

Remover **exclusivamente** os dados das avaliações criadas pelos testes automatizados (título `Teste automatizado — exemplo`, arquivo `exemplo-planilha.xlsx`), deixando o módulo vazio para o primeiro upload real do usuário. Nenhuma avaliação real (futura) foi afetada — o critério foi o título/nome de arquivo do teste, **nunca** ano/trimestre/status isolados.

### 11.2 O que foi identificado e removido

Foram encontradas **4** avaliações de teste (1 `publicada` + 3 `erro` de tentativas anteriores que falharam). Todas removidas pelos UUIDs exatos:

| UUID | Status | Registros | Períodos | Indicadores | Observações | Arquivo no Storage |
| --- | --- | --- | --- | --- | --- | --- |
| `9907192d-9d9a-498c-8828-6f64167818a1` | erro | 0 | 0 | 0 | 0 | `avaliacoes/2026/3/9907192d-…/1791908009398-exemplo-planilha.xlsx` |
| `b60e3965-fd0f-4c69-9ed2-4b812baeb7db` | erro | 0 | 0 | 0 | 0 | `avaliacoes/2026/3/b60e3965-…/1791908216906-exemplo-planilha.xlsx` |
| `068b13d8-df76-43b3-8bc9-03c9c14bf970` | erro | 0 | 0 | 0 | 0 | `avaliacoes/2026/3/068b13d8-…/1791908219218-exemplo-planilha.xlsx` |
| `e5d0bbf7-76be-4078-8bbe-fd0ea5183a42` | publicada | 61 | 976 | 540 | 0 | `avaliacoes/2026/3/e5d0bbf7-…/1791908276114-exemplo-planilha.xlsx` |

**Removidos por tabela** (total): `avaliacoes_diretores` **4** · `avaliacoes_diretores_registros` **61** · `avaliacoes_diretores_periodos` **976** · `avaliacoes_diretores_indicadores` **540** · `avaliacoes_diretores_observacoes` **0** · objetos no bucket `avaliacoes-diretores-planilhas` **4** (caminhos acima).

### 11.3 Como foi feito

- Exclusão na ordem correta (filhos → pais): indicadores e períodos (por `registro_id`), observações (por `avaliacao_id`), registros e, por fim, as avaliações — sempre pelos **UUIDs exatos**, sem filtros amplos.
- Arquivos no Storage removidos pelo caminho admin (o papel `anon` não tem DELETE na API). O Supabase protege `storage.objects` com o trigger `protect_delete`; a exclusão foi feita habilitando oficialmente `storage.allow_delete_query` na sessão e removendo **somente** os 4 caminhos exatos. O **bucket não foi excluído**; apenas os objetos de teste.

### 11.4 Regras respeitadas

Bucket mantido · tabelas mantidas · migrations intocadas · políticas RLS mantidas · funções/triggers mantidos · nenhuma outra avaliação afetada · nenhum filtro só por ano/trimestre · nenhum login criado · nenhum dado de teste reinserido.

### 11.5 Estado final e correção dos testes

- **Banco**: 0 avaliações, 0 registros, 0 períodos, 0 indicadores, 0 observações, 0 arquivos no bucket (bucket presente). Tela exibe o **estado vazio informativo** com **zero avaliações publicadas** e o botão “Atualizar pela planilha” disponível; sem tela branca.
- **Testes corrigidos para não deixar resíduos**:
  - `tests/integration/fakeSupabase.mjs` (**novo**) — cliente Supabase fake em memória (tabelas + bucket) para o fluxo de importação.
  - `tests/integration/import.integration.test.mjs` — reescrito para usar o fake via `mock.module`: publica, detecta hash duplicado, marca `erro` em falha de envio e confirma sanidade, **sem tocar o Supabase real**.
  - `tests/integration/dashboard.integration.test.mjs` — somente leitura, agora **tolerante a banco vazio** (valida o modelo e o estado vazio).
  - `tests/integration/rls.integration.test.mjs` (**novo**) — sondagens de RLS (DELETE/UPDATE/sobrescrita negados) que **não criam dados** e confirmam ausência de resíduo.
  - `package.json` — scripts `test:integration`/`test:all` com a flag `--experimental-test-module-mocks`.
- **Validações**: `npm test` 28/28 · `npm run test:integration` 10/10 (importação fake + dashboard/RLS reais) · banco confirmado vazio após os testes.

### 11.6 Próximo passo

Upload manual da planilha real pelo usuário (não executado nesta etapa).

---

## 12. Correção dos cálculos de quantidade e do gráfico de evolução (2026-10-13)

Escopo restrito aos **cálculos de quantidade** (diretórios/unidades) e à **organização do gráfico de evolução**. Sem novas funcionalidades; sem tocar banco, upload, login ou o RadarChart.

### 12.1 Problemas encontrados

| # | Problema | Causa |
| --- | --- | --- |
| 1 | KPI "Diretores" exibia **61** (nº de registros) em vez de **60** (diretores válidos) | Card lia `r.director` (propriedade **inexistente** no modelo — o campo é `r.diretor`) → `undefined` → `filter(Boolean)` não descartava nada e o Set contava um `undefined` por registro |
| 2 | Card "Avaliações publicadas" mostrava diretores/unidades errados por avaliação | `aggregateRegistros` usava `new Set(registros.map(r => r.diretor).filter(Boolean))` — não descartava o marcador técnico **"Diretor não informado"** nem normalizava espaços/maiúsculas |
| 3 | Gráfico de evolução misturava séries e usava títulos legados | Título "Evolução entre avaliações" (antigo, de comparação entre publicações); séries montadas por caminhos distintos com rótulos/legendas inconsistentes; eixo X com rótulos longos ("JAN DE 2026") que se sobrepunham |

### 12.2 Contagens — função única (`dashboardService.js`)

Criada a família de helpers usada por **toda** a UI (KPIs, resumo lateral, cascata regional→diretor e agregados por avaliação):

| Helper | Regra |
| --- | --- |
| `normName(v)` | remove espaços extras |
| `isPresentName(v)` | descarta nulo/vazio e marcadores técnicos (`Diretor não informado`, `Unidade não informada`, `sem diretor`, `n/d`, `-` etc.) |
| `nameKey(v)` | chave de comparação sem espaços extras e sem diferença de maiúsculas |
| `countDistinctNames(records, field)` | **contagem definitiva** de nomes distintos e válidos — nunca nº de registros |
| `distinctNames(values)` | lista ordenada de nomes distintos/válidos (dropdowns de regional/diretor) |

`aggregateRegistros`, `regionalsOf` e `directorsOf` passaram a usar esses helpers. `App.jsx`: KPIs (Diretores/Unidades), resumo da sidebar e demais leituras usam `countDistinctNames(visible, 'diretor'|'unidade')` — o bug `r.director` (inglês) foi eliminado.

### 12.3 Dados reais validados (planilha `exemplo-planilha.xlsx`)

Consulta SQL direta na avaliação publicada (`cdb34a20-…`, 3º tri/2026) confirma:

| Métrica | Valor |
| --- | --- |
| Registros | 61 |
| **Diretores válidos** (KPI) | **60** (o 61º é o marcador "Diretor não informado" — UNAMA PORTO VELHO, regional EDEN FERREIRA) |
| **Unidades** (KPI) | **60** |
| Regional **PAULO PALMEIRA** | 13 registros · **13 diretores** · 13 unidades |
| Outras regionais | AISLANE BELO 17/17/17 · EDEN FERREIRA 17/17/17 · MARCUS PONTE 11/11/11 · ROGÉRIO XAVIER 3/3/2 (UNG GUARULHOS CENTRO dividida entre 2 diretores) |

### 12.4 Gráfico de evolução — reorganização

| Item | Antes | Depois |
| --- | --- | --- |
| Título | "Evolução entre avaliações" | **"Evolução dos períodos internos"** + subtítulo "Estágio e nível ao longo dos períodos encontrados na Planilha1" |
| Séries | caminhos distintos (`pontos`/`records`/`recordsB`) com legendas fixas | **1..3 séries** por nível de análise (Geral: consolidado geral · Regional: seleção + geral · Diretor: diretor + consolidado regional + geral), com **deduplicação** por assinatura de ids de registros (sem linhas/legendas duplicadas) |
| Eixo X | rótulos longos que se sobrepõem | **abreviações fixas** (`abbreviatePeriods`): `2TRI/25`→`2º TRI/25`, `JULHO`→`JUL/25`, `JAN DE 2026`→`JAN/26` — ano inferido do rótulo vizinho; **sem sobreposição**; tooltip mantém o rótulo completo |
| Layout | SVG único com overflow | **2 SVGs**: eixo Y fixo (níveis 1–5) + área com rolagem horizontal quando não cabe (GAP mínimo ~96px por período); moldura `.chart-frame` |
| Valores | 2 casas, sem tratamento de proximidade | **1 casa decimal em pt-BR** (vírgula), acima do ponto, alternando verticalmente quando muito próximos; **ausente = quebra na linha** (nunca 0) |
| Cores | teal + cinza | seleção **azul-petróleo** (sólida) · média regional **laranja/dourado** (tracejada) · média geral **cinza** (pontilhada); legenda gerada a partir das séries desenhadas |

`LineChart` foi reescrito para receber `{periods, series}`; `buildPeriodLabelMap` continua responsável pelos rótulos compostos ("JULHO · 2º tri/2026") quando o mesmo rótulo aparece em mais de uma avaliação.

### 12.5 Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `src/services/dashboardService.js` | helpers de contagem (`normName`/`isPresentName`/`nameKey`/`countDistinctNames`/`distinctNames`), `abbreviatePeriods`, `aggregateRegistros`/`regionalsOf`/`directorsOf` sobre os helpers |
| `src/App.jsx` | KPIs e resumo lateral por `countDistinctNames`; memo de `evolução` com séries `sel`/`reg`/`all` + deduplicação; título/subtítulo novos; legenda dinâmica |
| `src/components/Charts.jsx` | `LineChart` reescrito (períodos+series, eixo fixo, rolagem, valores fixos, cores por série, tooltip com rótulo completo); **RadarChart intocado** |
| `src/styles.css` | `.chart-frame`/`.chart-yaxis`/`.chart-scroll`, cores `.line-sel`/`.line-reg`/`.line-all`, `.val-*`, `.x-label`, marcadores da legenda |
| `tests/unit/dashboardModel.test.mjs` | testes de `countDistinctNames` (incl. cenário real 61→60), `distinctNames`/`isPresentName` e `abbreviatePeriods` (16 rótulos reais) |
| `tests/integration/dashboard.integration.test.mjs` | correção de bug pré-existente: `label`/`titulo` validados no **modelo** (`model.avaliacoes`), não no row cru do Supabase |

### 12.6 Validações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test` | ✅ **31/31** |
| `npm run test:integration` | ✅ **10/10** (fake + leitura real) |
| `npm run build` | ✅ |
| Contagens reais via SQL (avaliação publicada) | ✅ 60 diretores · 60 unidades · PAULO PALMEIRA 13/13/13 |

### 12.7 Regras respeitadas

Sem novas funcionalidades · sem alteração de banco/migrations/políticas · sem tocar upload ou login · RadarChart intocado · nenhuma mudança de RLS · nenhuma avaliação real afetada.

Pendente do usuário: teste manual na tela (KPIs 60/60, regional PAULO PALMEIRA 13, gráfico de evolução com abreviações/rolagem/legenda por série) e aprovação.

---

## 13. Simplificação e organização visual da interface (2026-10-13)

Escopo restrito à **camada de apresentação**: remover referências técnicas da interface, simplificar a lateral e reorganizar os blocos em largura total. **Sem novas funcionalidades**; cálculos, persistência, banco, upload, login, migrations e políticas **intocados**.

### 13.1 Regras aplicadas

| # | Regra | Aplicação |
| --- | --- | --- |
| 1 | Remover referências técnicas | Mensagens de carga/erro/estado vazio em linguagem simples ("Não foi possível carregar as avaliações", "Tente novamente em instantes"); helper `humanError` (em `App.jsx` e `ImportDialog.jsx`) traduz na **exibição** mensagens do parser/serviços ("aba chamada Planilha1"→"aba principal da planilha", "Planilha1"→"planilha", `VITE_SUPABASE_*`→"a configuração", "Supabase"→"sistema de dados", "Storage"→"o envio do arquivo", "RLS"→"as regras de acesso"); campo Arquivo do modal exibe `arquivoNome` (não o caminho interno); removidos "Nível de análise", "fonte: Supabase", "avaliações publicadas" e "· aba Planilha1". O termo "Planilha1" continua apenas em código interno, testes e documentação |
| 2 | Filtros em cascata | "Nível de análise" removido; a lateral tem só **Regional** e **Diretor**; o dropdown de diretores lista apenas os da regional escolhida; trocar a regional limpa o diretor; o diretor fica desabilitado sem regional; "Todos os diretores" nunca conta como diretor |
| 3 | Títulos por seleção | **Desempenho geral** (todas + todos) · **Desempenho da regional** (regional + todos) · **Perfil do diretor** (regional + diretor) |
| 4 | Lateral simplificada | Só: marca ("Matriz de Desenvolvimento" / "Avaliação de desempenho dos diretores"), "Atualizar pela planilha", Regional, Diretor, resumo da seleção, observação e "Salvar observação"; **uma única rolagem vertical da página** (sem altura fixa nem barra interna na lateral); sem segmentos de visualização |
| 5 | Blocos empilhados em largura total | Ordem fixa no `.stack`: **Histórico das avaliações → Evolução dos períodos → Comparação de desempenho → Indicadores → Detalhes da seleção**; sem grade de colunas |
| 6 | Gráficos maiores | `.chart` 430px no desktop (380px no mobile); LineChart com eixo Y fixo (H=360) e **largura inline do SVG** para que a rolagem horizontal funcione apesar de `.chart-svg{width:100%}`; RadarChart ampliado (viewBox 760×420, centro 380/195, raio 145, rótulos no fator 1.28), centralizado com legenda abaixo (`.legend.center`) |
| 7 | Textos simples | Selo "**1 avaliação disponível**" / "**X avaliações disponíveis**"; cards com títulos curtos; sem nomes técnicos de banco/auth na interface |
| 8 | Responsividade | KPIs 2 colunas em telas médias e 1 coluna no mobile; gráfico 380px; filtros empilhados na lateral (posições relativas, sem altura máxima) |

### 13.2 Observação por seleção

Chave do rascunho no navegador: `obs:{regional|geral}:{diretor|todos}` — cada combinação de filtros guarda a própria observação (ex.: `obs:PAULO PALMEIRA:MARCEL0…`).

### 13.3 Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `src/App.jsx` | Reescrito: sem estado de visualização (um só fluxo de tela); filtros em cascata regional→diretor; títulos/seletores novos; blocos `.stack` na ordem fixa; estados de carga/erro/vazio em português simples; `humanError` na exibição do erro de upload; nota por seleção (`obs:…`); KPI "Avaliações" por ids visíveis |
| `src/components/Charts.jsx` | LineChart H=360/T=24/B=58 com `style={{width:W,height:H}}` inline (rolagem horizontal garantida); RadarChart com `W/H/cx/cy/r` maiores e rótulos afastados (lógica intacta) |
| `src/styles.css` | Removidos `.source`, `.segments`, `.grid` e classes mortas (`.line-path-b`/`.dot-b`); `.sidebar` sem `height`/`overflow` (rolagem única); `.stack`; `.chart` 430/380; `.chart-frame` centralizado; `.legend.center`; `.metric-grid` em `repeat(auto-fit,minmax(190px,1fr))`; media queries 1050/720 atualizadas |
| `src/components/ImportDialog.jsx` | Arquivo exibido como nome real (`arquivoNome`); "aba Planilha1" removido do modal; mensagem de erro passa por `humanError` |

### 13.4 Validações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test` | ✅ **31/31** |
| `npm run test:integration` | ✅ **10/10** (fake + leitura real) |
| `npm run build` | ✅ |
| Combos de filtro (consolidado geral · consolidado regional · perfil do diretor; troca de regional limpando o diretor) | ✅ revisados em `visible`/`evolution`/`title` (`App.jsx`) |
| Referências técnicas na interface ("Supabase", "sem login", "anon", "publicadas", "Planilha1", `storagePath`, "Nível de análise") | ✅ ausentes do JSX renderizado (só permanecem em comentários, testes, docs e no próprio sanitizador) |

### 13.5 Regras respeitadas

Sem novas funcionalidades · cálculos/persistência/banco/upload/login/migrations/políticas intocados · nenhum dado real afetado · testes e documentação atualizados.

Pendente do usuário: teste manual na tela (textos, cascata de filtros, rolagem única, gráficos maiores, sem termos técnicos) e aprovação.

---

## 14. Matriz histórica de desempenho (2026-10-13)

Substituição do card “Detalhes da seleção” pela **Matriz histórica de desempenho** (`src/components/PerformanceMatrix.jsx`), que reproduz a planilha original: colunas congeladas + histórico dinâmico por período + bloco final de situação/indicadores + 8 filtros locais. **Sem alteração de upload, banco, gráficos ou filtros laterais.**

### 14.1 Verificação de dados (sem migration/coluna nova)

Todos os campos necessários **já existem** — a matriz é pura leitura do modelo (`buildDashboardModel`):

| Necessidade | Origem | Campo |
| --- | --- | --- |
| Coluna de histórico | `avaliacoes_diretores_periodos` | `rotulo_periodo`, `ordem`, `estagio`, `nivel` |
| Identificação | `avaliacoes_diretores_registros` | `regional`, `diretor`, `unidade` |
| Bloco final | `avaliacoes_diretores_registros` | `status_gestao`, `ciclo_vida`, `nivel_atual` |
| Indicadores | `avaliacoes_diretores_indicadores` (EAV) | 9 amigáveis (`friendlyMetricName`) |

### 14.2 Regra de leitura (nunca confundir)

- **Histórico**: `periodo.estagio` (Status) e `periodo.nivel` (Nível) — colunas por período.
- **Bloco final**: `registro.statusGestao` (`status_gestao`), `registro.cicloVida` (`ciclo_vida`), `registro.nivelAtual` (`nivel_atual`).
- São leituras distintas do mesmo registro: `status_gestao` ≠ `estagio`; `nivel_atual` ≠ `nivel` do período. O teste unitário de regressão garante a separação.

### 14.3 Caso Hesdras Viana (verificado no banco real)

| Leitura | Valor |
| --- | --- |
| Regional / Diretor / Unidade | PAULO PALMEIRA / HESDRAS VIANA / UNINASSAU BOA VIAGEM |
| Período `SET/3TRI 2026` (ordem 15) → estagio / nivel | Gestão I / (III) |
| Registro → statusGestao / cicloVida / nivelAtual | Delegação I / Reposicionamento / (IV) |
| Indicadores EAV | 5 dos 9 (faltam Presencial, Acadêmico, Pós-graduação, Nota geral → “—”, nunca 0) |

Validado no teste de integração (tolerante: só asserções quando o registro existe).

### 14.4 Arquivos alterados/novos

- **Novos**: `src/components/PerformanceMatrix.jsx` (filtros, contador, cabeçalho de 2 linhas, colunas congeladas, bloco final, extras dinâmicos), `tests/unit/matrix.test.mjs`.
- **Alterados**: `src/services/dashboardService.js` (exports puros `MATRIX_INDICATORS`, `matrixPeriodColumns`, `filterMatrixRows`, `formatMetricCell`), `src/App.jsx` (apenas o card final + import), `src/styles.css` (estilos `.matrix`), `tests/integration/dashboard.integration.test.mjs` (asserção tolerante de Hesdras), `docs/DOCUMENTACAO_AVALIACAO_DIRETORES.md` (§7).

### 14.5 Filtros da matriz

8 filtros locais combinados por AND, com “Todos”/“Limpar filtros” e contador “X de Y registro(s)”: Regional · Diretor · Unidade · Período · Status trimestral · Nível · Status de gestão · Ciclo de vida. O filtro **Período** delimita a casca em que **Status trimestral/Nível** valem: com período escolhido, casam só naquele período; sem período, em qualquer período do registro. Registro sem o período escolhido não casa. Opções dos filtros de status/nível são escopadas pelo período.

### 14.6 Validações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test` | ✅ **37/37** (6 novos da matriz) |
| `npm run test:integration` | ✅ **11/11** (fake + leitura real + matriz/Hesdras) |
| `npm run build` | ✅ |
| Caso Hesdras (colunas, bloco final, filtros por período) | ✅ unitário + integração contra banco real |

### 14.7 Pendências

- **Mapa de calor** (coloração de células): fora desta etapa, conforme aprovado — próxima rodada.

---

## 16. Correção do gráfico de evolução trimestral (2026-10-13)

### 16.1 Problema

O gráfico misturava meses individuais (`JULHO`, `AGOSTO`, `OUTUBRO`…) com trimestres consolidados (`2TRI/25`, `SET/3TRI`…), gerando 16 pontos confusos no eixo X. O usuário pediu exclusivamente os trimestres consolidados existentes na planilha — sem alterar CRUD de observações, banco, filtros, upload, cards, radar, indicadores, tabela, bloco Histórico, matriz, mapa de calor, políticas ou migrations.

### 16.2 O que foi alterado (3 arquivos de código + 1 de testes)

| Arquivo | Mudança |
|---|---|
| `src/dataParser.js` | `romanLevel` reescrita com **correspondência exata**: limpa parênteses/espaços e faz lookup em `ROMAN_MAP = {I:1, II:2, III:3, IV:4, V:5}` — nunca reconhece `I` dentro de `II`/`III`/`IV` nem `V` dentro de `IV`; `null` para ausente/`VI`/`X` |
| `src/services/dashboardService.js` | Novas funções puras: **`parseQuarterHeader(rotulo)`** — identifica trimestres por cabeçalho (sem posição fixa, coluna fixa ou lista limitada a 2026); aceita `2TRI/25`, `1º TRI/26`, `1 TRI 2026`, `MAR/1TRI 2026`, `SET/3TRI`, `DEZ/4TRI 2026` etc.; retorna `{isQuarter, quarter, year, label, sortKey}`; mês puro nunca é trimestre. **`buildQuarterLabelMap(registros, avaliacoes)`** — varre todos os períodos em ordem (avaliação, `ordem`), infere ano ausente a partir do trimestre anterior (`q > qAnterior` → mesmo ano; senão `ano+1`; fallback = menor ano das avaliações), deduplica e ordena por **(ano, trimestre)**; retorna `labelMap` + `columns` |
| `src/App.jsx` | Memo `evolution` reescrito: usa `buildQuarterLabelMap` para montar **somente trimestres**; meses permanecem no banco/matrizes mas ficam fora deste gráfico; título mudou de "Evolução dos períodos" para **"Evolução trimestral"**, subtítulo para "Nível consolidado em cada trimestre." |
| `tests/unit/quarterly.test.mjs` | **Novo** — 6 testes: variações de cabeçalho, meses rejeitados, 16 rótulos reais → 6 trimestres, ordenação por (ano, trimestre), `romanLevel` exata, caso Gregorio Batista (5,5,5,1,1,2) |

### 16.3 Comportamento com a planilha atual

Eixo X exibe exatamente **6 trimestres** (sem nenhum mês individual):

`2º TRI/2025` → `3º TRI/2025` → `4º TRI/2025` → `1º TRI/2026` → `2º TRI/2026` → `3º TRI/2026`

O gráfico **cresce automaticamente** com novas planilhas (ex.: `4º TRI/2026`, `1º TRI/2027`…), sem depender de posição, coluna ou lista fixa.

### 16.4 Validações

- `npm test` ✅ **43/43** (37 anteriores + 6 novos)
- `npm run build` ✅
- `npm run test:integration` ✅ **11/11**
- Dev server: HTML OK, 3 módulos transformados sem erro, `parseQuarterHeader`/`buildQuarterLabelMap`/`ROMAN_MAP` presentes no bundle, título antigo removido

### 16.5 O que NÃO foi alterado

CRUD de observações · banco/migrations/políticas · filtros Regional/Diretor · upload · cards do dashboard · radar · indicadores · tabela de detalhes · bloco Histórico das avaliações · matriz histórica · mapa de calor.

---

## 17. Correção da largura do gráfico "Evolução trimestral" (2026-10-13)

### 17.1 Problema

O card ocupava 100% da página, mas o desenho do gráfico ficava limitado à metade esquerda. A área direita permanecia vazia.

### 17.2 Causa da limitação

Em `src/components/Charts.jsx`, o `LineChart` calculava a largura do SVG com **gap fixo de 96 px**:

```js
const GAP=96,PAD=46,H=360,T=24,B=58;
const W=PAD*2+GAP*Math.max(0,labels.length-1);  // 6 labels → W = 572 fixo
```

E forçava essa largura no DOM via atributo e estilo inline:

```jsx
<svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{width:W,height:H}}>
```

Com 6 trimestres, `W` era sempre **572 px**, independente do card (~1530 px em 1920×1080). O `.chart-scroll` (`overflow-x:auto`) exibia o SVG de 572 px à esquerda, deixando o restante vazio. Não havia `ResizeObserver` nem cálculo de largura disponível.

### 17.3 Correção responsiva aplicada

**`src/components/Charts.jsx`** — `LineChart` reescrito:

- **`ResizeObserver`** mede `clientWidth` do `.chart-scroll` (container interno) e atualiza `availW` via `useState`;
- **`useLayoutEffect`** garante medição síncrona antes do primeiro paint (evita flash de largura estreita);
- **Gap dinâmico**: `gap = max(MIN_GAP, (availW − 2×PAD) / (n−1))` — distribui os pontos igualmente por toda a largura útil; `MIN_GAP=96` preserva legibilidade e permite rolagem apenas em telas muito estreitas;
- **Largura do SVG**: `W = max(availW, 2×PAD + gap×(n−1))` — com 6 trimestres em qualquer resolução ≥ ~700 px, `W = availW` (sem rolagem);
- **Removido** `style={{width:W,height:H}}` (largura fixa inline);
- Margens preservadas: `PAD=46` à esquerda (números do eixo Y + respiro do primeiro ponto) e à direita (respiro do último ponto); `T=24` topo, `B=58` base (rótulos do eixo X).

**`src/styles.css`** — `.chart-frame` ganhou `width:100%` (antes dependia só do comportamento de bloco).

### 17.4 Comportamento por resolução (medido em runtime)

Largura útil = viewport − sidebar 330 − padding main 60 − borda+padding do card 38 − eixo Y 42.

| Resolução | Largura útil | Gap entre pontos | x do 1º ponto | x do último ponto | Margem direita | Rolagem |
|---|---|---|---|---|---|---|
| 1920×1080 | 1450 px | 272 px | 46 px | 1404 px | 46 px | não |
| 1440 (notebook) | 970 px | 176 px | 46 px | 924 px | 46 px | não |
| 1366×768 | 896 px | 161 px | 46 px | 850 px | 46 px | não |
| 1100 (redimensionada) | 630 px | 108 px | 46 px | 584 px | 46 px | não |
| ≤ ~700 px | < 572 px | 96 px (MIN_GAP) | 46 px | 526 px | — | não (o SVG `width:100%` encolhe o desenho em vez de rolar) |

Com `width:100%` no `.chart-svg`, o `overflow-x:auto` do `.chart-scroll` nunca é acionado — abaixo de ~700 px o desenho é reduzido (`preserveAspectRatio="meet"`) em vez de criar rolagem horizontal.

### 17.5 Validações

- `npm test` ✅ **43/43**
- `npm run build` ✅ (`✓ built in 822ms`)
- Dev server: `Charts.jsx` transformado com `ResizeObserver`/`useLayoutEffect`/`availW`/`MIN_GAP` presentes, `style` fixo removido (`style inline width = False`); `.chart-svg{width:100%}`, `.chart{height:430px}`, `.chart-frame{width:100%}`, `box-sizing:border-box` global, nenhum `max-width` nos containers do gráfico.
- **Validação visual obrigatória** (capturas headless do Edge em `http://localhost:5173/`):
  - **1920×1080** ✅ linha ocupa toda a largura branca do card; 6 pontos distribuídos da esquerda à direita; sem metade direita vazia; eixo Y (1–5) e rótulos do eixo X legíveis; legenda abaixo.
  - **1366×768** ✅ mesmo comportamento, margens simétricas.
  - **1100 px com barra lateral aberta** (notebook/navegador redimensionado) ✅ recálculo do gap mantém a distribuição em toda a largura; sem rolagem horizontal.

### 17.6 O que NÃO foi alterado

Dados · trimestres · cálculos · séries · legendas · valores · banco · observações · filtros · radar · outros componentes.

---

## 15. CRUD de observações no banco (2026-10-13)

Substituição do localStorage pelo CRUD completo em `avaliacoes_diretores_observacoes`. **Sem alteração** de gráficos, filtros, upload, dashboard, histórico das avaliações ou layout geral.

### 15.1 Migration aplicada

| Migration | Nome remoto | Conteúdo |
| --- | --- | --- |
| `supabase/migrations/20261013200000_avaliacoes_diretores_observacoes_update_anon.sql` | `avaliacoes_diretores_observacoes_update_anon` | `grant update (observacao, arquivada_em, updated_at)` para `anon`; política `..._update_anon_provisorio` (using/with check `true`); `DELETE` físico permanece sem política (bloqueado) |

Antes: `anon` tinha `SELECT+INSERT` mas **não UPDATE** em observações → edição e exclusão lógica impossíveis. A migration concede UPDATE apenas nas 3 colunas necessárias (texto, arquivamento, timestamp). Idempotente (`revoke` + `grant` + `drop policy if exists`).

### 15.2 Arquivos alterados/criados

| Arquivo | Mudança |
| --- | --- |
| `src/services/observacoesService.js` | **novo** — `createObservacao`, `listObservacoesDiretor`, `updateObservacao`, `archiveObservacao` |
| `src/App.jsx` | localStorage removido; estados `obsList`/`obsText`/`obsSaving`/`editingId`/`editText`/`showAllObs`; `loadObs` (useEffect em `director`/`regional`); `saveObs`/`saveEdit`/`archiveObs`; sidebar com "Observações do diretor" (3 itens + "Ver todas" + Editar/Excluir) |
| `src/styles.css` | `.obs-list`, `.obs-item`, `.obs-meta`, `.obs-actions`, `.obs-btn`, `.obs-empty`, `.obs-loading` |
| `supabase/migrations/20261013200000_…update_anon.sql` | migration acima |

### 15.3 Regras de CRUD

| Operação | Comportamento |
| --- | --- |
| **Criar** | Valida texto não vazio → `INSERT` com `escopo='diretor'`, `avaliacao_id`, `registro_id`, `regional`, `diretor`, `criado_por=NULL` → aguarda confirmação (`.select().single()`) → limpa campo → mensagem de sucesso → recarrega lista |
| **Listar** | `SELECT` por `diretor` + `regional`, `arquivada_em IS NULL`, ordenado `created_at DESC`; troca de diretor dispara `useEffect` → recarrega |
| **Editar** | `UPDATE` de `observacao` + `updated_at` pelo `id`; não cria novo registro; mensagem "Observação atualizada com sucesso" |
| **Excluir** | Exclusão **lógica**: `UPDATE arquivada_em = now()`; `DELETE` físico bloqueado no RLS; arquivadas somem da lista |

### 15.4 Teste real executado (Gregorio Batista)

Diretor: `Gregorio Batista` · Regional: `PAULO PALMEIRA` · Avaliação: `cdb34a20-cdc6-416f-80f2-f70a2e8cc347` · Registro: `8a33fff4-8ec5-4c83-a411-931db76bb077`.

| Etapa | Resultado | Detalhe |
| --- | --- | --- |
| Criar | ✅ | id `34b4904f-8845-460b-958b-e11a70987719`; `criado_por=NULL`; `arquivada_em=NULL` |
| Listar | ✅ | encontrada na lista (1 item) |
| Editar | ✅ | texto atualizado; `updated_at` preenchido |
| Listar pós-edição | ✅ | texto novo visível |
| Excluir (lógica) | ✅ | `arquivada_em` preenchido; some da lista |
| Listar pós-exclusão | ✅ | não encontrada |
| Persistência (SQL direto) | ✅ | linha presente no banco com texto editado e `arquivada_em` preenchido |

### 15.5 Validações

| Verificação | Resultado |
| --- | --- |
| `npm test` | ✅ **37/37** |
| `npm run build` | ✅ |
| `localStorage` no código | ✅ **0 referências** em `src/` |
| CRUD real (criar/listar/editar/arquivar) | ✅ contra banco real |
| Persistência após "F5" (SQL direto) | ✅ dados no banco |

### 15.6 Regras respeitadas

Sem login/usuário/senha/JWT · sem alteração de gráficos, filtros, upload, dashboard ou histórico · `DELETE` físico bloqueado · migration restrita à tabela de observações · nenhuma outra tabela afetada.

## 18. Último período primeiro na matriz, filtros recolhidos e observação do regional (2026-10-14)

### 18.1 Matriz: só o último período por padrão

- `src/components/PerformanceMatrix.jsx` ganhou o estado `showHistory` (inicial `false`): a tabela renderiza somente `periodCols[periodCols.length - 1]`, ou seja, a **última coluna na ordem cronológica dos dados** produzida por `matrixPeriodColumns` (avaliações da mais antiga para a mais recente + ordem das colunas na planilha). Nenhum mês, trimestre, ano ou índice de coluna fixo no código.
- Com a planilha atual o período exibido é **`SET/3TRI 2026`** (o 16º de 16 períodos).
- As três primeiras colunas continuam congeladas (`Regional`, `Diretor`, `Unidade` — `position: sticky`); a rolagem horizontal acontece apenas dentro de `.mx-scroll`; `Situação atual` e os indicadores finais permanecem sempre visíveis.
- Botão **Ver histórico completo** → exibe os 16 períodos e passa a se chamar **Ocultar histórico**; **Ocultar histórico** volta a mostrar só o último período e zera `scrollLeft` do container. Sem recarregar a página e sem nova consulta (estado local de React; `records`/`avaliacoes` não são refeitos).
- Períodos anteriores preservados: o `select` **Período** do painel de filtros segue com as 17 opções (16 períodos + Todos) mesmo com o histórico oculto; nada foi apagado da base (`avaliacoes_diretores_periodos` = 976 linhas, 61 × 16).

### 18.2 Filtros da matriz recolhidos

- Estado `filtersOpen` inicial `false`: o painel `.mx-filters` **não é renderizado** ao carregar (sem espaço vazio quando fechado).
- Botão no cabeçalho da matriz (`.mx-bar`): **Filtros** → **Ocultar filtros** quando aberto; ao fechar com filtros aplicados o texto vira **Filtros (N)** (ex.: `Filtros (1)`).
- O painel contém os 8 filtros (Regional, Diretor, Unidade, Período, Status trimestral, Nível, Status de gestão, Ciclo de vida) + **Limpar filtros**.
- Ao recolher, somente o painel desaparece: filtro de Regional aplicado (`AISLANE BELO`) manteve as 17 de 61 linhas com o painel fechado.
- Filtros da lateral (Regional/Diretor) e todo o restante da interface permanecem inalterados.

### 18.3 Observação do regional

- Rótulo lateral alterado para **Observação do regional** (CSS aplica caixa alta).
- A observação passa a usar a **regional** como contexto: `escopo: 'regional'`, `regional` preenchido, `diretor: NULL`, `registro_id: NULL` — nunca gravada como observação geral (`geral`) nem individual do diretor (`diretor`).
- Sem regional selecionada ("Todas as regionais"): `textarea` e botão **Salvar observação** ficam desabilitados e aparece a orientação "Selecione uma regional para registrar uma observação."
- Ao trocar de regional, a lista recarrega com as observações daquela regional pela nova função `listObservacoesRegional({regional})` (`.eq('regional', …)` + não arquivadas + `created_at` desc). A função é **adição** em `src/services/observacoesService.js`; `createObservacao`, `listObservacoesDiretor`, `updateObservacao` e `archiveObservacao` não foram tocados.
- Listagem/edição/exclusão continuam iguais (edição por `updateObservacao`, exclusão lógica por `archiveObservacao`), assim como a persistência no banco.

### 18.4 Arquivos alterados

- `src/components/PerformanceMatrix.jsx` — estados `showHistory`/`filtersOpen`, `lastCol`/`shownCols`, botões em `.mx-bar`, `ref` do container de rolagem.
- `src/App.jsx` — rótulo e regras da observação (desabilitar sem regional, orientação, `escopo:'regional'`), lista por regional.
- `src/services/observacoesService.js` — nova função `listObservacoesRegional`.
- `src/styles.css` — `.mx-bar`, `.mx-btn`, `.obs-hint` e estados `:disabled` da lateral.

### 18.5 Validações executadas

| Verificação | Resultado |
| --- | --- |
| Matriz ao carregar | ✅ somente `SET/3TRI 2026` + Situação atual + indicadores (1 coluna de histórico) |
| Ver histórico completo | ✅ 16 períodos; botão vira "Ocultar histórico" |
| Ocultar histórico | ✅ volta a 1 período e `scrollLeft` = 0 (estava 300 antes de ocultar) |
| Colunas congeladas | ✅ Regional/Diretor/Unidade sticky; `overflow-x` da página = 0 |
| Filtros iniciais | ✅ painel ausente no carregar; abrir mostra 8 selects + Limpar filtros |
| Filtro ativo após recolher | ✅ `Filtros (1)` e "17 de 61 registro(s)" mantidos; limpar volta a "Filtros"/"61 de 61" |
| Períodos preservados | ✅ select Período com 17 opções com histórico oculto |
| Observação do regional | ✅ CRUD real na UI: salvar → editar → excluir (mensagens de sucesso em cada etapa) |
| Banco | ✅ `escopo='regional'`, `diretor=NULL`, `registro_id=NULL`; linhas de teste arquivadas (exclusão lógica); 5 linhas no total, nenhuma removida |
| Sem regional | ✅ textarea/botão desabilitados + orientação exibida |
| Lateral Regional/Diretor | ✅ KPIs 60→17 ao escolher `AISLANE BELO` (filtros intactos) |
| Dados históricos | ✅ 976 períodos e 61 registros no banco (nenhuma exclusão) |
| `npm test` | ✅ **43/43** |
| `npm run build` | ✅ |
| Screenshots | ✅ 1920×1080 (matriz recolhida/aberta, filtros abertos, lateral sem/com regional) |

## 19. "Evolução trimestral" apenas para análise individual do diretor (2026-10-14)

### 19.1 Regra de existência do card

- `src/App.jsx`: o memo `evolution` retorna `null` sempre que `director` estiver vazio ("Todos os diretores"). Como o card já era renderizado condicionalmente com `{evolution&&...}`, ele **desaparece do DOM** e "Comparação de desempenho" sobe automaticamente (`.stack` flex) — sem espaço vazio.
- Com diretor selecionado: **uma única série** (`classe: 'sel'`), rótulo = nome do diretor, valores = nível médio (romano) do diretor em cada trimestre consolidado, a partir de `visible` (registros do diretor na regional ativa).
- Os ramos de consolidação foram **removidos do memo**: `Consolidado regional` e `Consolidado geral` (séries, legendas, linhas e valores numéricos) não existem mais neste gráfico. As classes CSS `.line-reg`/`.line-all`/`.val-reg`/`.val-all` permanecem no arquivo, mas nenhum componente as usa mais no LineChart.

### 19.2 Comportamento do desenho (`LineChart`)

- Continua desenhando **somente trimestres consolidados** (`buildQuarterLabelMap` → 6 trimestres hoje; meses continuam no banco/matriz).
- Valores numéricos fixos em cada ponto (1 casa decimal, pt-BR), acima/abaixo alternando quando próximos — comportamento já existente, mantido.
- Trimestre sem informação do diretor permanece `null` (nunca vira 0): a linha é **quebrada** (`segmentsDe` gera 2+ caminhos quando há buraco, sem ligar pontos vizinhos) e aparece um `—` discreto (`.val-missing`, cinza claro na base) com tooltip "…: sem informação".
- Subtítulo alterado para **"Evolução do nível do diretor nos trimestres avaliados."**; título permanece **"Evolução trimestral"**.
- Troca de diretor recalcula o memo (deps `[model, director, visible, allRecords]`) → atualização imediata, sem dados do diretor anterior; voltar para "Todos os diretores" remove o card.

### 19.3 Arquivos alterados

- `src/App.jsx` — memo `evolution` restrito a diretor (sem consolidados) + subtítulo do card.
- `src/components/Charts.jsx` — marcador discreto de ausência (`val-missing`) no `LineChart`.
- `src/styles.css` — regra `.val-missing`.

### 19.4 Validações (CDP, 1920×1080, planilha real)

| Cenário | Resultado |
| --- | --- |
| Todas as regionais + Todos os diretores | ✅ card ausente; ordem: Indicadores → Comparação de desempenho → Matriz |
| Regional `AISLANE BELO` + Todos os diretores | ✅ card ausente |
| Regional + diretor `Adria Leitão Maia` | ✅ card presente; 1 linha; legenda só com o nome do diretor; 1 valor (`2,0`) + 5 `—`; sem "Consolidado regional"/"Consolidado geral" |
| Troca para `Ana Tereza Marques` | ✅ atualiza na hora: 4 valores (`2,0 3,0 1,0 1,0`), 2 caminhos (linha quebrada no trimestre ausente), 2 `—` |
| Varredura de 8 diretores | ✅ todos com legenda própria, valores fixos e ausências discretas (1 a 5 `—`) |
| Voltar para "Todos os diretores" (regional ainda filtrada) | ✅ card removido; Comparação sobe |
| Todas as regionais + Todos os diretores (final) | ✅ card ausente |
| `npm test` | ✅ **43/43** |
| `npm run build` | ✅ |

## 20. Bloco Indicadores: título dinâmico e alternância "último período × consolidado" (2026-10-14)

### 20.1 Referência dinâmica (sem mês/ano fixo)

- `src/App.jsx`: constante `MESES_NOME` (JAN…DEZ → janeiro…dezembro) e memos `refLabel`/`refNome`.
- `refLabel` = **última coluna** de `matrixPeriodColumns(allRecords, model.avaliacoes)` — mesma fonte e ordem cronológica da matriz (hoje `SET/3TRI 2026` → base do título).
- `refNome` deriva o título com regex sobre o rótulo: mês abreviado (`\b(JAN|FEV|...|DEZ)\b`) + ano `(20\d{2})` → **"Setembro de 2026"** (primeira letra maiúscula). Se não houver mês/ano no rótulo, exibe o rótulo cru — **nunca inventa mês**.
- **Futuras avaliações**: nova avaliação publicada com período mais recente passa a ser a última coluna → título se atualiza sozinho (ex.: "Indicadores de Dezembro de 2026"); nada de código a alterar.

### 20.2 Modalidades e cálculo

- Estado `indConsolidado` (inicial `false`), **independente dos filtros** — trocar Regional/Diretor não reseta a modalidade.
- `latestAvaliacaoId` = id da última avaliação; `visibleLatest` = `visible` filtrado por essa avaliação (último período real, sem simular histórico).
- **Último período** (padrão): médias de `visibleLatest` por indicador; **sem** linha "Geral:".
- **Consolidado**: médias de `visible` (cálculo consolidado já existente, inalterado); cada card ganha `<small>Consolidado: {valor de allRecords}</small>` (substitui o antigo "Geral:").
- Ausência de dado exibe **"Não informado"** — nunca `0` (função `txt` no map dos cards).
- Título/subtítulo: `Indicadores de {refNome}` + "Resultados da referência mais recente da avaliação." ⇄ `Indicadores consolidados` + "Resultados consolidados das avaliações disponíveis."
- Botão no canto direito do cabeçalho (`.ind-head`, reutiliza `.mx-btn`): **"Ver consolidado"** ⇄ **"Ver último período"**.

### 20.3 Arquivos alterados

- `src/App.jsx` — import de `matrixPeriodColumns`, `MESES_NOME`, memos `refLabel`/`refNome`/`visibleLatest`, estado `indConsolidado`, novo JSX do card (wrapper `.ind-head`).
- `src/styles.css` — `.ind-head` (flex, espaço entre título e botão) e `.ind-head p`.

### 20.4 Validações (CDP, planilha real)

| Cenário | Resultado |
| --- | --- |
| Abertura padrão (sem filtro) | ✅ título "Indicadores de Setembro de 2026"; subtítulo "Resultados da referência mais recente da avaliação."; botão "Ver consolidado"; sem "Geral:"; 9 métricas (3,39 / 3,40 / 2,73 / 2,99 / -12,4% / 16,6% / 13,8% / 3,85 / 11,4%) |
| Clicar "Ver consolidado" | ✅ título "Indicadores consolidados"; subtítulo "Resultados consolidados das avaliações disponíveis."; cada item com "Consolidado: X"; botão vira "Ver último período" |
| Regional `AISLANE BELO` mantendo consolidado | ✅ modalidade preservada; valores da regional (ex.: EBITDA -20,3%) e "Consolidado:" com a média geral (11,4%) |
| "Ver último período" com filtro ativo | ✅ volta ao título do mês mantendo o filtro (valores da regional) |
| Varredura de 10 diretores | ✅ modalidade "último período" mantida em todos; "Não informado" aparece onde falta dado (Adria: 1, Carlos: 1, Claudia: 3); nenhum zero inventado |
| Celular 390px | ✅ 1 coluna, título/botão empilhados, `overflow-x` = 0 |
| 1366×768 e 1920×1080 | ✅ 4 e 7 colunas, `overflow-x` = 0 |
| `npm test` | ✅ **43/43** |
| `npm run build` | ✅ `✓ built in 733ms` |

## 21. Observações do regional: vínculo exclusivo com o diretor selecionado (2026-10-14)

Correção da regra de vínculo, salvamento e exibição das observações do regional. **Títulos preservados**: "OBSERVAÇÃO DO REGIONAL" e "OBSERVAÇÕES DO REGIONAL".

### 21.1 Problema

Na fase anterior (seção 18.3) a observação era gravada com `escopo='regional'`, `diretor=NULL` e `registro_id=NULL`, e a lista consultava **somente pela regional** (`listObservacoesRegional`). Assim, qualquer observação registrada aparecia para **todos** os diretores daquela regional — ex.: a observação feita para **Hesdras Viana** aparecia para **Gregorio Batista** e **Cilene Andrade**.

### 21.2 Regra aplicada

**A observação é registrada pelo regional, mas vinculada exclusivamente ao diretor selecionado dentro da avaliação correspondente. A observação somente será exibida quando o mesmo diretor estiver selecionado.**

- **Vinculação**: `resolveObservacaoVinculo` localiza o registro do par regional+diretor na **avaliação mais recente** em que ele existe → grava `avaliacao_id`, `registro_id`, `escopo='diretor'`, `regional`, `diretor` (autoridade `NULL`; nunca inventada). Sem regional/diretor não há gravação.
- **Consulta**: prioridade `registro_id` → `avaliacao_id` → `escopo='diretor'` → `arquivada_em IS NULL`; regional e diretor confirmam a seleção. `listObservacoesRegional` foi **removida** (nada consulta só pela regional). Guarda extra no cliente: `observacaoVisivel`.
- **Interface**: campo/botão/lista exigem regional+diretor; sem regional → "Selecione uma regional e um diretor para registrar ou consultar observações."; regional sem diretor → "Selecione um diretor para registrar ou consultar observações." (campo e **Salvar** desabilitados, lista oculta). Cartão com diretor, regional, avaliação ("3º tri/2026"), data/horário, texto, Editar e Excluir; 3 mais recentes + "Ver todas"; mensagens com ponto final ("Observação salva com sucesso." etc.).
- **Correção extra encontrada no teste real**: a troca rápida de diretor podia deixar a resposta atrasada de uma consulta sobrescrever a lista (cartão vazio do diretor errado). `loadObs` agora usa um **token de requisição** (`obsReqRef`) que descarta respostas antigas; a lista também é limpa na troca (nenhum cartão do diretor anterior fica na tela).

### 21.3 Banco e migrations

- **Nenhuma migration**: a estrutura (`avaliacao_id`, `registro_id`, `escopo` com CHECK `geral|regional|diretor`, `regional`, `diretor`, `arquivada_em`) e as políticas (`SELECT`/`INSERT` para `anon`; `UPDATE` de `observacao`/`arquivada_em`/`updated_at`; **`DELETE` sem política**) já existiam e atendem à regra.
- **Linhas legadas sem diretor — RESOLVIDO (autorização do usuário)**: as 2 observações antigas com `escopo='regional'` e `diretor=NULL` (AISLANE BELO, arquivadas, textos de teste) **foram removidas do banco via MCP** por serem resíduo de teste impossível de atribuir a um diretor. **Toda** observação restante tem `escopo='diretor'` com `registro_id` + `regional` + `diretor` preenchidos (3 linhas: Gleison ativa; Francioly e Gregorio arquivadas).
- Linhas com `escopo='diretor'` e vínculo completo já existentes continuam funcionando (ex.: observação real de **Gleison de Albuquerque**, exibida somente para ele).

### 21.4 Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `src/services/observacoesService.js` | `createObservacao` exige regional/diretor e força `escopo='diretor'`; `listObservacoesDiretor({registroId, avaliacaoId, diretor, regional})` com filtros priorizados; removida `listObservacoesRegional`; helpers puros `validarObservacao`, `resolveObservacaoVinculo`, `observacaoFiltros`, `observacaoVisivel`, `formatarDataHora` |
| `src/App.jsx` | formulário/lista condicionados a regional+diretor; vínculo no salvamento; token anti-resposta-atrasada; cartões com diretor/regional/avaliação/data; guardas de duplo clique; mensagens |
| `src/styles.css` | `.obs-meta` com `flex-wrap` |
| `tests/unit/observacoesVinculo.test.mjs` | **novo** — 12 testes (vínculo por diretor, filtros, visibilidade, validação, data/horário) |

### 21.5 Validações

| Verificação | Resultado |
| --- | --- |
| `npm test` | ✅ **66/66** (54 anteriores + 12 novos) |
| `npm run test:integration` | ✅ **11/11** (inclui `DELETE` físico negado para `anon`) |
| `npm run build` | ✅ |
| Teste real via CDP (Chrome headless + app real + banco real) | ✅ **38/38 verificações**, 0 erros de console |
| Hesdras cria observação | ✅ salva com `escopo='diretor'`, `registro_id=60a962a6…` (registro do Hesdras), `avaliacao_id=cdb34a20…`, `criado_por=NULL`; cartão com diretor/regional/3º tri/2026/data |
| Gregorio/Cilene selecionados | ✅ a observação de Hesdras **não aparece** ("Nenhuma observação registrada.") |
| Voltar para Hesdras | ✅ cartão reaparece |
| Editar (texto → "Texto editado no teste CRUD.") | ✅ "Observação atualizada com sucesso."; cartão continua do Hesdras; SQL confirma vínculo intacto |
| Gregorio após edição | ✅ não vê o texto editado |
| Excluir | ✅ "Observação excluída com sucesso."; cartão some; SQL confirma `arquivada_em` preenchido |
| Observações legadas `escopo='regional'` (AISLANE BELO) | ✅ não aparecem como individuais; **removidas em seguida** (resíduo de teste sem diretor, autorizado pelo usuário) |
| Sem regional / regional sem diretor | ✅ campo+botão desabilitados, lista oculta e mensagens exatas |
| Resíduo do teste | ✅ linha de teste arquivada e removida; dados reais intocados |
