# Modelo de Dados — Avaliação de Diretores (Supabase)

Este documento explica as tabelas, relacionamentos, regra de histórico, Storage e segurança do módulo, conforme implementado na migration `supabase/migrations/20261013120000_avaliacoes_diretores_inicial.sql`.

Projeto: `tmawxagholhwxfekqvkm` · Schema: `public` (tabelas) + `storage` (bucket).

---

## 1. Visão geral

```
storage.buckets (avaliacoes-diretores-planilhas)   <- arquivo XLSX/XLS de cada importação
            |
            |  1 arquivo  <-->  1 linha
            v
avaliacoes_diretores  (1 por upload, nunca substituída)
   | 1
   |---- N --> avaliacoes_diretores_registros    (1 por linha da Planilha1)
   |                | 1
   |                |---- N --> avaliacoes_diretores_periodos     (períodos/estágios)
   |                | 1
   |                |---- N --> avaliacoes_diretores_indicadores  (indicadores variáveis)
   |
   |---- N --> avaliacoes_diretores_observacoes  (escopo geral/regional/diretor)
                    registro_id opcional (NULL = observação geral da avaliação)
```

Princípio reitor: **cada upload gera uma avaliação nova**. Nada é atualizado nem apagado para "consertar" dados antigos — o passado é preservado como fotografia.

---

## 2. Tabelas

### 2.1 `avaliacoes_diretores` — uma linha por importação

| Coluna | Tipo | Obrigatória | Observação |
| --- | --- | --- | --- |
| `id` | uuid PK | ✅ | `gen_random_uuid()` |
| `titulo` | text | ✅ | identificação exibida da avaliação |
| `trimestre` | smallint | ✅ | CHECK `1..4` |
| `ano` | smallint | ✅ | ano de referência |
| `status` | text | ✅ | CHECK: `processando`, `publicada`, `arquivada`, `erro` (default `processando`) |
| `arquivo_nome_original` | text | — | nome do arquivo como veio do usuário |
| `storage_bucket` | text | ✅ | default `avaliacoes-diretores-planilhas` |
| `storage_path` | text | — | caminho completo do objeto no bucket |
| `arquivo_hash` | text | — | hash do conteúdo, usado contra duplicidade |
| `total_registros` | integer | — | linhas importadas |
| `total_colunas` | integer | — | colunas detectadas na origem |
| `importado_por` | uuid → `auth.users(id)` | — | default `auth.uid()`; `ON DELETE SET NULL` |
| `importado_em` | timestamptz | ✅ | default `now()` |
| `publicado_em` | timestamptz | — | preenchido quando sai de `processando` |
| `erro_detalhe` | text | — | *(fase 2)* descreve o estágio em que a importação falhou quando `status = 'erro'` |
| `created_at` / `updated_at` | timestamptz | ✅ | `updated_at` gerenciado por trigger |

Regras:

- **Nunca substituir**: não existe política de DELETE; UPDATE só existe no fluxo de importação (fase 2): linhas `processando` podem mudar apenas as colunas do fluxo (`storage_*`, `arquivo_nome_original`, `total_*`, `status`, `publicado_em`, `erro_detalhe`) e apenas para `publicada`/`erro`. Avaliações publicadas são imutáveis.
- **Anti-duplicação por hash**: índice único parcial `uq_avaliacoes_diretores_hash_periodo (ano, trimestre, arquivo_hash) WHERE arquivo_hash IS NOT NULL AND status <> 'erro'` — o mesmo arquivo não pode ser reimportado no mesmo ano/trimestre; em outros períodos é permitido; tentativas falhas (`erro`) não bloqueiam o reenvio.
- **Caminho único**: `uq_avaliacoes_diretores_storage_path (storage_path)` — nenhum objeto é sobrescrito.

### 2.2 `avaliacoes_diretores_registros` — entidade Diretor + Unidade (reutilizável)

