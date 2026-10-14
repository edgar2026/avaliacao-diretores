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

| Camada | Arquivo | Papel |
| --- | --- | --- |
| Cliente Supabase | `src/services/supabaseClient.js` | Lê `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`; cria o cliente **uma vez**, sem persistir sessão |
| Validação de arquivo | `src/services/fileValidator.js` | Extensão, tamanho (15 MB), mensagens de erro |
| Hash | `src/services/hashService.js` | SHA-256 do arquivo via `crypto.subtle` (Web Crypto) |
| Storage | `src/services/storageService.js` | Convenção de caminho, nome seguro, content-type e upload sem sobrescrita |
| Persistência | `src/services/avaliacoesService.js` | Avaliação, registros, períodos, indicadores (lotes de 500) e checagem de duplicidade por hash |
| Orquestração | `src/services/importService.js` | Fluxo completo, estágios, `ImportError` com estágio/código |
| Leitura dos dashboards | `src/services/dashboardService.js` | Carrega **somente** avaliações `publicada` (avaliações + registros + períodos + indicadores, em lotes/paginação — sem N+1) e monta o modelo de comparação |
| Parser/análise | `src/dataParser.js` | `analyzeWorkbookBuffer` (prévia), `analysisToDataset` e os matchers de indicadores compartilhados com o dashboard |
| UI | `src/components/ImportDialog.jsx` | Prévia, metadados, progresso, sucesso/erro |
| Upload | `src/App.jsx` | `upload()` → análise → diálogo → `runImport`; dashboards alimentados pelo Supabase |

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
7. `INSERT` em lote (500 por requisição) de:
   - `avaliacoes_diretores_registros` — uma linha por diretor/unidade;
   - `avaliacoes_diretores_periodos` — um par estágio+nível por período da planilha;
   - `avaliacoes_diretores_indicadores` — EAV dinâmico: qualquer coluna de indicador detectada (`PRESENCIAL`, `EBITDA`, `%` etc.), com `valor_numerico` ou `valor_texto`.
8. `UPDATE` final: `status = 'publicada'`, `publicado_em`, totais.
9. **Falha em qualquer estágio**: a avaliação recebe `status = 'erro'` e `erro_detalhe` descreve o estágio; nada é apagado.

---

## 5. Segurança (fase provisória)

O protótipo **não tem login**. Para funcionar, a migration `20261013180000_avaliacoes_diretores_acesso_anon_provisorio.sql` concede acesso ao papel `anon` **apenas aos recursos do módulo**:

| Recurso | `anon` pode |
| --- | --- |
| 5 tabelas do módulo | `SELECT` e `INSERT` |
| `avaliacoes_diretores` | `UPDATE` apenas de colunas do fluxo (`storage_*`, `arquivo_nome_original`, `total_*`, `status`, `publicado_em`, `erro_detalhe`) e apenas quando `status = 'processando'` → `publicada`/`erro` |
| Bucket `avaliacoes-diretores-planilhas` | `SELECT` e `INSERT` (upload) |
| Qualquer coisa fora disso | ❌ — nada (sem DELETE, sem sobrescrita, sem outras tabelas/buckets) |

Todas as políticas `anon` têm sufixo `_anon_provisorio` e comentário `PROVISÓRIO`: **ao integrar ao sistema maior, devem ser removidas e substituídas** por políticas de usuário autenticado. `service_role` nunca é usado no frontend.

Limitações conhecidas da fase provisória:

- Qualquer visitante com a URL + chave anon pode importar planilhas (mitigado pela unicidade de hash, pelo limite de 15 MB e pela ausência de DELETE).
- O bucket valida MIME, não extensão (o content-type é derivado da extensão no cliente).
- `auth.uid()` é nulo sem login: `importado_por` fica `NULL`.

---

## 6. Testes e build

