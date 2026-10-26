# Documentação — Módulo Avaliação de Diretores

Data: 2026-10-13 · Projeto Supabase: `tmawxagholhwxfekqvkm`
Status: protótipo funcional de importação de planilha com persistência real no Supabase, **sem login próprio** (acesso `anon` provisório, restrito ao módulo).

---

## 1. O que o módulo faz

O protótipo React + Vite permite importar a planilha de avaliação de diretores (XLSX/XLS), visualizar os dados em dashboards e **persistir cada importação no Supabase** como uma "avaliação" imutável:

1. O usuário escolhe o arquivo e o frontend valida localmente (extensão `.xlsx`/`.xls`, tamanho ≤ 15 MB).
2. A aba **Planilha1** é lida com `xlsx`; cabeçalhos são identificados **por nome** e os pares `período + NÍVEL` são detectados **dinamicamente** (a planilha cresce na horizontal).
3. Uma **prévia completa** é exibida: linhas, colunas, períodos, regionais/diretores/unidades, campos ausentes, duplicidades e linhas sem diretor.
4. O usuário informa título, trimestre e ano (com inferência automática pelo nome do arquivo/data).
5. O fluxo de importação executa: `Validando → Enviando arquivo → Salvando dados → Concluído`, com bloqueio de duplo clique e marcação de falha em cada estágio.
6. Nada é apagado nem substituído: cada importação cria uma nova avaliação; hashes duplicados no mesmo ano/trimestre são bloqueados (tentativas `erro` permitem reenvio).

---

## 2. Arquitetura (frontend)

> **Migração para TypeScript concluída (2026-10-26).** Todo o código de `src/`
> é `.ts`/`.tsx` (zero `.js`/`.jsx`); `npm run typecheck` (`tsc --noEmit`)
> passa com 0 erros; `npm run build` gera bundle byte-idêntico ao pré-migração
> (anotações de tipo são erasadas; casts `as` não têm efeito de runtime).
> Estrutura final (pastas `app/`, `features/`, `lib/`, `styles/`):

```
src/
  main.tsx                          # entry (raiz — path do Vite)
  vite-env.d.ts                     # ImportMetaEnv (VITE_SUPABASE_*)
  app/App.tsx                       # raiz da aplicação
  components/                       # UI compartilhada
    ConfirmModal.tsx
    ErrorBoundary.tsx
  features/
    dashboard/                      # Charts, EditorPeriodo, StatusTimeline (órfão)
    importacao/                     # ImportDialog
    indicadores/                    # IndicadoresPainel
    matriz/                         # PerformanceMatrix, PeriodosManuais
    pareceres/                      # Pareceres
  lib/dataParser.ts                 # parser da planilha (XLSX)
  services/                         # camada de dados (15 services .ts)
  styles/styles.css                 # CSS puro
  types/                            # contratos de dados (supabase, modelo, planilha…)
```

| Camada | Arquivo | Papel |
| --- | --- | --- |
| Cliente Supabase | `src/services/supabaseClient.ts` | Lê `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`; cria o cliente **uma vez**, sem persistir sessão |
| Validação de arquivo | `src/services/fileValidator.ts` | Extensão, tamanho (15 MB), mensagens de erro |
| Hash | `src/services/hashService.ts` | SHA-256 do arquivo via `crypto.subtle` (Web Crypto) |
| Storage | `src/services/storageService.ts` | Convenção de caminho, nome seguro, content-type e upload sem sobrescrita |
| Persistência | `src/services/avaliacoesService.ts` | Avaliação, registros, períodos, indicadores (lotes de 500) e checagem de duplicidade por hash |
| Orquestração | `src/services/importService.ts` | Fluxo completo, estágios, `ImportError` com estágio/código |
| Leitura dos dashboards | `src/services/dashboardService.ts` | Carrega **somente** avaliações `publicada` (avaliações + registros + períodos + indicadores, em lotes/paginação — sem N+1) e monta o modelo de comparação |
| Parser/análise | `src/lib/dataParser.ts` | `analyzeWorkbookBuffer` (prévia), `analysisToDataset` e os matchers de indicadores compartilhados com o dashboard |
| UI | `src/features/importacao/ImportDialog.tsx` | Prévia, metadados, progresso, sucesso/erro |
| Upload | `src/app/App.tsx` | `upload()` → análise → diálogo → `runImport`; dashboards alimentados pelo Supabase |

Regras de manutenção TypeScript:

- Imports de serviços usam extensão `.js` que resolve para `.ts` (convenção do projeto); imports de componentes usam `.tsx` explícito.
- `tsconfig.json`: `strict:false`, `allowJs:true`, `checkJs:false`, `noEmit:true`, `allowImportingTsExtensions:true`.
- Nenhum `any` sem justificativa documentada; casts `as`/`as unknown as` com comentário são o padrão aceito (interop CJS/ESM de `exceljs`/`jspdf-autotable`, `doc.internal.getNumberOfPages`, weak-type detection em `janelaDeAnos`).
- Preservar comportamento legado bugado quando existir (ex.: `importPlan` lê `ind.nome` mas o parser grava `name` — cast documentado, lógica intacta).

Observações importantes:

- A RLS pode bloquear sem devolver erro HTTP em UPDATE (PostgREST retorna 0 linhas); por isso `avaliacoesService` **confirma a representação retornada** e falha explicitamente se 0 linhas forem afetadas.
- O mesmo vale para o Storage: a exclusão negada pela RLS não gera erro na API — por isso o teste de integração confirma que o objeto **ainda existe** após a tentativa de remoção.

---

## 3. Configuração

```bash
cp .env.example .env   # preencha com o projeto real
npm install
npm run dev
```

Variáveis (o `.env` está no `.gitignore`):