| Coluna | Tipo | Obrigatória | Observação |
| --- | --- | --- | --- |
| `id` | uuid PK | ✅ | **imutável** (trigger) |
| `avaliacao_id` | uuid FK → `avaliacoes_diretores` | ✅ | `ON DELETE RESTRICT` — **atribuição da importação de CRIAÇÃO, imutável** (trigger); nas importações seguintes o registro é reutilizado, nunca re-vinculado |
| `codigo_regional` | text | — | situação atual — atualizável pela planilha (valor presente e diferente) |
| `regional` | text | — | situação atual — atualizável pela planilha |
| `diretor` | text | ✅ | **parte da identidade — imutável** (trigger) |
| `unidade` | text | — | **parte da identidade — imutável** (trigger) |
| `status_gestao` | text | — | situação atual — atualizável pela planilha |
| `ciclo_vida` | text | — | situação atual — atualizável pela planilha |
| `nivel_atual` | text | — | situação atual — atualizável pela planilha |
| `numero_linha_origem` | integer | — | linha da planilha de CRIAÇÃO (rastro de auditoria) |
| `dados_originais` | jsonb | ✅ | default `{}` — linha original completa (criação) |
| `arquivado_em` | timestamptz | — | **novo (2026-10-20)**: preenchido = registro fora dos dashboards; `NULL` = ativo (reativação). Arquivamento lógico — **nunca DELETE** |
| `created_at` | timestamptz | ✅ | **imutável** (trigger) |

**Regra de identidade (definitiva — Documentação §21):** o registro é uma **ENTIDADE** identificada por **(Diretor + Unidade) normalizados** e **reutilizado entre importações** — não é mais uma “fotografia” por importação. A planilha reutiliza a dupla ativa, reativa a dupla arquivada presente, arquiva a dupla ativa ausente e só cria registro novo quando a dupla não existe; a linha sem diretor ou sem unidade é ignorada. Mudanças de regional/status/ciclo/nível só alteram a **situação atual** (valor presente e diferente) e nunca a identidade. `dados_originais` guarda a linha da criação para auditoria/reprocessamento sem depender da planilha original.

### 2.3 `avaliacoes_diretores_periodos` — quantidade variável

| Coluna | Tipo | Obrigatória | Observação |
| --- | --- | --- | --- |
| `id` | uuid PK | ✅ | |
| `registro_id` | uuid FK → `registros` | ✅ | `ON DELETE RESTRICT` |
| `rotulo_periodo` | text | ✅ | ex.: "2024 T1", nome do par de colunas |
| `ordem` | integer | — | posição horizontal na planilha |
| `estagio` | text | — | valor da coluna de estágio |
| `nivel` | text | — | valor da coluna `NÍVEL` daquele período |
| `created_at` | timestamptz | ✅ | |

A Planilha1 cresce horizontalmente (pares período/estágio + `NÍVEL`). Como os períodos são **linhas**, a tabela absorve qualquer quantidade de períodos **sem mudança de schema** — é só inserir mais períodos.

**Escrita incremental (regra definitiva — Documentação §21):** a planilha **insere** períodos novos (ordem cronológica) e **atualiza** apenas `ordem` (reposição), `estagio`/`nivel` **quando vazios** (completar — marcadores contam como vazio). A migration `20261020150000` concede `grant update (ordem, estagio, nivel)` + política UPDATE provisória e a trigger `trg_..._bloqueia_sobreescrita` impede sobrescrita de valor preenchido e mudança de `rotulo_periodo`/`registro_id`.

Índices: `registro_id` e `(registro_id, ordem)`.

### 2.4 `avaliacoes_diretores_indicadores` — indicadores não fixos (EAV)

| Coluna | Tipo | Obrigatória | Observação |
| --- | --- | --- | --- |
| `id` | uuid PK | ✅ | |
| `registro_id` | uuid FK → `registros` | ✅ | `ON DELETE RESTRICT` |
| `nome_indicador` | text | ✅ | nome dinâmico detectado na planilha |
| `valor_numerico` | numeric | — | quando o valor é numérico |
| `valor_texto` | text | — | quando o valor é texto |
| `unidade_medida` | text | — | ex.: `%`, pontos |
| `ordem` | integer | — | ordem de leitura na planilha |
| `created_at` | timestamptz | ✅ | |

Indicadores **não** viram colunas do banco. Novos indicadores no arquivo futuro = novas linhas, sem `ALTER TABLE`. Índices: `registro_id`, `(registro_id, ordem)` e `nome_indicador` (permite localizar um indicador em todas as avaliações).