```bash
npm test                  # unitários (node:test, sem rede)
npm run test:integration  # integração (dashboard/RLS no Supabase real; importação via fake)
npm run build             # vite build
```

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
- **Comparações**: por avaliação (título · Ttri/ano · nome real do arquivo · diretores · unidades · nível médio); seleção vs consolidado geral (radar); e **“Evolução mensal do diretor”** — **uma única série** (o diretor selecionado; sem consolidado regional nem consolidado geral), eixo X **mensal, pelos cabeçalhos REAIS da planilha** reconhecidos por `parseMonthHeader`/`buildMonthlyLabelMap`/`buildDirectorMonthlyEvolution` (`dashboardService.js`): nome de mês (`JULHO`), data (`JAN DE 2026`, `01/01/2026`) e fechamento de trimestre (`2TRI/25`, `SET/3TRI`, `MAR/1TRI 2026`) viram `MES/AAAA` — com a planilha atual exibe exatamente 16 meses (`JUN/2025` … `SET/2026`), nunca além de SET/2026 e **sem nenhum rótulo `/85` ou data inventada** (ano ausente é inferido na ordem cronológica; ano fora da janela das avaliações é descartado; ano nunca é lido de notas, percentuais ou valores de células). O gráfico **começa no primeiro mês com status ou nível válido daquele diretor** (meses anteriores ficam ocultos) e segue até o último período real da avaliação; lacuna posterior mantém o mês no eixo **sem ponto, sem zero e sem repetição do valor** (linha interrompida). Fechamentos trimestrais usam **marcador dourado maior com contorno**, rótulo “Nº trimestre de AAAA” abaixo do mês e um único ponto. Conversão de níveis via `romanLevel` com **correspondência exata** (mapa I–V, sem reconhecimento parcial de IV como I ou V); **largura responsiva** — `ResizeObserver` mede o container e o gap entre pontos é recalculado dinamicamente para ocupar toda a largura do card (sem rolagem horizontal em resoluções ≥ ~700 px); nível numérico fixo acima de cada ponto, ausência = quebra na linha (nunca 0) e tooltip com mês/ano, status, nível romano, nível numérico e trimestre.
- **Layout**: **uma única rolagem vertical** da página; lateral simplificada (marca, atualização pela planilha, Regional, Diretor, resumo da seleção, observação e salvar); blocos empilhados em largura total, nesta ordem: **Histórico das avaliações → Evolução mensal do diretor (somente com diretor selecionado) → Comparação de desempenho → Indicadores → Matriz histórica de desempenho**; gráficos com ~430px no desktop (~380px no mobile); radar ampliado e centralizado com legenda abaixo.
- **Matriz histórica de desempenho** (`src/components/PerformanceMatrix.jsx`): substitui a antiga “Detalhes da seleção” e reproduz a planilha original. Colunas congeladas (Regional · Diretor · Unidade) com rolagem horizontal; **histórico dinâmico** — cada período armazenado vira duas colunas (Status = `periodo.estagio` · Nível = `periodo.nivel`), em ordem (avaliação, `ordem`), rótulo composto quando repetido entre avaliações; **bloco final** separado (Status de gestão = `statusGestao` · Ciclo de vida = `cicloVida` · Nível da unidade = `nivelAtual`) seguido dos 9 indicadores (EAV amigável; ausência = “—”, nunca 0) e de indicadores extras futuros em dinâmico. **8 filtros locais** combinados por AND (Regional, Diretor, Unidade, Período, Status trimestral, Nível, Status de gestão, Ciclo de vida) + “Limpar filtros” + contador “X de Y registros”; o filtro **Período** delimita a casca em que Status trimestral/Nível valem. Helpers puros testáveis em `dashboardService.js` (`matrixPeriodColumns`, `filterMatrixRows`, `formatMetricCell`, `MATRIX_INDICATORS`). Sem mapa de calor nesta etapa.
- **Estados de tela**: carregando; erro de consulta (com “Tentar novamente”); **vazio informativo** quando não há avaliação publicada; **Error Boundary** (`src/components/ErrorBoundary.jsx`) envolvendo a área principal — um erro de renderização (ex.: gráfico falhando com dados inesperados) mostra um estado de erro recuperável em vez de derrubar o app.
- **Contrato de métricas**: o modelo do Supabase expõe `metricas` (português); os gráficos leem `r?.metricas?.[n]` com acesso defensivo a `null`/`undefined`.
- **Textos da interface**: sem nomes técnicos de banco/auth na tela (“Supabase”, “login”, “anon”, “publicadas”, “Planilha1”, nomes de variáveis); erros vindos do parser/serviços são traduzidos na exibição pelo helper `humanError` (em `App.jsx` e `ImportDialog.jsx`). O selo no topo exibe “1 avaliação disponível” / “X avaliações disponíveis”.
- **Observações (CRUD completo no banco, vinculadas ao diretor)**: salvas em `avaliacoes_diretores_observacoes` via `observacoesService.js`; **localStorage removido**. **Regra definitiva**: a observação é registrada pelo regional, mas **vinculada exclusivamente ao diretor selecionado** dentro da avaliação correspondente — e **somente é exibida quando o mesmo diretor está selecionado** (nunca para outro diretor da mesma regional). O formulário e a lista ("Observação do regional" / "Observações do regional") só existem com **regional + diretor** selecionados: sem regional a mensagem é "Selecione uma regional e um diretor para registrar ou consultar observações."; com regional e sem diretor é "Selecione um diretor para registrar ou consultar observações." (campo desabilitado, **Salvar observação** desabilitado e lista oculta nos dois casos). Criar: valida texto + regional + diretor → localiza o vínculo (avaliação mais recente em que o diretor tem registro + `registro_id`) → insere com `escopo='diretor'`, `avaliacao_id`, `registro_id`, `regional`, `diretor`, `criado_por`/`atualizado_por` `NULL` → aguarda confirmação do banco → limpa campo → "Observação salva com sucesso." → recarrega lista. Listar: prioridade `registro_id` → `avaliacao_id` → `escopo='diretor'` → não arquivadas, com regional e diretor como confirmação; **nunca consulta somente pela regional**; troca de regional/diretor limpa a lista na hora e descarta respostas atrasadas (token de requisição). Cada cartão mostra **diretor, regional, avaliação (ex.: 3º tri/2026), data/horário, texto, Editar e Excluir**; lista ordenada por data decrescente com as 3 mais recentes e "Ver todas". Editar: atualiza só `observacao` + `updated_at` pelo id (**vínculo preservado**) → "Observação atualizada com sucesso.". Excluir: exclusão lógica (`arquivada_em`; `DELETE` físico bloqueado no RLS) → "Observação excluída com sucesso."; arquivadas não aparecem. Persiste após F5 (dados no banco).

---

## 8. Estado do banco (dados reais)

- **Estado atual**: o módulo contém **1 avaliação publicada** — `3TRI 2026 - STATUS DIRETORES UNIDADES` (3º tri/2026, 61 registros, 60 diretores válidos, 60 unidades), importada manualmente pelo usuário. As avaliações de teste automatizado anteriores (incluindo as resíduas `erro`) haviam sido **removidas** na limpeza da seção 11 do diagnóstico.
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
- **Apresentação**: título **“Evolução mensal do diretor”** + subtítulo **“Acompanhamento mensal do nível, com destaque para os fechamentos trimestrais.”**; nível numérico fixo sobre cada ponto válido; eixo X em `MES/AAAA` (ex.: SET/2026); tooltip com **mês/ano**, **status daquele período**, **nível romano**, **nível numérico** e **trimestre quando aplicável**; legenda apenas **“Evolução mensal”** e **“Fechamento trimestral”**.
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