| Variável | Conteúdo |
| --- | --- |
| `VITE_SUPABASE_URL` | URL do projeto (`https://<ref>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Chave **publicável** (anon/publishable). **Nunca** `service_role` |

Sem essas variáveis, o app continua funcionando em modo local (dados de exemplo), mas a importação falhará com erro de configuração.

---

## 4. Fluxo de importação (o que acontece no banco)

1. **Validação local**: extensão/tamanho e leitura da Planilha1.
2. **Hash SHA-256** do arquivo; consulta de avaliações existentes com o mesmo hash.
3. Se já existir `publicada`/`processando` com o mesmo hash no mesmo ano/trimestre → `DUPLICATE_HASH` (nada é gravado).
4. `INSERT` em `avaliacoes_diretores` com `status = 'processando'`.
5. Upload do arquivo para `avaliacoes/{ano}/{trimestre}/{avaliacao_id}/{timestamp}-{nome-seguro}.xlsx` no bucket privado `avaliacoes-diretores-planilhas` (`upsert: false`).
6. `UPDATE` do caminho/tamanho do arquivo na avaliação.
7. **Base fresca + plano (fonte única da regra — §21)**: `carregarBaseImportacao()` relê o estado atual (somente avaliações `publicada`) e `planejarAtualizacao()` (`src/services/importPlan.js`) calcula as ações — a MESMA função pura da prévia. Em seguida a gravação executa o plano em estágios:
   - `registros` — `INSERT` só dos **novos** (com o `avaliacao_id` desta importação); `UPDATE` dos reutilizados (situação atual), **reativados** (`arquivado_em = null`) e **arquivados** (`arquivado_em = agora`);
   - `periodos` — `INSERT` de períodos novos (ordem cronológica, completando a `ordem` dos vizinhos), `UPDATE` da `ordem` nas reposições e `UPDATE` de `estagio`/`nivel` **apenas onde estavam vazios** (completar);
   - `indicadores` — `INSERT` de indicadores novos e `UPDATE` de `valor_numerico`/`valor_texto` (nunca de `nome_indicador`/`registro_id`; ajuste manual não é substituído).
8. `UPDATE` final: `status = 'publicada'`, `publicado_em`, totais.
9. **Falha em qualquer estágio**: a avaliação recebe `status = 'erro'` e `erro_detalhe` descreve o estágio; nada é apagado.

---

## 5. Segurança (fase provisória)

O protótipo **não tem login**. Para funcionar, a migration `20261013180000_avaliacoes_diretores_acesso_anon_provisorio.sql` concede acesso ao papel `anon` **apenas aos recursos do módulo**:

| Recurso | `anon` pode |
| --- | --- |
| 5 tabelas do módulo | `SELECT` e `INSERT` |
| `avaliacoes_diretores` | `UPDATE` apenas de colunas do fluxo (`storage_*`, `arquivo_nome_original`, `total_*`, `status`, `publicado_em`, `erro_detalhe`) e apenas quando `status = 'processando'` → `publicada`/`erro` |
| `avaliacoes_diretores_registros` | `UPDATE` só de `codigo_regional, regional, status_gestao, ciclo_vida, nivel_atual, arquivado_em` (reutilizar/arquivar/reativar — §21); identidade bloqueada por trigger |
| `avaliacoes_diretores_periodos` | `UPDATE` só de `ordem, estagio, nivel` (reposição cronológica + completar campo vazio); sobreescrita de valor preenchido bloqueada por trigger |
| `avaliacoes_diretores_indicadores` | `UPDATE` só de `valor_numerico, valor_texto` (valores importados; `nome_indicador`/`registro_id` intocáveis) |
| Bucket `avaliacoes-diretores-planilhas` | `SELECT` e `INSERT` (upload) |
| Qualquer coisa fora disso | ❌ — nada (sem DELETE, sem sobrescrita de identidade, sem outras tabelas/buckets) |

Privilégios são por **coluna** (`grant update (colunas...)`) e as invariantes extra são garantidas por **triggers** (`20261020150000_avaliacoes_diretores_importacao_entidade.sql`, seção 4): período não muda `rotulo_periodo`/`registro_id` nem sobrescreve `estagio`/`nivel` preenchidos; registro não muda `id`/`avaliacao_id`/`diretor`/`unidade`/`created_at`.

Todas as políticas `anon` têm sufixo `_anon_provisorio` e comentário `PROVISÓRIO`: **ao integrar ao sistema maior, devem ser removidas e substituídas** por políticas de usuário autenticado. `service_role` nunca é usado no frontend.

Limitações conhecidas da fase provisória:

- Qualquer visitante com a URL + chave anon pode importar planilhas (mitigado pela unicidade de hash, pelo limite de 15 MB e pela ausência de DELETE).
- O bucket valida MIME, não extensão (o content-type é derivado da extensão no cliente).
- `auth.uid()` é nulo sem login: `importado_por` fica `NULL`.

---

## 6. Testes e build

```bash
npm run typecheck         # tsc --noEmit — 0 erros
npm test                  # unitários (node:test, sem rede)
npm run test:integration  # integração (dashboard/RLS no Supabase real; importação via fake)
npm run build             # vite build
```

> **Pendência (Fase 9 — migração dos testes):** os 16 arquivos `.mjs` de
> `tests/` importam caminhos `src/**.js` que deixaram de existir após a
> migração para TypeScript (`src/**.ts`). `npm run test` está **quebrado**
> até a Fase 9 (opções planejadas: `tsx --test` ou migração para `vitest`).
> Aprovado como risco R1 no plano de migração. Build e typecheck não são
> afetados.

- **Unitários (66)**: validação de arquivo, hash SHA-256, caminho/nome do Storage, detecção dinâmica de períodos e indicadores no `exemplo-planilha.xlsx`, campos obrigatórios ausentes, duplicidades, classificação de hash duplicado, **modelo dos dashboards** (ordenação, métricas EAV→nomes amigáveis, agregados, cascata regional→diretor, rótulos compostos, contrato `metricas`, `recordMetric`, `buildRadarSeries`, **contagem definitiva de diretores/unidades** e **abreviação dos rótulos de períodos**), **evolução mensal individual** (`parseMonthHeader`, `buildMonthlyLabelMap`, `buildDirectorMonthlyEvolution`) e **vínculo/exibição das observações** (`resolveObservacaoVinculo`, `observacaoFiltros`, `observacaoVisivel`, `validarObservacao`, `formatarDataHora` — inclui "observação de Hesdras nunca aparece para Gregorio/Cilene").
- **Integração (11)**: divididos para **nunca deixar dados permanentes** no Supabase real:
  - *Importação (fake em memória, `fakeSupabase.mjs`)*: publica o exemplo, detecta hash duplicado, marca `erro` em falha de envio e confirma sanidade — tudo num cliente Supabase simulado, sem tocar o projeto real.
  - *Dashboard (leitura real, tolerante a banco vazio)*: carrega públicas e monta o modelo; valida o estado vazio.
  - *RLS (sondagens sem criar dados)*: DELETE/UPDATE/sobrescrita negados para o papel `anon`; confirma que as sondagens não deixam resíduo.
- A suíte de importação roda com a flag `--experimental-test-module-mocks` (presente no script).
- `xlsx`: instalado a partir do CDN oficial do SheetJS (`0.20.3`) para conter as correções de segurança (as versões do npm estão defasadas; `npm audit` fica limpo).

---

## 7. Dashboards alimentados pelo Supabase (fase 3)

Os dashboards **não usam mais dados locais**: `src/data/initialRows.json` foi removido e `exemplo-planilha.xlsx` existe apenas como material de teste (nunca é carregado automaticamente).

- **Fonte**: avaliações com `status = 'publicada'` — todas aparecem **simultaneamente** para comparação (nenhum filtro obrigatório por avaliação).
- **Carregamento**: no mount do app e **após cada publicação**; como tudo vem do Supabase, a tela **persiste após F5**.
- **Consultas eficientes** (`dashboardService.js`): 1 requisição de avaliações + lotes de 20 avaliações para registros (páginas de 500) + lotes de 100 `registro_id` para períodos/indicadores — nunca uma requisição por registro. `dados_originais` (jsonb) **não** é baixado.
- **Filtros em cascata (sem “Nível de análise”)**: a lateral tem apenas **Regional** e **Diretor**. Estados: todas + todos = consolidado geral · regional + todos = consolidado regional · regional + diretor = perfil individual. Trocar a regional limpa o diretor; o diretor fica desabilitado sem regional; “Todos os diretores” nunca conta como diretor. **Sem filtro de unidade** (unidade aparece em tabelas/detalhes). Títulos automáticos: “Desempenho geral” / “Desempenho da regional” / “Perfil do diretor”.
- **Contagens de quantidade**: KPIs, resumo lateral e cartões por avaliação usam a função única `countDistinctNames` (`dashboardService.js`) — descarta nulos, vazios e marcadores técnicos ("Diretor não informado", "Unidade não informada"), ignora espaços extras e maiúsculas; **nunca** conta nº de registros. Com a planilha real: **60 diretores** e **60 unidades** (61 registros − 1 marcador).
- **Comparações**: por avaliação (título · Ttri/ano · nome real do arquivo · diretores · unidades · nível médio); seleção vs consolidado geral (radar); e **“Evolução mensal do nível de desenvolvimento”** — **uma única série** (o diretor selecionado; sem consolidado regional nem consolidado geral), eixo X **mensal, pelos cabeçalhos REAIS da planilha** reconhecidos por `parseMonthHeader`/`buildMonthlyLabelMap`/`buildDirectorMonthlyEvolution` (`dashboardService.js`): nome de mês (`JULHO`), data (`JAN DE 2026`, `01/01/2026`) e fechamento de trimestre (`2TRI/25`, `SET/3TRI`, `MAR/1TRI 2026`) viram `MES/AAAA` — com a planilha atual exibe exatamente 16 meses (`JUN/2025` … `SET/2026`), nunca além de SET/2026 e **sem nenhum rótulo `/85` ou data inventada** (ano ausente é inferido na ordem cronológica; ano fora da janela das avaliações é descartado; ano nunca é lido de notas, percentuais ou valores de células). O gráfico **começa no primeiro mês com status ou nível válido daquele diretor** (meses anteriores ficam ocultos) e segue até o último período real da avaliação; lacuna posterior mantém o mês no eixo **sem ponto, sem zero e sem repetição do valor** (linha interrompida). Fechamentos trimestrais usam **marcador dourado maior com contorno**, rótulo “Nº trimestre de AAAA” abaixo do mês e um único ponto. Conversão de níveis via `romanLevel` com **correspondência exata** (mapa I–V, sem reconhecimento parcial de IV como I ou V); **largura responsiva** — `ResizeObserver` mede o container e o gap entre pontos é recalculado dinamicamente para ocupar toda a largura do card (sem rolagem horizontal em resoluções ≥ ~700 px); algarismo romano fixo acima de cada ponto, ausência = quebra na linha (nunca 0) e tooltip com mês/ano por extenso, estágio, nível de desenvolvimento em romano e fechamento de trimestre (§16).
- **Layout**: **uma única rolagem vertical** da página; lateral simplificada (marca, atualização pela planilha, Regional, Diretor, resumo da seleção — **sem o bloco antigo de observações**, ver §17); blocos empilhados em largura total, nesta ordem: **Pareceres (dois cards no topo, somente com diretor selecionado) → Histórico das avaliações → Evolução mensal do nível de desenvolvimento (somente com diretor selecionado) → Comparação de desempenho → Indicadores → Matriz histórica de desempenho**; card de evolução com ~420–430px no desktop e ~400–410px no notebook (altura responsiva no celular), radar mantido em ~430px no desktop (~380px no mobile); radar ampliado e centralizado com legenda abaixo.
- **Matriz histórica de desempenho** (`src/components/PerformanceMatrix.jsx`): substitui a antiga “Detalhes da seleção” e reproduz a planilha original. Colunas congeladas (Regional · Diretor · Unidade) com rolagem horizontal; **histórico dinâmico** — cada período armazenado vira duas colunas (Status = `periodo.estagio` · Nível = `periodo.nivel`), em ordem (avaliação, `ordem`), rótulo composto quando repetido entre avaliações; **bloco final** separado (Status de gestão = `statusGestao` · Ciclo de vida = `cicloVida` · Nível da unidade = `nivelAtual`) seguido dos 9 indicadores (EAV amigável; ausência = “—”, nunca 0) e de indicadores extras futuros em dinâmico. **8 filtros locais** combinados por AND (Regional, Diretor, Unidade, Período, Status trimestral, Nível, Status de gestão, Ciclo de vida) + “Limpar filtros” + contador “X de Y registros”; o filtro **Período** delimita a casca em que Status trimestral/Nível valem. Helpers puros testáveis em `dashboardService.js` (`matrixPeriodColumns`, `filterMatrixRows`, `formatMetricCell`, `MATRIX_INDICATORS`). Sem mapa de calor nesta etapa.
- **Estados de tela**: carregando; erro de consulta (com “Tentar novamente”); **vazio informativo** quando não há avaliação publicada; **Error Boundary** (`src/components/ErrorBoundary.jsx`) envolvendo a área principal — um erro de renderização (ex.: gráfico falhando com dados inesperados) mostra um estado de erro recuperável em vez de derrubar o app.
- **Contrato de métricas**: o modelo do Supabase expõe `metricas` (português); os gráficos leem `r?.metricas?.[n]` com acesso defensivo a `null`/`undefined`.
- **Textos da interface**: sem nomes técnicos de banco/auth na tela (“Supabase”, “login”, “anon”, “publicadas”, “Planilha1”, nomes de variáveis); erros vindos do parser/serviços são traduzidos na exibição pelo helper `humanError` (em `App.jsx` e `ImportDialog.jsx`). O selo “1 avaliação disponível” / “X avaliações disponíveis” no topo **foi removido em 2026-10-15** (ver §17).
- **Observações (CRUD completo no banco, vinculadas ao diretor)**: salvas em `avaliacoes_diretores_observacoes` via `observacoesService.js`; **localStorage removido**. **Regra definitiva**: a observação é registrada pelo regional, mas **vinculada exclusivamente ao diretor selecionado** dentro da avaliação correspondente — e **somente é exibida quando o mesmo diretor está selecionado** (nunca para outro diretor da mesma regional). O formulário e a lista ("Observação do regional" / "Observações do regional") só existem com **regional + diretor** selecionados: sem regional a mensagem é "Selecione uma regional e um diretor para registrar ou consultar observações."; com regional e sem diretor é "Selecione um diretor para registrar ou consultar observações." (campo desabilitado, **Salvar observação** desabilitado e lista oculta nos dois casos). Criar: valida texto + regional + diretor → localiza o vínculo (avaliação mais recente em que o diretor tem registro + `registro_id`) → insere com `escopo='diretor'`, `avaliacao_id`, `registro_id`, `regional`, `diretor`, `criado_por`/`atualizado_por` `NULL` → aguarda confirmação do banco → limpa campo → "Observação salva com sucesso." → recarrega lista. Listar: prioridade `registro_id` → `avaliacao_id` → `escopo='diretor'` → não arquivadas, com regional e diretor como confirmação; **nunca consulta somente pela regional**; troca de regional/diretor limpa a lista na hora e descarta respostas atrasadas (token de requisição). Cada cartão mostra **diretor, regional, avaliação (ex.: 3º tri/2026), data/horário, texto, Editar e Excluir**; lista ordenada por data decrescente com as 3 mais recentes e "Ver todas". Editar: atualiza só `observacao` + `updated_at` pelo id (**vínculo preservado**) → "Observação atualizada com sucesso.". Excluir: exclusão lógica (`arquivada_em`; `DELETE` físico bloqueado no RLS) → "Observação excluída com sucesso."; arquivadas não aparecem. Persiste após F5 (dados no banco). **Atualização (2026-10-15)**: o formulário e a lista deixaram de existir na lateral e foram substituídos pela **área de Pareceres** do topo (§17) — o serviço, o vínculo (`resolveObservacaoVinculo`) e os dados do banco permanecem intactos; linhas legadas com `tipo = NULL` continuam sendo “observações” e não aparecem nos cards de parecer.

---

## 8. Estado do banco (dados reais)

- **Estado atual (após a limpeza de 2026-10-20 — ver §20)**: módulo **vazio** — 0 avaliações, 0 registros, 0 períodos, 0 indicadores, 0 ajustes, 0 pareceres/observações e bucket sem arquivos, aguardando a importação da planilha completa correta.
- **Estado anterior (até 2026-10-20)**: o módulo continha **1 avaliação publicada** — `3TRI 2026 - STATUS DIRETORES UNIDADES` (3º tri/2026, 61 registros, 60 diretores válidos, 60 unidades), importada manualmente pelo usuário, além de resíduo de teste (2ª avaliação `erro`, ajustes e pareceres de teste). Tudo isso foi **removido** na limpeza da seção 20.
- Os testes de integração **não recriam dados permanentes**: a importação roda contra um fake em memória (`tests/integration/fakeSupabase.mjs`); o dashboard e o RLS apenas leem/sorveem sem gravar.
- Limpeza definitiva das políticas `anon` é **pendência da integração** com o sistema maior.
- **Observações legadas sem diretor — resolvido**: as 2 linhas antigas com `escopo='regional'` e `diretor=NULL` (regional AISLANE BELO, arquivadas, resíduo de teste) **foram removidas do banco** (não eram atribuíveis a nenhum diretor). Toda observação existente tem agora `escopo='diretor'` com `registro_id` + `regional` + `diretor` preenchidos.

---

## 9. Próximos passos (aguardando aprovação)

1. ~~Upload manual da planilha real~~ — **concluído**: a avaliação real está publicada (ver seção 8). Novas importações seguem o fluxo “Atualizar pela planilha”.
2. Observações por usuário (`avaliacoes_diretores_observacoes`) — requer autenticação do sistema maior.
3. Substituição das políticas `*_anon_provisorio` pelas políticas do sistema principal.

---

## 10. Personalização visual (2026-10-13)

Alterações **somente visuais** — nenhuma regra funcional foi modificada (banco, upload, CRUD de observações, filtros, gráficos, cálculos, indicadores, tabelas, migrations, políticas e serviços permanecem intactos).

### 10.1 Arquivos visuais e caminhos dos assets

| Arquivo físico | Caminho público | Uso |
|---|---|---|
| `public/assets/background-topografico.png` (1461×877) | `/assets/background-topografico.png` | fundo de toda a viewport |
| `public/assets/logo-diretores.png` (500×500, RGBA) | `/assets/logo-diretores.png` | logo do cabeçalho da lateral **e** favicon |

Nenhuma imagem foi gerada, substituída ou recriada com CSS.

### 10.2 Cor e largura da lateral

- **Cor base**: `#294b5b` (medido em runtime: `rgb(41, 75, 91)`).
- Variações permitidas: área mais escura `#213f4d` (bloco de resumo) e borda `rgba(255,255,255,0.18)`.
- **Largura adotada**: **280 px** no desktop · **260 px** em notebooks (≤1440 px).
- **Efeito 3D**: cantos de 20 px, borda superior/lateral translúcida iluminada, sombra profunda externa + brilho interno sutil, margens laterais/superior/inferior e comportamento `sticky` (altura `calc(100vh - 28px)`, rolagem interna somente se os controles excederem a altura).

### 10.3 Comportamento responsivo

| Largura | Lateral | Observação |
|---|---|---|
| 1920×1080 | 280 px | `overflow-x` = 0 |
| 1366×768 | 260 px | `overflow-x` = 0 |
| 1024 px | 260 px | KPIs em 2 colunas, `overflow-x` = 0 |
| ≤760 px (celular) | empilhada, estática, largura total | filtros/controles antes do conteúdo, KPIs em 1 coluna (≤480 px), `overflow-x` = 0, fundo com `background-attachment: scroll` |

Fundo: `background-size: cover`, `background-position: center`, `background-repeat: no-repeat`, `background-attachment: fixed` no desktop e cor de fallback `#14465a`.

### 10.4 Favicon

`index.html` agora declara `<link rel="icon" type="image/png" href="/assets/logo-diretores.png"/>`. Não há mais requisição a `/favicon.ico` e **nenhum 404** aparece no Console (verificado via CDP: 0 respostas 4xx, 0 erros de log, 0 exceções).

### 10.5 Arquivos alterados

- `index.html` — favicon + `theme-color` `#294b5b`.
- `src/App.jsx` — cabeçalho da lateral com `<img class="brand-logo">` + título “Matriz de Desenvolvimento” e subtítulo “Avaliação de desempenho dos diretores” (nenhum sino, ícone de usuário ou saída).
- `src/styles.css` — nova seção “PERSONALIZAÇÃO VISUAL” (fundo, lateral 3D, logo, botões, filtros, cards, responsividade, acessibilidade).
- Assets já existentes em `public/assets/` (não modificados).

### 10.6 Testes realizados

- `npm test` ✅ **43/43**
- `npm run build` ✅
- Validação visual por screenshots (Edge headless) em **1920×1080, 1366×768, 1024 e 390 (celular)**.
- Validação por CDP: largura da lateral 280/260 px, cor `rgb(41,75,91)`, raio 20 px, sombra presente, fundo `cover/center/no-repeat/fixed`, logo carregada 500×500 sem distorção (caixa 43 px · conteúdo 37 px), favicon 200, `overflow-x` = 0 em todas as larguras, ativos `background-topografico.png` e `logo-diretores.png` com status 200, zero falhas de rede/console.

## 11. Matriz com último período primeiro, filtros recolhidos e observação do regional (2026-10-14)

### 11.1 Matriz: último período primeiro

Ao abrir a **Matriz histórica de desempenho** aparecem apenas `Regional`, `Diretor`, `Unidade`, **o período mais recente** da planilha (identificado dinamicamente pela ordem cronológica dos dados — hoje `SET/3TRI 2026`), `Situação atual` e os indicadores finais.

- Botão **Ver histórico completo** → mostra todos os períodos (16 hoje) e passa a exibir **Ocultar histórico**.
- Botão **Ocultar histórico** → volta a mostrar só o período mais recente e a rolagem horizontal volta ao início.
- Regional/Diretor/Unidade ficam congelados; a rolagem horizontal é somente dentro da matriz; nada recarrega e nenhuma consulta nova é feita.
- Todo o histórico continua carregado e disponível (inclusive no filtro **Período**); nenhum dado antigo foi apagado.

### 11.2 Filtros da matriz recolhidos

Os filtros internos da matriz começam **fechados**. O botão **Filtros** no cabeçalho expande o painel (Regional, Diretor, Unidade, Período, Status trimestral, Nível, Status de gestão, Ciclo de vida + **Limpar filtros**) e vira **Ocultar filtros**. Ao recolher, o painel some sem deixar espaço, os filtros aplicados continuam ativos e o botão mostra a quantidade (ex.: **Filtros (1)**). Os filtros da lateral (Regional/Diretor) não mudaram.

### 11.3 Observação do regional

> **Substituído em 2026-10-14** (ver seção 14): a observação deixou de ser gravada no escopo da regional (`escopo: 'regional'`, `diretor: NULL`, `registro_id: NULL`) e passou a ser **individual e exclusiva do diretor selecionado** (`escopo: 'diretor'` + `avaliacao_id` + `registro_id` + `regional` + `diretor`). Os títulos **"Observação do regional"** e **"Observações do regional"** permanecem iguais; o campo agora exige **regional + diretor** (mensagens: "Selecione uma regional e um diretor para registrar ou consultar observações." / "Selecione um diretor para registrar ou consultar observações.") e a lista carrega apenas as observações do diretor selecionado. As duas linhas antigas com `escopo='regional'` (AISLANE BELO, arquivadas, sem diretor) **foram removidas do banco** — resíduo de teste não atribuível a nenhum diretor (ver diagnóstico, seção 21.3).

### 11.4 Testes realizados

- `npm test` ✅ **43/43**
- `npm run build` ✅
- Validação visual/funcional via CDP: matriz inicial com 1 período, expansão/ocultação do histórico (16 ↔ 1), filtros abrindo/recolhendo com `Filtros (1)`, CRUD real de observação (salvar/editar/excluir) e `overflow-x` = 0.
- Banco conferido: nenhuma linha de histórico ou de observação excluída fisicamente (somente arquivamento lógico).

## 12. "Evolução mensal do diretor" — linha do tempo mensal individual (2026-10-14)

O gráfico trimestral foi substituído por uma **linha do tempo mensal individual**, fiel aos períodos existentes na planilha:

- **Visibilidade**: com **Todos os diretores** (em qualquer regional) o card **não aparece** — "Comparação de desempenho" ocupa o espaço automaticamente, sem espaço vazio. O card só existe quando um diretor específico está selecionado e traz **uma única série** (o próprio diretor). **Consolidado regional**, **consolidado geral** e respectivas legendas foram removidos.
- **Períodos reais** (somente cabeçalhos existentes, interpretados como mês/ano): `2TRI/25`→**JUN/2025**, `JULHO`→**JUL/2025**, `AGOSTO`→**AGO/2025**, `SET/3TRI`→**SET/2025**, `OUTUBRO`→**OUT/2025**, `NOVEMBRO`→**NOV/2025**, `DEZ/4TRI`→**DEZ/2025**, data `01/01/2026`/`JAN DE 2026`→**JAN/2026**, `01/02/2026`/`FEV DE 2026`→**FEV/2026**, `MAR/1TRI 2026`→**MAR/2026**, `01/04/2026`/`ABR DE 2026`→**ABR/2026**, `01/05/2026`/`MAI DE 2026`→**MAI/2026**, `JUN/2TRI 2026`→**JUN/2026**, `01/07/2026`/`JUL DE 2026`→**JUL/2026**, `01/08/2026`/`AGO DE 2026`→**AGO/2026**, `SET/3TRI 2026`→**SET/2026**. **Nada além de SET/2026**; nenhum `3º TRI/85`, `4º TRI/85` ou data inexistente; o ano **nunca** vem de notas, percentuais ou valores de células (ano ausente é inferido na ordem cronológica; ano fora da janela das avaliações é descartado e o período segue o ano vizinho).
- **Início individual** — para cada diretor: (1) ordenar os períodos cronologicamente; (2) localizar o primeiro mês com **status ou nível válido**; (3) ocultar todos os meses anteriores; (4) iniciar o gráfico nesse mês; (5) seguir até o último período real da avaliação. Exemplo: primeiro dado em MAI/2026 → eixo **MAI/2026 … SET/2026**. Trocar de diretor recalcula o início na hora.
- **Lacunas depois do início**: o mês **permanece no eixo**, **sem ponto**, **sem zero** e **sem repetir o valor anterior** — a linha é interrompida naquele período (valor `null`).
- **Fechamentos trimestrais**: JUN/2025, SET/2025, DEZ/2025, MAR/2026, JUN/2026 e SET/2026 recebem **marcador dourado, maior e com contorno** (meses comuns ficam azul-petróleo), o rótulo **“Nº trimestre de AAAA”** (ex.: “3º trimestre de 2026”) logo abaixo do mês e **um único ponto** — não existe segundo ponto para o trimestre.
- **Apresentação** (revisada em 2026-10-15, detalhes no §16): título **“Evolução mensal do nível de desenvolvimento”** + subtítulo **“Progressão do diretor entre os níveis I e V ao longo dos meses avaliados.”** + explicação **“Os níveis representam a classificação de desenvolvimento registrada na planilha e não correspondem às notas dos indicadores.”**; eixo Y rotulado **Nível I … Nível V** (sem números arábicos); **algarismo romano fixo sobre cada ponto válido**; eixo X em `MES/AAAA` (ex.: SET/2026); tooltip com **mês/ano por extenso**, **estágio do período**, **nível de desenvolvimento em romano** e **fechamento do trimestre quando aplicável**; legenda apenas **“Período mensal”** e **“Fechamento trimestral”**.
- **Leitura dos dados**: exclusivamente o `status` (estágio) e o `nível` do **período correspondente** — nunca status de gestão da unidade, ciclo de vida, nível da unidade, indicadores finais ou valores de outro mês. Níveis convertem por **correspondência exata** `I=1 … V=5` (removidos parênteses/espaços); valor vazio, inválido ou “Não informado” → `null`.
- **Implementação**: helpers puros em `dashboardService.js` (`parseMonthHeader`, `buildMonthlyLabelMap`, `buildDirectorMonthlyEvolution`) + componente `MonthlyEvolutionChart` em `src/components/Charts.jsx`. `parseQuarterHeader`/`buildQuarterLabelMap` permanecem intactos (testes e demais usos).

Testes: `npm test` ✅ **54/54** · `npm run build` ✅ · render de fumaça do SVG com a planilha real (16 rótulos do eixo, 15 pontos para 15 valores, 6 subrótulos de trimestre, mês da lacuna no eixo sem ponto, nenhum `/85`).

## 13. Bloco Indicadores: referência dinâmica e "último período × consolidado" (2026-10-14)

O bloco **Indicadores** passou a trabalhar com a **referência mais recente da avaliação** e um seletor de visão:

- **Título dinâmico**: "Indicadores de Setembro de 2026" — mês e ano vêm do **último período** da planilha (mesma fonte da matriz histórica). Ao publicar uma avaliação mais recente (ex.: dezembro), o título se atualiza sozinho; não há mês/ano fixo no código.
- **Visão padrão (último período)**: médias dos registros da avaliação mais recente; sem linha "Geral:"; métrica sem dado exibe "Não informado" (nunca zero).
- **Botão "Ver consolidado"** (canto direito): alterna para "Indicadores consolidados" — médias de todas as avaliações disponíveis, com nota **"Consolidado: X"** em cada métrica; o botão passa a exibir "Ver último período".
- A modalidade **não é resetada** pelos filtros: trocar Regional ou Diretor atualiza os números e mantém "último período" ou "consolidado".
- Título/subtítulo: "Indicadores de {Mês} de {Ano}" + "Resultados da referência mais recente da avaliação." ⇄ "Indicadores consolidados" + "Resultados consolidados das avaliações disponíveis."

Testes: `npm test` ✅ **43/43** · `npm run build` ✅ · validação via CDP/screenshot em 1920×1080, 1366×768 e 390px (cenários acima, incl. "Não informado" e alternância com filtro ativo).

## 14. Observações do regional: vínculo exclusivo com o diretor (2026-10-14)

Correção da regra de vínculo, salvamento e exibição das observações do regional.

### 14.1 Regra definitiva

**A observação é registrada pelo regional, mas vinculada exclusivamente ao diretor selecionado dentro da avaliação correspondente. A observação somente será exibida quando o mesmo diretor estiver selecionado.**

- Uma observação criada para **Hesdras Viana** (regional PAULO PALMEIRA) **não aparece** para **Gregorio Batista**, **Cilene Andrade** nem para qualquer outro diretor — nem da mesma regional nem de outra.
- Gravação **sempre** individual: `escopo='diretor'` + `avaliacao_id` + `registro_id` + `regional` + `diretor`; `criado_por`/`atualizado_por` permanecem `NULL` (sem login; autoria não é inventada).
- **Nenhuma migration**: a tabela `avaliacoes_diretores_observacoes` já tinha `avaliacao_id`, `registro_id`, `escopo` (CHECK `geral|regional|diretor`), `regional`, `diretor` e as políticas necessárias (SELECT/INSERT/UPDATE para `anon`; `DELETE` sem política).

### 14.2 Vinculação no salvamento (`resolveObservacaoVinculo`)

1. Exige **regional + diretor** selecionados (sem ambos, a validação bloqueia).
2. Localiza o **registro do par regional+diretor** percorrendo as avaliações **da mais recente para a mais antiga**.
3. `avaliacao_id` = avaliação daquele registro; `registro_id` = id do registro. Sem registro não há vínculo (erro "Não foi possível identificar a avaliação do diretor selecionado.").
4. `INSERT` aguarda a confirmação real (`.select().single()`); o campo só é limpo **depois** da confirmação. Bloqueio de duplo clique: botão desabilitado durante o salvamento + guarda `obsSaving` no handler.

### 14.3 Consulta e exibição (`observacaoFiltros` / `observacaoVisivel`)

- Filtros (em ordem de especificidade): `escopo='diretor'` → `arquivada_em IS NULL` → `diretor` → `regional` → `avaliacao_id` → `registro_id` (quando disponível). **Nunca consulta somente pela regional.**
- Guarda de exibição no cliente (defesa extra): só aparece observação **não arquivada**, com `escopo='diretor'`, do **mesmo diretor**, da **mesma regional** e da **mesma avaliação**.
- Ordenação `created_at` descrescente; **3 mais recentes** + "Ver todas".
- Troca de regional/diretor: a lista é **limpa na hora** e um **token de requisição** descarta respostas atrasadas — a resposta de uma troca anterior nunca sobrescreve a lista do diretor atual (corrigido durante o teste real: troca rápida Cilene→Hesdras podia mostrar lista vazia).

### 14.4 Interface

| Situação | Comportamento |
| --- | --- |
| Sem regional ("Todas as regionais") | textarea e **Salvar observação** desabilitados; lista oculta; "Selecione uma regional e um diretor para registrar ou consultar observações." |
| Regional sem diretor ("Todos os diretores") | textarea e **Salvar observação** desabilitados; lista oculta; "Selecione um diretor para registrar ou consultar observações." |
| Regional + diretor | campo e botão ativos; lista com o título "Observações do regional" |
| Cartão | diretor · regional · avaliação (ex.: "3º tri/2026") · data/horário · texto · **Editar** · **Excluir** |
| Mensagens | "Observação salva com sucesso." · "Observação atualizada com sucesso." · "Observação excluída com sucesso." |

Títulos **"Observação do regional"** e **"Observações do regional"** mantidos (apenas caixa alta via CSS). A edição altera somente o texto (vínculo intacto); a exclusão é lógica (`arquivada_em`) e o `DELETE` físico continua bloqueado no RLS.

> **Descontinuado em 2026-10-15 (ver §17):** o formulário e a lista deixaram de existir na lateral — a interface acima descreve o comportamento vigente até essa data. O serviço (`observacoesService.js`) permanece e é reaproveitado pela área de pareceres.

### 14.5 Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `src/services/observacoesService.js` | `createObservacao` exige regional/diretor e força `escopo='diretor'`; `listObservacoesDiretor` recebe `registroId`/`avaliacaoId`; **removida** `listObservacoesRegional` (consulta só por regional); helpers puros `validarObservacao`, `resolveObservacaoVinculo`, `observacaoFiltros`, `observacaoVisivel`, `formatarDataHora` |
| `src/App.jsx` | formulário/lista condicionados a regional+diretor; vínculo via `resolveObservacaoVinculo`; token anti-resposta-atrasada; cartões com diretor/regional/avaliação/data; mensagens com ponto final |
| `src/styles.css` | `.obs-meta` com `flex-wrap` (4 itens no cartão) |
| `tests/unit/observacoesVinculo.test.mjs` | **novo** — 12 testes de vínculo/filtros/visibilidade/validação |

### 14.6 Validações

- `npm test` ✅ **66/66** · `npm run test:integration` ✅ **11/11** (inclui `DELETE` físico negado) · `npm run build` ✅
- **Teste real completo (CDP, 38/38 verificações)** com Hesdras Viana × Gregorio Batista × Cilene Andrade × Gleison de Albuquerque na regional PAULO PALMEIRA: criação com vínculo correto, isolamento entre diretores, edição preservando vínculo, exclusão lógica, observações legadas de escopo regional não exibidas, observação real do Gleison exibida **somente** para ele e **0 erros de console**.
- Banco conferido após o teste: linha criada com `escopo='diretor'`, `registro_id` do diretor, `avaliacao_id` correta, `criado_por`/`atualizado_por` `NULL` e `arquivada_em` preenchido após a exclusão; linhas legadas e a do Gleison intocadas.

---

## 15. Preparação para publicação na Vercel (2026-10-14)

Etapa de **preparação** (sem deploy, sem repositório, sem `git init`/commit/push): o projeto foi deixado tecnicamente pronto para ser enviado ao GitHub e importado na Vercel. Nenhuma funcionalidade, layout, banco, upload, gráfico, filtro, observação, tabela ou cálculo foi alterado.

### 15.1 Arquitetura de publicação

- SPA **React + Vite** pura, 100% client-side, servida como arquivos estáticos.
- Build de produção com `npm run build` → saída em `dist/` (copiada integralmente pela Vercel).
- Conexão de dados: Supabase (PostgREST + Storage) direto do navegador, com a chave **pública anon** e políticas RLS `anon` provisórias. Sem SSR, sem Vercel Functions, sem Next.js.

### 15.2 Comandos e saída

| Comando | Script | Saída |
| --- | --- | --- |
| `npm run dev` | `vite` | servidor de desenvolvimento (porta 5173) |
| `npm run build` | `vite build` | pasta `dist/` |
| `npm run preview` | `vite preview` | serve `dist/` (porta 4173) |
| `npm test` | `node --test tests/unit/**` | 66 testes unitários |
| `npm run test:integration` | `node --test --experimental-test-module-mocks tests/integration/**` | 11 testes de integração |

Gerenciador de pacotes: **npm** (único lock versionado: `package-lock.json`; nenhum lock de pnpm/yarn).

### 15.3 Variáveis de ambiente (somente públicas `VITE_`)

| Variável | Uso |
| --- | --- |
| `VITE_SUPABASE_URL` | URL do projeto (`https://<ref>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | chave **publicável** (anon/publishable). **Nunca** `service_role` |

- Lidas no frontend via `import.meta.env` (`src/services/supabaseClient.js`); o acesso a `process.env` no cliente existe apenas como ramo inalcançável no navegador, para os testes de integração em Node.
- `.env.example` versionado com placeholders (sem valores reais); `.env` real fica fora do Git.
- Na Vercel: configurar nos ambientes **Production**, **Preview** e (quando necessário) **Development**.
- Sem variáveis definidas, a aplicação mostra mensagem clara de configuração ausente (nunca tela branca, nunca dados de exemplo automáticos).

### 15.4 Arquivos ignorados pelo Git (`.gitignore`)

`node_modules/` · `dist/` · `.vite/` · `.vercel/` · `.env` e `.env.*.local` (mantendo `!.env.example`) · `*.log` · `.DS_Store` · `Thumbs.db` · `opencode.json` · `.sisyphus/` · `.secrets/` · `*.local.json`.

Versionados: `package.json` + `package-lock.json` · `vite.config.js` · `vercel.json` · `.env.example` · `index.html` · `src/` · `public/assets/*.png` · `tests/` (inclui `tests/fixtures/exemplo-planilha.xlsx`) · `supabase/migrations/` · `docs/` · `README.md`.

### 15.5 `vercel.json` (rotas SPA + cabeçalhos)

- **Rewrites:** `/((?!assets/).*)` → `/index.html` — fallback de SPA para funcionar o **F5 em qualquer rota**, sem reescrever arquivos reais de `/assets/` (a pasta `assets/` é servida antes do rewrite).
- **Cabeçalhos** (básicos, sem bloquear Supabase/Storage/upload): `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restritivo a câmera/microfone/geolocalização, e `Cache-Control: immutable` para `/assets/*`. **Sem CSP restritiva nesta etapa** (poderia bloquear Supabase Storage/APIs).
- Comandos explícitos: `installCommand: npm install`, `buildCommand: npm run build`, `outputDirectory: dist`.

### 15.6 Assets publicados

| Arquivo | Uso |
| --- | --- |
| `public/assets/background-topografico.png` | fundo topográfico (`src/styles.css`) |
| `public/assets/logo-diretores.png` | logo da lateral (`src/App.jsx`) e **favicon** (`index.html`) |

Ambos são copiados para `dist/assets/` no build e versionados. Nenhuma planilha real entra no bundle nem em `public/` — a planilha de exemplo foi movida para `tests/fixtures/exemplo-planilha.xlsx` (fixture de teste automatizado; planilhas operacionais do usuário ficam apenas no Storage).

### 15.7 Verificação de segurança

- **Sem segredos no código versionado:** nenhum `sbp_`, `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, senha ou token pessoal em `src/`, `tests/`, `docs/`, `public/` ou arquivos de configuração (token MCP do `opencode.json` já estava em variável de ambiente; o arquivo passou a ser ignorado pelo Git).
- **Bundle (`dist/`):** sem `.env`, sem `.xlsx`, sem `.sql`, sem `service_role`, sem `process.env`, sem caminhos de máquina. As únicas ocorrências de `localhost`/`127.0.0.1`/`file:///` são padrões internos de bibliotecas de terceiros (supabase-js/SheetJS), não configuração do projeto. A chave `VITE_SUPABASE_ANON_KEY` embutida no build local é a **pública anon** (`role:"anon"`) — comportamento esperado do Vite; no Vercel será embutida a variável do ambiente do projeto.

### 15.8 Resultado das verificações (2026-10-14)

- `npm install` ✅ (0 vulnerabilidades, versões pinadas iguais às do lock) · `npm test` ✅ **66/66** · `npm run build` ✅ `dist/` gerada · `npm run preview` ✅ (`/` 200, favicon/logo 200, fundo 200, rota SPA inexistente → `index.html` 200).
- **Pendências para o deploy (fora do escopo desta etapa):** criar o repositório Git e enviar o projeto; importar o projeto na Vercel (Framework Preset **Vite**, Build `npm run build`, Output `dist`); configurar `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` nos ambientes da Vercel; no Supabase, adicionar o domínio do deploy em **URLs de redirecionamento/Allowed CORS** conforme necessário e revisar as políticas `anon` provisórias (sufixo `_anon_provisorio`) antes de produção ampla.

### 15.9 Envio ao repositório Git (2026-10-14)

O projeto foi preparado e enviado ao repositório remoto (`origin/main`) após auditoria de segurança: nenhum segredo (`.env`, `service_role`, tokens, planilhas reais) foi versionado; `.gitignore` bloqueia `.env*`, `opencode.json` e todas as planilhas (`*.xlsx`, `*.xls`, `*.csv`). A fixture de teste em `tests/fixtures/` contém dados reais e permanece apenas local. Nenhuma funcionalidade, layout, banco, gráfico, filtro, upload ou observação foi alterado nesta etapa.

## 16. Nomenclatura e apresentação visual do gráfico de evolução mensal (2026-10-15)

Alteração **somente local** de nomenclatura e apresentação do card de evolução mensal. **Nenhum dado, cálculo, período, filtro, indicador, observação, banco, upload ou matriz foi alterado**; sem `git add`/`commit`/`push`, sem atualização do GitHub, sem deploy/redeploy na Vercel e sem mudança de variáveis de ambiente.

### 16.1 Nomenclatura definitiva

| Campo | Texto aplicado |
|---|---|
| Título | **“Evolução mensal do nível de desenvolvimento”** (21px, peso 700) |
| Subtítulo | **“Progressão do diretor entre os níveis I e V ao longo dos meses avaliados.”** (15px, peso 400) |
| Explicação | **“Os níveis representam a classificação de desenvolvimento registrada na planilha e não correspondem às notas dos indicadores.”** (13,5px, peso 400) — sem novo card, logo abaixo do subtítulo |
| Eixo vertical | **Nível I, Nível II, Nível III, Nível IV, Nível V** (sem números arábicos) |
| Rótulos dos pontos | **I, II, III, IV, V** (algarismos romanos; nunca “Nota 2”) |
| Tooltip | **“Junho de 2026”** (mês/ano por extenso) · **“Estágio: …”** · **“Nível de desenvolvimento: II”** · **“Fechamento do 2º trimestre de 2026”** (quando aplicável) |
| Legenda | **“Período mensal”** e **“Fechamento trimestral”** (removido “Evolução mensal”, já dito no título) |

Termos proibidos na apresentação deste gráfico: nota, pontuação, média, desempenho numérico, nível consolidado.

### 16.2 Significado dos níveis e diferença entre nível e nota

- **Níveis de desenvolvimento** registrados na planilha: **Nível I, II, III, IV e V**. Internamente continuam **I = 1 … V = 5** (mesmos valores, mesma escala, mesma comparação entre diretores).
- **Nível ≠ nota**: os valores do gráfico **não são notas** dos indicadores. A nota/pontuação dos indicadores vive em outros blocos (KPIs, radar, matriz histórica); neste gráfico a coluna lida é o **NÍVEL** do período (`romanLevel`, correspondência exata I–V) e o **estágio/status** do período.
- A cor **dourada** marca apenas **fechamento trimestral** — não indica melhora ou piora.
- O eixo mantém a escala completa **Nível I → Nível V** em todos os diretores (mesma base para comparação).

### 16.3 Tamanhos de fonte adotados

| Elemento | Desktop | Notebook/mobile |
|---|---|---|
| Título | 21px / peso 700 | 20px (≤760px) |
| Subtítulo | 15px / peso 400 | 14px |
| Explicação | 13,5px / peso 400 | 13px |
| Eixo vertical (Nível I…V) | 13px / peso 600 | 12px |
| Rótulos dos pontos (I…V) | 14px / peso 700 | 13px |
| Meses (`MES/AAAA`) | 13px / peso 600 | 13px |
| Fechamentos trimestrais | 12,5px / peso 600 | 12px |
| Tooltip | 13px (1ª linha 13,5px/peso 700) | 13px |
| Legenda | 13,5px / peso 500 | 13px |

(O peso 500 foi adicionado ao carregamento do Inter; nenhum outro elemento usa 500, portanto nada mais mudou.)

### 16.4 Linha, marcadores, card e distribuição

- **Linha**: espessura **3,5px** (`.evolution-card .line-path.line-sel`), azul-petróleo `--teal:#087f95`, `stroke-linecap/linejoin: round`, sem sombra; renderização 1:1 (SVG em unidades CSS) — visível também em telas de alta densidade.
- **Marcadores comuns**: diâmetro **12px** (r=6), azul-petróleo com borda escura discreta (1,5px `#04525f`); **área de interação de 20px** (r=10) via `circle.dot-hit` transparente.
- **Fechamentos trimestrais**: diâmetro **15px** (r=7,5), dourado `--gold:#d2a42b` com contorno **2,5px** `#7a5a0d`; área de interação **26px** (r=13).
- **Altura do card**: `.evolution-card .chart` = **280px** no desktop (>1440px), **262px** no notebook (≤1440px) e **300px** no celular — card total em **≈420–430px no desktop** e **≈400–410px no notebook** (título + subtítulo + explicação + gráfico + legenda, sem conteúdo cortado e sem grande espaço vazio); no celular a altura do card é a resultante do conteúdo (responsiva). O card de radar continua com `.chart` 430px/380px (inalterado).
- **Distribuição interna**: `PAD=72px` de margem esquerda/direita (cabe o “Nº trimestre de AAAA” na borda), `MIN_GAP=96px` e `ResizeObserver` medindo **largura e altura** do container — os pontos ocupam toda a largura útil; eixo Y em SVG próprio de **74px** (“Nível III” não é cortado); o SVG recebe **largura/altura inline (`W×H`)** para manter escala 1:1 (fontes nunca encolhem): quando a largura não comporta os 96px por mês, a rolagem horizontal acontece **somente dentro de `.chart-scroll`** (a página não rola na horizontal) e a altura útil é medida já **descontando a barra de rolagem**, para não cortar os rótulos de trimestre.
- **Tooltip**: div própria (`.chart-tip`, `position:fixed`) — fundo `#0e2f3b` com texto branco, borda `#cfe1e7`, raio 10px, padding 10×12, largura até 280px, posicionada junto ao cursor e limitada à viewport; substitui o `<title>` nativo.

### 16.5 Regras funcionais preservadas

Card oculto em “Todos os diretores”; visível só com diretor específico; uma única linha; meses anteriores ao início do diretor ocultos; lacunas posteriores sem ponto (linha interrompida, nunca 0 e nunca repetido); ausência não vira Nível I; trimestres destacados somente quando existirem na planilha; nenhum período/data inventado; nenhuma média regional nem consolidado geral.

### 16.6 Arquivos alterados

| Arquivo | O que mudou |
|---|---|
| `src/App.jsx` | Título, subtítulo, explicação e legenda do card; classe `evolution-card` para escopar o CSS |
| `src/components/Charts.jsx` | Eixo Y “Nível I…V”, rótulos romanos nos pontos, marcadores maiores + área de interação, tooltip HTML próprio (mês por extenso / estágio / nível romano / trimestre), altura medida por `ResizeObserver` (largura **e** altura, já sem a barra de rolagem), largura/altura inline do SVG, `PAD=72`, posições de mês e trimestre |
| `src/styles.css` | Bloco `.evolution-card` (fontes, cores, linha 3,5px, marcadores, alturas 280/262/300px, legenda), `.chart-tip`, peso 500 no Inter |
| `docs/DOCUMENTACAO_AVALIACAO_DIRETORES.md` | §12 (apresentação, layout) + este §16 |

### 16.7 Resultado dos testes e build (2026-10-15)

- `npm test` ✅ **66/66** (evolução mensal, rótulos de período, trimestres, `romanLevel`, observações, importação — nenhum teste alterado).
- `npm run build` ✅ (Vite/rolldown: `dist/` gerada; apenas o aviso já existente de chunk >500kB).
- Smoke de render (script temporário, removido após a checagem): eixo com “Nível I…V” e sem números arábicos; pontos com `I/II/III/IV/V` e sem “Nota”; marcadores `dot-quarter`/`dot-sel` e `dot-hit`; meses `MES/AAAA` e “1º trimestre de 2026”.
- **Não executado neste passo:** commit, push, atualização do GitHub, deploy/redeploy na Vercel, mudança de variáveis de ambiente.

---

## 17. Área de Pareceres do diretor e remoção do bloco antigo de observações (2026-10-15)

Nova área no topo da tela com os **dois pareceres do diretor** — **Parecer do Regional** e **Parecer de Operações** — exibidos **juntos, lado a lado e sem clique**, acima dos cards/indicadores. Em paralelo, o **selo “1 avaliação disponível”** e o **bloco de observações da lateral** foram removidos. **Nenhum dado do banco foi apagado**: a tabela `avaliacoes_diretores_observacoes` foi apenas estendida com a coluna `tipo`.

### 17.1 O que mudou na interface

| Antes | Depois (2026-10-15) |
|---|---|
| Selo “1 avaliação disponível” / “X avaliações disponíveis” no cabeçalho | **Removido** — o cabeçalho fica só com o bloco de identificação (sem espaço vazio) |
| Lateral: “Observação do regional” + textarea + dicas + **Salvar observação** + “Observações do regional” + lista + “Nenhuma observação registrada.” | **Removido** — a lateral termina no resumo do diretor e ganha `height:auto` (com `max-height` na viewport para a rolagem) |
| — | **Área “Pareceres do diretor”** no topo da área principal, antes dos cards/indicadores: dois `article` (Regional · Operações) lado a lado no desktop e empilhados (≤ 900px) no celular |

A função do formulário e da lista migrou para os cards de parecer (criar/editar/excluir/histórico). O feedback de upload/importação da lateral (`message`) foi mantido.

### 17.2 Regras de funcionamento

| Regra | Comportamento |
|---|---|
| Exibição | Só com **regional + diretor** selecionados; os dois pareceres carregam **automaticamente** (duas consultas em paralelo, sem clique). Sem diretor: apenas a mensagem discreta “Selecione um diretor para consultar os pareceres.” (nenhum card vazio) |
| Mais recente | Um diretor pode ter **vários** pareceres de cada tipo: o card mostra somente o **mais recente** (`created_at` desc, com o selo “mais recente”); os anteriores saem da tela mas **nunca são substituídos** |
| Novo parecer | Cria **mais um registro** (o anterior permanece no histórico e este passa a ser o exibido) |
| Editar | Altera **somente o texto** + `updated_at`; diretor, regional, tipo e avaliação **permanecem** (o cabeçalho do modal mostra o vínculo) |
| Excluir | **Exclusão lógica** (`arquivada_em`) com confirmação em modal de perigo; ao excluir o mais recente, o **anterior volta automaticamente**. `DELETE` físico continua bloqueado no RLS (sem política de DELETE) |
| Histórico | Modal **por tipo**, do mais recente para o mais antigo, **incluindo os excluídos** (com o rótulo “Excluído em …”) |
| Texto longo | No máximo **6 linhas** visíveis; se o texto ultrapassar aparece “Ver parecer completo” (e “Mostrar menos” para recolher). **Nada é cortado em definitivo** — o texto completo fica no banco e no histórico |
| Isolamento | Um parecer **nunca aparece para outro diretor**: filtro da consulta (`regional` + `diretor`) **e** checagem no cliente (`parecerVisivel`/`parecerPertence`), incluindo a conferência do `registro_id` quando o registro existe |
| Troca de seleção | Trocar regional/diretor limpa os pareceres anteriores **na hora** e um token descarta respostas atrasadas (a resposta de um diretor anterior nunca sobrescreve a tela) |
| Persistência | Dados no banco — os pareceres **permanecem após F5** |

Textos da interface: “Parecer do Regional” · “Parecer de Operações” · “mais recente” · “Avaliação: 3º tri/2026” · “Criado em 15/10/2026, 13:29” · “Atualizado em …” · “Carregando pareceres…” · “Nenhum parecer registrado.” · “Adicionar parecer” · “Novo parecer” · “Editar” · “Excluir” · “Histórico (2)” · “Ver parecer completo” · “Mostrar menos” · “Excluir parecer”.

### 17.3 Banco de dados

- **Migration aplicada** (`supabase/migrations/20261015100000_avaliacoes_diretores_observacoes_tipo_parecer.sql`): `alter table avaliacoes_diretores_observacoes add column if not exists tipo text` + `check (tipo in ('regional','operacoes'))` + índice `idx_avaliacoes_diretores_observacoes_tipo`. **`tipo = NULL`** identifica as observações comuns legadas (que **não** aparecem nos cards de parecer).
- **Tabela reaproveitada**: `avaliacoes_diretores_observacoes` (`escopo='diretor'`, `avaliacao_id`, `registro_id`, `regional`, `diretor`, `observacao`, `created_at`, `updated_at`, `arquivada_em`). `criado_por`/`atualizado_por` seguem `NULL` (sem autenticação nesta fase).
- **Vínculo ao criar**: mesma lógica das observações (`resolveObservacaoVinculo` = avaliação mais recente em que o diretor tem registro + `registro_id`).
- **Consulta sem trava de avaliação**: os pareceres são filtrados por `tipo + regional + diretor` (não por `avaliacao_id`), para que um parecer antigo continue visível mesmo após uma nova importação/publicação. A conferência de dono é feita no cliente quando o `registro_id` existe.
- **Grants `anon` conferidos**: `SELECT`/`INSERT` em todas as colunas e `UPDATE` apenas em `(observacao, arquivada_em, updated_at)` — suficiente para criar, editar e excluir (logicamente) pareceres.

### 17.4 Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/20261015100000_avaliacoes_diretores_observacoes_tipo_parecer.sql` | **novo** — coluna `tipo` + constraint + índice (aplicada no banco) |
| `src/services/pareceresService.js` | **novo** — `TIPOS_PARECER`, `TIPO_LABEL`, `ehTipoParecer`, `validarParecer`, `parecerFiltros`, `parecerPertence`, `parecerVisivel`, `parecerMaisRecente`, `parecerEditado`, `listPareceres`, `createParecer`, `updateParecer`, `archiveParecer` |
| `src/services/observacoesService.js` | `observacaoFiltros`/`observacaoVisivel` passam a **ignorar linhas com `tipo` preenchido** (pareceres nunca aparecem na lista antiga de observações) |
| `src/components/Pareceres.jsx` | **novo** — os dois cards, carregamento automático, editor (novo/editar), histórico por tipo, exclusão com `ConfirmModal` e clamp de 6 linhas |
| `src/App.jsx` | import/render de `<Pareceres/>` antes dos indicadores; remoção do selo, do bloco de observações da lateral, dos estados/funções associados e do `ConfirmModal` do app |
| `src/styles.css` | remoção das regras `.badge` e das regras mortas `.obs-*`; novos estilos `.parecer-*`/`.hist-*` (inclui `@media(max-width:900px)` para empilhar os cards); `.sidebar` com `height:auto` + `max-height` |
| `tests/unit/pareceres.test.mjs` | **novo** — regras puras (tipos, validação, filtros, visibilidade/pertencimento, mais recente, edição) |

### 17.5 Validações

- `npm test` ✅ **75/75** (74 anteriores + 1 novo de `parecerPertence`: o histórico mantém o arquivado, o card não).
- `npm run build` ✅ (Vite/rolldown: `dist/` gerada; apenas o aviso já existente de chunk >500kB).
- **Teste real de interface (Chrome headless via CDP, 26/26 verificações)** com **dois diretores reais** (regional AISLANE BELO — Adria Leitão Maia e Ana Tereza Marques), executado contra o build de produção:
  1. selo removido; 2. cabeçalho sem espaço vazio (1 filho, 84px); lateral sem o bloco antigo e terminando no resumo (404px); 3. carregamento automático dos dois pareceres (sem clique); 4. Regional + Operações juntos, larguras 607+607px, acima dos KPIs; 5. estado vazio correto; 6. novo parecer preserva o anterior (ambos os cards); 7. histórico do mais recente para o mais antigo; texto longo com 6 linhas + “Ver parecer completo”/“Mostrar menos”; 9. edição só do texto + “Atualizado em”; 10. exclusão lógica devolve o anterior; histórico preserva o excluído com “Excluído em”; 8/12. isolamento entre diretores na troca de seleção; 11. persistência após F5; layout celular (390px): cards empilhados, largura total e **sem rolagem horizontal**; **0 erros de console**.
- Prints da verificação: sem diretor, diretor sem pareceres, diretor com pareceres e celular 390px.
- **Dados**: os pareceres de teste criados durante a verificação foram **removidos ao final**; as 6 linhas de teste já existentes no banco (teclado, todas arquivadas, 15:57–16:00) permanecem **intocadas**.
- **Não executado neste passo:** commit, push, atualização do GitHub, deploy/redeploy na Vercel, mudança de variáveis de ambiente.

---

## 18. Prévia da atualização incremental pela planilha (2026-10-16)

Depois que o usuário seleciona uma planilha em “Atualizar pela planilha”, o sistema agora abre uma **prévia completa antes de gravar qualquer dado ou enviar o arquivo ao Storage**. A atualização incremental em si (criação da nova avaliação, gravação de registros/períodos/indicadores, preservação das avaliações anteriores e prioridade dos ajustes manuais) **não foi alterada** — a prévia é uma camada somente-leitura de comparação entre a análise local da planilha e o estado atual do sistema.

### 18.1 Fluxo da prévia

1. **Seleção do arquivo** → validação de extensão (.xlsx/.xls), tamanho (até 15 MB) e aba `Planilha1` (como antes).
2. **Análise local** da planilha em memória (nada de rede além da consulta de hash) + **hash SHA-256** consultado no banco apenas para reconhecer arquivo já importado.
3. **Comparação** com o modelo atual (períodos, diretores, unidades, ajustes manuais) montada por `src/services/previewService.js` (`buildUpdatePreview`) — função pura, sem gravação. Desde a regra definitiva (§21), o coração da prévia é **a mesma função `planejarAtualizacao`** (`src/services/importPlan.js`) que a gravação executa.
4. **Prévia aberta** com as seções abaixo; os botões são **Cancelar** e **Confirmar atualização**.
5. **Confirmar atualização** abre um resumo final em modal (registros novos/reutilizados/reativados/arquivados/ignorados, períodos novos, campos a completar, divergências mantidas, ajustes preservados, notas/indicadores, novas Regionais/diretores/unidades e pendências permitidas); só após “Sim, atualizar” roda `runImport` (agora orientado pelo plano — §21).
6. **Cancelar** fecha a prévia sem enviar arquivo, sem tocar no banco e sem afetar gráficos/indicadores.
7. Durante o processamento a interface mostra os estágios: *Salvando arquivo → Atualizando períodos → Atualizando indicadores → Atualizando cadastros → Concluído* (o duplo clique é bloqueado pelo estado `busy`).

### 18.2 Informações exibidas na prévia

| Seção | Conteúdo |
|---|---|
| Resumo (topo) | nome do arquivo, período mais recente encontrado, total de períodos identificados, registros, **diretores válidos**, unidades e a **referência atual × nova referência** dos indicadores (sem data/hora de análise nem logs técnicos) |
| **Registros (identidade Diretor + Unidade)** *(seção nova — §21)* | quantos registros serão **novos, reutilizados, reativados, arquivados e ignorados**, com listagem por nome (arquivados: “ausente da planilha; nada é apagado”; ignorados: linha sem diretor/unidade) |
| **Novos períodos** | cada período que ainda não existe no sistema, com contagem de registros com Status, com Nível e sem preenchimento (“Nenhum período novo encontrado.” quando não houver; nenhum período futuro é inventado) |
| **Informações que serão completadas** | só períodos **já existentes** cujo campo está **vazio no sistema** e passou a ter valor na planilha (diretor · unidade · período · campo: “Não informado → novo valor”). Status e Nível são tratados separadamente e um campo já preenchido nunca é substituído |
| **Divergências entre planilha e sistema** *(seção nova — §21)* | toda diferença (período, situação atual ou indicador) com os dois valores e a ação real: **atualizado** (o que muda) ou **mantido** (o que a prioridade preserva), com a origem (ajuste manual, valor importado, linha repetida etc.) |
| **Dados existentes preservados** | períodos que não serão regravados, registros preservados e ajustes manuais intactos (detalhe dos rótulos sob “Ver detalhes”, sem listar célula a célula) |
| **Ajustes manuais preservados** | frase fixa “Ajustes realizados no sistema têm prioridade e não serão substituídos pela planilha.”; nos detalhes: diretor, período, valor original importado e valor vigente ajustado |
| **Notas e indicadores** | quantidade de registros com atualização, referência mais recente encontrada e indicadores reconhecidos (Presencial, Acadêmico, Pós-graduação, Nota geral, Ritmo de captação, Crescimento de matrículas, Evasão, Avaliação institucional, EBITDA) — os valores por diretor ficam só em “Ver detalhes” e nunca se misturam com o histórico mensal de Status/Nível |
| **Novos cadastros e vínculos** | Regionais novas, diretores novos, unidades novas, diretores existentes, mudanças de Regional, mudanças de Unidade e registros sem diretor (nomes novos listados quando a quantidade é pequena; depois da confirmação os filtros são recarregados sem reiniciar o sistema) |
| **Pendências e alertas** | somente quando necessário: linha sem diretor (agora **ignorada**, §21), período sem Status e Nível, coluna opcional não reconhecida, duplicidade inconsistente, unidade ausente, indicador inválido, Status não reconhecido, Nível fora de I–V, **arquivo idêntico no mesmo período (bloqueia)**, arquivo idêntico em outro período (aviso), período aparentemente retroativo, conflito com ajuste manual, divergências mantidas |

### 18.3 Diferenças fundamentais (período novo × campo vazio × preservado)

- **Período novo**: rótulo da planilha cujo mês/ano **não existe** em nenhum período já cadastrado (comparação por mês/ano real, ex.: “SET/3TRI 2026” = SET/2026). Será **adicionado** na nova avaliação.
- **Campo vazio a completar**: o período **já existe** no sistema, mas o Status ou o Nível daquele diretor está vazio (“Não informado”) e a planilha agora traz valor. A planilha **nunca substitui** um campo já preenchido — o novo valor entra na nova avaliação e passa a ser a referência mais recente daquele mês.
- **Campo preservado**: período já existente com valor no sistema. Nenhuma linha atual é modificada (a importação é aditiva: nova avaliação + histórico repetido).

### 18.4 Proteção dos ajustes manuais

A regra já existente é mantida e agora fica **visível na prévia**: *ajuste manual ativo tem prioridade sobre valor repetido na nova planilha*. A prévia conta os ajustes ativos, mostra (em detalhes) o valor original da planilha × o valor vigente no sistema e sinaliza como pendência quando a nova planilha traz valor diferente de um ajuste. A confirmação da importação não altera `avaliacoes_diretores_ajustes`.

### 18.5 Arquivo idêntico

O hash SHA-256 passa a ser calculado **antes** da confirmação: se o arquivo for binariamente idêntico a uma avaliação já importada (com status diferente de `erro`) **no mesmo ano/trimestre**, a prévia exibe “Este mesmo arquivo já foi importado neste período.” e **impede** a atualização; idêntico em **outro** período é apenas aviso (“as avaliações anteriores permanecem intactas”). Uma nova versão legítima que repete o histórico e acrescenta um mês novo tem hash diferente e segue normalmente.

### 18.6 Referência dinâmica dos indicadores e novos cadastros

- A prévia mostra **Referência atual** (último período mensal já consolidado no sistema) e **Nova referência** (último período mensal válido reconhecido na nova planilha). Nenhum mês/ano é fixado no código e, depois da confirmação, o título da tela passa sozinho para “Indicadores de \<mês\> de \<ano\>”.
- As Regionais, diretores e unidades novos identificados na prévia entram no banco junto com os registros da nova avaliação e aparecem automaticamente nos filtros Regional e Diretor depois do recarregamento — sem listas fixas no código e sem reiniciar o sistema.

### 18.7 Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/services/previewService.js` | **novo** — `buildUpdatePreview` (comparação pura planilha × sistema) e `chavePeriodo`; nesta etapa: seções finalizadas, contagem de períodos identificados, registros preservados, Regionais novas, referência atual × nova e alertas de Status/Nível |
| `src/components/ImportDialog.jsx` | reescrito como **prévia + resumo final de confirmação** (mantém `runImport`, metadados e tela de sucesso) |
| `src/App.jsx` | `upload()` calcula o hash e consulta arquivos idênticos (leitura) antes de abrir a prévia; `ImportDialog` recebe `model` e `arquivosIguais` |
| `src/services/importService.js` | **somente acompanhamento de progresso**: estágios `Atualizando períodos`, `Atualizando indicadores` e `Atualizando cadastros` (nenhuma alteração no que é gravado nem na ordem) |
| `src/dataParser.js` | aditivo: `invalidMetricCells` (célula de indicador não numérica) para o alerta “indicador inválido” |
| `src/styles.css` | estilos aditivos `.pv-*` das seções da prévia |

### 18.8 Pendência: teste definitivo com a próxima planilha real

Ainda **não existe a planilha real do mês seguinte**, então **nada foi persistido no Supabase como simulação**: a validação da interface foi feita com uma **cópia local de desenvolvimento** (fixture temporária fora do repositório, com coluna fictícia de período futuro, um campo antigo vazio e um ajuste manual existente), verificando as classificações e o cancelamento antes de qualquer gravação. Na conclusão da prévia (Etapa 5) a cópia temporária foi revalidada **fora do repositório** com 16 verificações aprovadas (período novo, completados, preservados, ajuste protegido, novos cadastros, referência dinâmica, bloqueio de arquivo idêntico e ausência de qualquer acesso a rede/banco na prévia). O **teste definitivo será realizado quando chegar a planilha real do próximo mês** (nova importação real: períodos novos, completados, preservados e ajustes intactos).

## 19. Painel "Atualizar dados" (períodos, pontuações e indicadores) — 2026-10-16

O botão **Atualizar dados** da Matriz histórica (visível apenas com um diretor específico selecionado) abre um painel de edição manual que **não altera nenhum dado importado**: tudo que o usuário digita fica em estrutura própria, e o valor vigente é resolvido em tempo de leitura. O painel tem três seções: *Cadastrar novo período*, *Editar ou completar um período* e *Pontuações e indicadores*.

### 19.1 Períodos (seções 1 e 2 do painel)

- **Cadastrar**: Mês (jan–dez), Ano (4 dígitos, dentro da janela das avaliações), Status (lista do sistema + valores já importados) e Nível (I–V). Gera rótulo normalizado (`OUT/2026`; `DEZ/4TRI 2026` em mar/jun/set/dez), ordem cronológica automática (reposicionando os períodos seguintes) e origem `cadastro_manual` em `avaliacoes_diretores_periodos` (coluna `origem`, aplicada por migration).
- **Editar/completar**: seletor de período + Status/Nível. Mês e Ano são somente leitura; a alteração vira linha em `avaliacoes_diretores_ajustes` (mesma camada do botão "Editar" do gráfico), preservando o original da planilha.
- **Vigência exibida**: ajuste manual > cadastro manual > valor importado; planilha futura não sobrescreve valores manuais.

### 19.2 Pontuações e indicadores (seção 3 do painel) — novidade desta etapa

- **Campos** (nomes amigáveis iguais aos cards/radar/matriz): NOTAS — Presencial, Acadêmico, Pós-graduação, Nota geral, Avaliação institucional; PERCENTUAIS — Ritmo de captação, Crescimento de matrículas, Evasão, EBITDA.
- **Formatos**: notas aceitam vírgula ou ponto (sem faixa fixa — os dados reais são médias com várias casas); percentuais são digitados em **%** (10 = 10,0%) e gravados como **fração** (0.1), a mesma unidade do EAV e de `formatMetricCell` — nunca 1000%. Campo em branco **nunca vira zero**; só campos digitados **e diferentes do vigente** são gravados.
- **Banco**: nova tabela `avaliacoes_diretores_indicadores_ajustes` (migration `20261016140000`, aplicada): `avaliacao_id`, `registro_id`, `chave`, `valor_original` (capturado 1× do importado e **nunca** atualizado), `valor_manual`, `origem` (`cadastro_manual` sem valor importado / `edicao_manual` substituindo o importado), `arquivada_em` + índice único parcial por (`registro_id`, `chave`) ativo. Privégios/RLS no mesmo padrão provisório dos ajustes de período (select/insert; update apenas em `valor_manual, origem, atualizado_por, updated_at, arquivada_em`; sem delete).
- **Regra centralizada de vigência** (`buildDashboardModel`/`aplicarAjusteIndicadorNoModelo` em `dashboardService`): por registro e por chave — (1) ajuste do **próprio registro** vence; (2) senão o ajuste ativo mais recente do **mesmo diretor** em avaliação **anterior** (propagação apenas para planilhas futuras: a futura não sobrescreve o manual e o histórico anterior nunca é reescrito); (3) sem ajuste, valor importado. O registro guarda `metricas` (vigente), `metricasImportado` (auditável) e `metricasInfo` (origem/data por campo).
- **Painel**: cada campo mostra vigente + origem e aceita novo valor; chips de prévia `vigente → novo`; resumo com registro de destino, nº de alterações pendentes e última atualização manual. Erro explícito quando não há nada diferente para salvar.
- **Efeito em tempo real**: após a confirmação do banco o modelo é recalculado na hora (sem F5) — cards de indicadores, radar, médias consolidadas e colunas de indicadores da Matriz passam a exibir o valor manual. O histórico mensal de Status/Nível (evolução) não é afetado.

### 19.3 Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/20261016140000_avaliacoes_diretores_indicadores_ajustes.sql` | **novo** — tabela + índice único parcial + RLS/privégios provisórios (aplicada no projeto) |
| `src/services/indicadoresAjustesService.js` | **novo** — `CAMPOS_NOTA`/`CAMPOS_PERCENTUAL`, `parseValorIndicador`, `formatarEntradaIndicador`, `mesmoValorIndicador`, `salvarAjustesIndicadores` (atualiza a MESMA linha ativa; só grava campos alterados) |
| `src/services/dashboardService.js` | busca `ajustesIndicadores` no carregamento; regra centralizada (`contextoDeAjustesIndicadores`, `metricasDoRegistro`), `metricasImportado`/`metricasInfo` nos registros e `aplicarAjusteIndicadorNoModelo` |
| `src/components/PeriodosManuais.jsx` | seção "Pontuações e indicadores" (9 campos, prévia em chips, salvar pontuações) |
| `src/App.jsx` | `aposSalvarPeriodo` com o caso `tipo: 'indicadores'` (atualiza o modelo e mostra a mensagem) |
| `src/components/PerformanceMatrix.jsx` | texto do tooltip do botão "Atualizar dados" |
| `docs/DOCUMENTACAO_AVALIACAO_DIRETORES.md` | esta seção |

### 19.4 Validações

- Nenhum dado fictício foi gravado; nenhuma alteração em upload, pareceres, filtros, identidade visual ou no cadastro de Mês/Ano/Status/Nível aprovado; `src/styles.css` intocado (só classes CSS existentes).
- "Nota geral" vem **direto da coluna `GERAL`** da planilha (o parser não calcula): o sistema não inventa fórmula nova.
- Conversões conferidas com os dados reais do banco: percentuais guardados como fração (ex.: Evasão média 0.1378 → 13,8%), notas numa escala observada de ~1,7 a ~5,4 (por isso sem faixa fixa de validação).
- `npm run build` OK (`dist/assets/index-3eQUZHRT.js` 906,12 kB; apenas o aviso pré-existente de tamanho de chunk).

---

## 20. Limpeza dos dados operacionais para nova importação (2026-10-20)

Apagou-se **exclusivamente o conteúdo operacional** do módulo Avaliação de Diretores (testes, importações anteriores, duplicidades e cadastros manuais), deixando o módulo **vazio** para receber novamente a planilha completa correta. **Nenhuma estrutura foi alterada.**

### 20.1 Cópia de segurança técnica (pré-limpeza)

- Pasta local **`backup-limpeza-2026-10-20/`** (na raiz do projeto, fora do Git): um `.json` por tabela + cópias binárias dos 2 arquivos XLSX do bucket + `resumo-backup.json` (data, contagens, caminhos e tamanhos).
- **Sem credenciais** no backup (nenhuma chave, token ou senha; somente dados do módulo e nomes de arquivos).
- Os scripts temporários usados na cópia e na limpeza (`scripts/backup-limpeza.mjs` e `scripts/limpar-storage.mjs`) foram **removidos** ao final — nenhum arquivo novo permanece no repositório.

### 20.2 Tabelas limpas (todas do módulo) — linhas removidas

| Tabela | Linhas removidas | Estado final |
| --- | ---: | --- |
| `avaliacoes_diretores` (avaliações importadas) | 2 | 0 |
| `avaliacoes_diretores_registros` (diretores/unidades) | 122 | 0 |
| `avaliacoes_diretores_periodos` (períodos históricos) | 1.952 | 0 |
| `avaliacoes_diretores_indicadores` (indicadores importados) | 1.080 | 0 |
| `avaliacoes_diretores_ajustes` (ajustes manuais de teste) | 6 | 0 |
| `avaliacoes_diretores_indicadores_ajustes` | 0 (já vazia) | 0 |
| `avaliacoes_diretores_observacoes` (pareceres/justificativas) | 16 | 0 |
| **Total** | **3.178** | **0** |

Exclusão na ordem correta (filhos → pais: ajustes, indicadores e observações → períodos e indicadores → registros → avaliações). Como **todas** as linhas foram removidas, **não resta nenhuma duplicidade** criada pelas importações anteriores (contagens por combinação de `avaliacao_id`/`registro_id`/`rotulo_periodo` = 0).

### 20.3 Arquivos removidos do Storage (bucket `avaliacoes-diretores-planilhas`)

| Caminho removido | Tamanho |
| --- | ---: |
| `avaliacoes/2026/3/96564c52-e74d-4ca0-a682-e4aa7ec3cf26/1792527522609-3tri-2026-status-diretores-unidades-vs-3-1.xlsx` | 77.164 B |
| `avaliacoes/2026/3/cdb34a20-cdc6-416f-80f2-f70a2e8cc347/1791919005059-3tri-2026-status-diretores-unidades-vs-3.xlsx` | 78.744 B |

- Remoção feita **pela Storage API** (2 arquivos, 155.908 B), com uma política `DELETE` temporária criada apenas para a operação e **imediatamente removida** (verificado: 0 políticas temporárias depois) — **nenhuma política RLS permanece alterada**.
- **Bucket não foi excluído**; a listagem do bucket retorna **0 objetos**.

### 20.4 Estruturas preservadas (verificado por consulta ao banco)

| Item | Verificação |
| --- | --- |
| Tabelas (`public`) | 7 — todas mantidas, com colunas, `CHECK`, `DEFAULT` e `FK` intactos |
| RLS | habilitada nas 7 tabelas; **34 políticas** (públicas + storage) sem qualquer alteração permanente |
| Índices e `UNIQUE`/`CHECK` | preservados (nenhum `DROP`/`ALTER`) |
| Triggers | 10 (inclui `updated_at` do módulo e `protect_*` do storage) — intactos |
| Funções | 1 em `public` + funções do `storage` — intactas |
| Migrations | 8 registradas em `supabase_migrations` + arquivos em `supabase/migrations/` intocados |
| Bucket | presente, com limite de 15 MB e allowlist de MIME originais |
| Auth/usuários | `auth.users` intocado |
| Código, layout, assets, variáveis de ambiente, configurações | intocados (nenhum arquivo de `src/`, `public/`, `tests/` modificado) |
| Demais módulos do banco | nenhum objeto fora do módulo foi acessado ou alterado |

### 20.5 Estado final verificado (2026-10-20)

- **Zero** avaliações · **zero** registros (diretores/unidades) · **zero** períodos · **zero** indicadores · **zero** ajustes manuais (período e indicadores) · **zero** pareceres/observações · **zero** objetos no bucket · **zero** duplicidades.
- Tela em **estado vazio informativo** ("zero avaliações publicadas") com o **botão de upload / "Atualizar pela planilha" disponível** — comportamento já previsto no `App.jsx` quando não há avaliação publicada; **nenhuma alteração de layout ou funcionalidade** foi feita.
- **`npm run build` ✅** (`dist/` gerada; apenas o aviso pré-existente de chunks maiores que 500 kB).
- **Não executado:** `git add`, `commit`, `push`, atualização do GitHub, acesso/deploy na Vercel e mudança de variáveis de ambiente.

### 20.6 Próximo passo

**Importar a planilha completa correta** pelo fluxo "Atualizar pela planilha" (upload → prévia → confirmação), recriando do zero avaliação, registros, períodos e indicadores.

---

## 21. Regra definitiva de importação da Planilha1 — identidade, entidade e prioridades (2026-10-20)

Esta seção é a **fonte canônica** da regra que vale a partir do primeiro upload pós-limpeza (§20). Implementação única: `src/services/importPlan.js` (função pura `planejarAtualizacao`), consumida **tanto pela prévia** (`buildUpdatePreview` em `previewService.js`) **quanto pela gravação** (`runImport` em `importService.js` sobre leitura fresca `carregarBaseImportacao()`); a tela nunca promete algo diferente do que será escrito. Bancariamente, a migration `20261020150000_avaliacoes_diretores_importacao_entidade.sql` (coluna `arquivado_em`, grants por coluna, políticas UPDATE e triggers de invariantes) sustenta a mesma regra como defesa em profundidade.

### 21.1 Regra de identidade

- A chave de um registro é **(Diretor + Unidade) normalizados** — `chaveVinculo(d, u) = nameKey(d)|nameKey(u)` (espaços/quebras colapsados, caixa e acentos ignorados). **Nunca** `avaliacao_id`, número de linha, posição de coluna ou ordem de aparição.
- Linha **sem diretor** (ou **sem unidade**) é **IGNORADA** — não vira registro nem período; aparece na prévia como “Ignorada” e nas pendências.
- Períodos são identificados por mês/ano real (`chavePeriodo`, ex.: “SET/3TRI 2026” → `M:2026-09`); indicadores, por nome normalizado (com fallback pelo nome amigável).

### 21.2 Regra de arquivamento/reativação (registro = entidade)

| Situação da dupla na planilha | Ação |
|---|---|
| dupla já **ativa** no sistema | **REUTILIZA** o mesmo registro (mesmo `id`, histórico e ajustes; `avaliacao_id` permanece o da criação) |
| dupla **arquivada** que volta à planilha | **REATIVA** (`arquivado_em = null`) |
| dupla **ativa** ausente da planilha | **ARQUIVA** (`arquivado_em = agora`) — lógico, **nada é apagado**, a linha some dos dashboards |
| dupla **inexistente** | cria registro **NOVO** com o `avaliacao_id` desta importação |

- `avaliacao_id` é **atribuição de criação imutável** (trigger no banco); mudanças de situação (regional, código, status de gestão, ciclo de vida, nível atual) só entram quando o valor da planilha está **presente e diferente**.
- A base de comparação são as avaliações **`publicada`** (mesmo recorte dos dashboards); resíduos de importação `erro` ficam fora e nunca participam do vínculo. Nenhum `DELETE` existe no fluxo.

### 21.3 Prioridade de escrita (o que a planilha pode tocar)

Ordem de vigência: **1) ajuste manual > 2) cadastro manual > 3) valor importado > 4) nova planilha**. A planilha só escreve em:

1. **período NOVO** do registro (inserção com ordem cronológica — mesma regra do cadastro manual: vizinhos sem ano preservados, só a coluna `ordem` muda);
2. **campo VAZIO** de período existente (completar `estagio`/`nivel`; marcadores como “Não informado”/“-”/“n/d” contam como vazio — mesma semântica da trigger `avaliacoes_diretores_valor_vazio`);
3. **indicadores/notas** do registro existente → atualiza `valor_numerico`/`valor_texto` (**exceto** quando há ajuste manual ativo daquele campo — a prioridade manual vence e a diferença vira divergência mantida);
4. **situação atual** do registro (apenas valor presente e diferente);
5. **arquivamento/reativação** conforme §21.2 (dupla ausente/arquivada), independentemente de a planilha trazer o campo ou não.

Valor de período **já preenchido nunca é substituído**: a diferença aparece na prévia como **DIVERGÊNCIA mantida**.

### 21.4 Regra de divergências

Toda diferença planilha × sistema é listada com: registro (diretor · unidade), campo, valor do sistema, valor da planilha, **origem** (ajuste manual, valor importado, linha repetida na planilha, situação/planilha) e **ação**:

- `atualizado` — o que **muda** no banco (completar, indicador novo/alterado sem ajuste, situação atual, arquivar/reativar);
- `mantido` — o que a **prioridade preserva** (ajuste manual, valor já preenchido, cadastro manual).

A prévia informa a contagem de cada ação e as pendências derivadas (conflito com ajuste manual; divergências mantidas).

### 21.5 Prévia × execução (fonte única)

- **Prévia**: `buildUpdatePreview` chama `planejarAtualizacao({ base: baseDoModelo(model), analysis, meta })` — sem rede/banco.
- **Execução**: `runImport` → `carregarBaseImportacao()` (leitura fresca) → `planejarAtualizacao({ base, analysis, avaliacaoId })` → gravação por estágio (registros → períodos → indicadores → cadastros/situação → publicar).
- Estágios: *validando → salvando arquivo → salvando dados → atualizando períodos → atualizando indicadores → atualizando cadastros → concluído*; falha marca a avaliação `erro` com o estágio.

### 21.6 Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/services/importPlan.js` | **novo** — fonte única da regra (`planejarAtualizacao`, `chaveVinculo`, `chavePeriodo`, `statusLido`/`nivelLido`, `baseDoModelo`) |
| `src/services/previewService.js` | prévia reconstruída sobre o plano (seções **Registros** e **Divergências**, bloqueio de arquivo idêntico por período, pendências de ignoradas/arquivados) |
| `src/services/importService.js` | `runImport` passa a executar o **plano** (inserções + atualizações verificadas) em vez de inserção cega de snapshots |
| `src/services/avaliacoesService.js` | `carregarBaseImportacao`, `updatePeriodo`, `updateIndicador`, `updateRegistrosEmLote` (agrupamento por patch + checagem de linhas retornadas/RLS) |
| `src/services/dashboardService.js` | `buildDashboardModel` expõe `registrosArquivados`, `registros` ativos, registros com `arquivado` e indicadores com `id` |
| `src/components/ImportDialog.jsx` | seções novas na prévia, resumo de confirmação e tela de sucesso com os totais reais do plano |
| `src/App.jsx` | KPI/perfil “avaliações” = total publicado (registros são entidades reutilizadas — `avaliacao_id` não indica participação); “último período” usa a seleção atual |
| `supabase/migrations/20261020150000_avaliacoes_diretores_importacao_entidade.sql` | **aplicada em 2026-10-20 via MCP do Supabase** — `arquivado_em`, grants UPDATE por coluna, políticas UPDATE (registros/indicadores/**periodos**), triggers de invariantes |
| `tests/integration/fakeSupabase.mjs` | emulação de `.is(col, null)` (usado pela leitura fresca e pelos ajustes) |
| `docs/MODELO_DADOS_AVALIACOES_DIRETORES.md` | §2.2–§2.4 e §5.2 atualizados com a coluna/políticas/triggers |

### 21.7 Pendências antes do primeiro upload

1. ~~**Aplicar a migration** `20261020150000_avaliacoes_diretores_importacao_entidade.sql`~~ — **APLICADA em 2026-10-20 via MCP do Supabase** (ver §21.8). Coluna + grants + políticas + triggers ativos no projeto conectado.
2. **Primeiro upload real** pelo fluxo “Atualizar pela planilha”: com o banco vazio (§20), a primeira importação cria tudo como **registros novos**; a partir da segunda planilha valem reutilização, arquivamento/reativação, completar vazio e divergências (§21.2–§21.4).

### 21.8 Correção de incidente (2026-10-20) — dashboard não carregava

- **Causa confirmada:** o console reportava `column avaliacoes_diretores_registros.arquivado_em does not exist` e as consultas ao Supabase retornavam HTTP 400. A migration `20261020150000_avaliacoes_diretores_importacao_entidade.sql` existia localmente, mas **não tinha sido aplicada** ao projeto Supabase conectado — a coluna `arquivado_em` (`timestamptz null`) não existia na tabela `public.avaliacoes_diretores_registros`, embora `dashboardService.js` já a consultasse no `SELECT`.
- **Correção:** a migration pendente foi aplicada diretamente no banco conectado **pelo MCP do Supabase** (sem migration duplicada). A migration é aditiva e idempotente (`ADD COLUMN IF NOT EXISTS`); cria a coluna, grants UPDATE por coluna para `anon`, políticas UPDATE (registros/indicadores/periodos) e triggers de invariantes.
- **Preservação de dados:** nenhum registro foi apagado — os 61 registros existentes permanecem íntegros, todos com `arquivado_em = null` (nenhum arquivado automaticamente). Nenhuma outra tabela/módulo foi alterado.
- **Verificações pós-aplicação (via MCP):** coluna `arquivado_em` existe com tipo `timestamptz`, aceita `null`; a consulta do dashboard (`SELECT ... arquivado_em ...`) retorna linhas sem HTTP 400; políticas RLS de SELECT para `anon`/`authenticated` permanecem ativas.
- **Resultado:** o dashboard volta a carregar (Regionais, Diretores, Matriz Histórica, gráficos e indicadores), sem o erro de coluna no Console.