Convenção de preenchimento: usar `valor_numerico` quando o valor for numérico e `valor_texto` no contrário (ambos anuláveis; nenhum dado é forçado).

**Escrita incremental (regra definitiva — Documentação §21):** na reimportação, os valores do registro reutilizado são **atualizados** (`grant update (valor_numerico, valor_texto)` + política UPDATE provisória da migration `20261020150000`) — **exceto** quando existe ajuste manual ativo (tabela `avaliacoes_diretores_indicadores_ajustes`, prioridade inalterada). `nome_indicador` e `registro_id` nunca mudam; linha com ajuste divergente vira **divergência mantida** na prévia.

### 2.5 `avaliacoes_diretores_observacoes` — autoria e histórico

| Coluna | Tipo | Obrigatória | Observação |
| --- | --- | --- | --- |
| `id` | uuid PK | ✅ | |
| `avaliacao_id` | uuid FK → `avaliacoes_diretores` | ✅ | `ON DELETE RESTRICT` |
| `registro_id` | uuid FK → `registros` | — | `NULL` = observação geral |
| `escopo` | text | ✅ | CHECK: `geral`, `regional`, `diretor` |
| `regional` | text | — | preenchido quando `escopo = regional` |
| `diretor` | text | — | preenchido quando `escopo = diretor` |
| `observacao` | text | ✅ | conteúdo |
| `criado_por` | uuid → `auth.users(id)` | — | default `auth.uid()` |
| `atualizado_por` | uuid → `auth.users(id)` | — | preenchido pelo frontend |
| `created_at` / `updated_at` | timestamptz | ✅ | `updated_at` via trigger |
| `arquivada_em` | timestamptz | — | mecanismo de "remover" sem apagar |

- **Nunca são excluídas pelo frontend** (não existe política DELETE). O "arquivamento" usa `arquivada_em`, preservando conteúdo, autoria e histórico.
- Somente o **autor** pode atualizar (política `using`/`with check` = `(select auth.uid())`).
- Índices: `avaliacao_id`, `registro_id`, `regional`, `diretor`, `criado_por`, `atualizado_por`, `escopo`.

---

## 3. Relacionamentos e integridade

| De | Para | Ação no DELETE |
| --- | --- | --- |
| `registros.avaliacao_id` | `avaliacoes_diretores` | `RESTRICT` |
| `periodos.registro_id` | `registros` | `RESTRICT` |
| `indicadores.registro_id` | `registros` | `RESTRICT` |
| `observacoes.avaliacao_id` | `avaliacoes_diretores` | `RESTRICT` |
| `observacoes.registro_id` | `registros` | `RESTRICT` |
| `avaliacoes.importado_por` | `auth.users` | `SET NULL` |
| `observacoes.criado_por` / `atualizado_por` | `auth.users` | `SET NULL` |

`RESTRICT` nas linhas do módulo significa: não é possível apagar uma avaliação que tenha registros/observações — proteção extra contra perda de histórico, mesmo por conta de outros acessos ao banco. O `SET NULL` nos vínculos com `auth.users` evita que a exclusão de um usuário pelo sistema de autenticação apague dados do módulo (a autoria vira `NULL`, o texto permanece).

Constraints CHECK adicionais: `trimestre 1..4`, domínio de `status`, domínio de `escopo`.

---

## 4. Storage

| Item | Definição |
| --- | --- |
| Bucket | `avaliacoes-diretores-planilhas` (privado, `public = false`) |
| Limite | 15 MB por arquivo (`file_size_limit = 15728640`) |
| Tipos aceitos | XLSX e XLS (MIME do OpenXML e `application/vnd.ms-excel`) |
| Caminho convenção | `avaliacoes/{ano}/{trimestre}/{avaliacao_id}/{timestamp}-{nome-seguro}.xlsx` |
| Acesso | só `authenticated`; sem URL pública (usar URL assinada para leitura) |

Boas práticas da etapa de upload:

1. Enviar **sempre** pela API do Storage (`supabase.storage.from(...).upload(...)`) — nunca por `insert/update/delete` direto em `storage.objects`.
2. Gerar o caminho com `timestamp` + nome sanitizado para que cada arquivo seja único (combinado com o índice único de `storage_path`).
3. Enviar `contentType` explícito derivado da extensão; o bucket rejeita outros MIMEs.
4. Calcular o hash do arquivo no cliente antes do upload e usar em `arquivo_hash`.
5. Nunca usar `upsert: true` (não há política de UPDATE → será negado de propósito).
6. Cadastrar a avaliação **depois** (ou na mesma transação lógica) do upload, com `storage_path` preenchido.

---

## 5. Segurança

### 5.1 Princípios

- **Sem login próprio**: a autenticação vem do sistema maior. O papel usado é `authenticated` + `auth.uid()`.
- **`service_role` nunca no frontend**: usado apenas em backend/auditoria, se um dia for necessário.
- **`anon` (fase 2, PROVISÓRIO)**: acesso restrito aos recursos do módulo para o protótipo funcionar sem login — select/insert nas 5 tabelas, update de fluxo em `avaliacoes_diretores` e **update por coluna** em registros/periodos/indicadores (importação incremental — Documentação §21) e upload/leitura no bucket do módulo. As políticas têm sufixo `_anon_provisorio` e **devem ser removidas** na integração com o sistema maior.
- **RLS habilitado** nas 5 tabelas (e já estava habilitado em `storage.objects`).

### 5.2 Matriz de políticas

| Tabela / recurso | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `avaliacoes_diretores` | ✅ authenticated | ✅ authenticated | ✅ anon (provisório): só `processando` → `publicada`/`erro`, colunas do fluxo | ❌ |
| `avaliacoes_diretores_registros` | ✅ authenticated | ✅ authenticated | ✅ anon (provisório, `20261020150000`): só `codigo_regional, regional, status_gestao, ciclo_vida, nivel_atual, arquivado_em` (situação + arquivar/reativar); identidade/`avaliacao_id` bloqueados por trigger | ❌ |
| `avaliacoes_diretores_periodos` | ✅ authenticated | ✅ authenticated | ✅ anon (provisório, `20261020150000`): só `ordem, estagio, nivel` (reposição + completar campo vazio); sobreescrita/`rotulo_periodo`/`registro_id` bloqueados por trigger | ❌ |
| `avaliacoes_diretores_indicadores` | ✅ authenticated | ✅ authenticated | ✅ anon (provisório, `20261020150000`): só `valor_numerico, valor_texto` (valores importados; ajuste manual continua em tabela própria) | ❌ |
| `avaliacoes_diretores_observacoes` | ✅ authenticated | ✅ authenticated (`criado_por` = eu) | ✅ somente autor | ❌ |
| `storage.objects` (bucket do módulo) | ✅ authenticated | ✅ authenticated | ❌ | ❌ |
| `anon` (provisório, só recursos do módulo) | ✅ 5 tabelas + bucket | ✅ 5 tabelas + bucket | ✅ avaliação em `processando` (colunas do fluxo) + registros/periodos/indicadores nas colunas concedidas acima | ❌ |

- Privilégios de UPDATE são **por coluna** (`grant update (colunas...)`); sem o privilégio, a política RLS não basta.
- **Triggers de invariantes** (migration `20261020150000`, Documentação §21): `avaliacoes_diretores_periodos_bloqueia_sobreescrita` (só completa `estagio`/`nivel` vazios; `rotulo_periodo`/`registro_id` imutáveis) e `avaliacoes_diretores_registros_bloqueia_identidade` (`id`, `avaliacao_id`, `diretor`, `unidade`, `created_at` imutáveis).
- Todas as políticas: `drop policy if exists` + `create policy`, nomeadas com prefixo `avaliacoes_...`, documentadas com `comment on policy`.
- `auth.uid()` sempre como `(select auth.uid())` (evita reavaliação por linha / alerta do linter).
- Função de trigger com `search_path` imobilizado.

### 5.3 Evolução para papéis administrativos

As políticas atuais são o ponto de partida. Quando o sistema maior entregar perfis, basta acrescentar a condição de papel nas expressões, por exemplo:

```sql
-- exemplo futuro (não aplicado)
using (
  bucket_id = 'avaliacoes-diretores-planilhas'
  and (auth.jwt() ->> 'papel') in ('admin', 'gestor')
);
```

ou trocar `to authenticated` por um papel dedicado do sistema principal. Como cada política é nomeada e isolada, a substituição é local e não afeta as demais.

### 5.4 Lacunas conhecidas (para decidir na próxima etapa)

1. **Mudança de `status`** da avaliação — **RESOLVIDO na fase 2** com política de UPDATE restrita (colunas do fluxo, apenas linhas `processando` → `publicada`/`erro`) + `grant update` colunar para `anon` provisório.
2. **Validação por extensão** de arquivo (hoje só MIME) pode ser reforçada com trigger/Edge Function.
3. **Contagem/gravação em lote**: a importação fará muitos `INSERT`s; se volume crescer, considerar RPC/Edge Function mais eficiente (sem mudar RLS).

---

## 6. Consultas típicas (referência)

```sql
-- listar avaliações
select id, titulo, ano, trimestre, status, total_registros, importado_em
from avaliacoes_diretores
order by importado_em desc;

-- visão por regional de uma avaliação
select regional, count(*) as diretores
from avaliacoes_diretores_registros
where avaliacao_id = :avaliacao_id
group by regional
order by regional;

-- períodos de um registro (ordem horizontal)
select rotulo_periodo, ordem, estagio, nivel
from avaliacoes_diretores_periodos
where registro_id = :registro_id
order by ordem;

-- indicadores de um registro
select nome_indicador, valor_numerico, valor_texto, unidade_medida, ordem
from avaliacoes_diretores_indicadores
where registro_id = :registro_id
order by ordem;

-- observações individuais do diretor selecionado (só escopo 'diretor';
-- não arquivadas; registro_id e avaliacao_id filtram quando disponíveis)
select id, avaliacao_id, registro_id, escopo, regional, diretor, observacao,
       criado_por, atualizado_por, arquivada_em
from avaliacoes_diretores_observacoes
where escopo = 'diretor'
  and arquivada_em is null
  and diretor = :diretor
  and regional = :regional
  and avaliacao_id = :avaliacao_id
  and registro_id = :registro_id   -- opcional; omitir quando não houver
order by created_at desc;
```

### 6.1 Leitura dos dashboards (fase 3)

A camada `src/services/dashboardService.js` consulta **somente** avaliações `status = 'publicada'`, em lotes/paginação (sem uma requisição por registro):

```sql
-- cabeçalhos das avaliações publicadas (ordenadas para a linha do tempo)
select id, titulo, ano, trimestre, arquivo_nome_original, storage_path,
       total_registros, publicado_em, importado_em
from avaliacoes_diretores
where status = 'publicada'
order by ano, trimestre, importado_em;

-- linhas por lote de avaliações (página de 500)
select id, avaliacao_id, codigo_regional, regional, diretor, unidade,
       status_gestao, ciclo_vida, nivel_atual, numero_linha_origem
from avaliacoes_diretores_registros
where avaliacao_id in (:lote_de_ids)
order by avaliacao_id, numero_linha_origem;

-- períodos e indicadores por lote de registro_id (~100 por requisição)
select registro_id, rotulo_periodo, ordem, estagio, nivel
from avaliacoes_diretores_periodos
where registro_id in (:lote_de_registro_ids)
order by registro_id, ordem;

select registro_id, nome_indicador, valor_numerico, valor_texto, unidade_medida, ordem
from avaliacoes_diretores_indicadores
where registro_id in (:lote_de_registro_ids)
order by registro_id, ordem;
```

Notas:

- `dados_originais` **não** é baixado na leitura (jsonb pesado; os indicadores vêm da tabela EAV e os níveis da tabela de períodos).
- As políticas `*_anon_provisorio` de SELECT permitem essa leitura no protótipo; na integração serão substituídas por políticas de usuário autenticado.
- `avaliacoes_diretores_observacoes` é lida pelo CRUD da lateral (observação do regional) com `observacoesService.js`: sempre pelo **diretor selecionado** (`escopo='diretor'`, `arquivada_em is null`, mais `regional` e — quando disponíveis — `avaliacao_id`/`registro_id`); nunca consulta só pela regional.
