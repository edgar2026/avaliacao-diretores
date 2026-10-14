# Avaliação de Diretores

SPA React + Vite (100% client-side) com Supabase — dashboards de desempenho dos diretores a partir de planilhas `.xlsx`/`.xls`, com importação pelo navegador, matriz histórica, evolução mensal, gráficos e observações do regional vinculadas ao diretor. Sem login (papel `anon` com RLS provisório), pronta para publicação na Vercel.

## Requisitos

- Node.js 20+ (testado com Node 24) e npm
- Um projeto Supabase com as migrations de `supabase/migrations/` aplicadas

## Instalação

```bash
npm install
cp .env.example .env   # e preencha com a URL e a chave pública do Supabase
```

## Execução local

```bash
npm run dev       # http://localhost:5173
```

## Build e preview de produção

```bash
npm run build     # gera a pasta dist/
npm run preview   # serve dist/ em http://localhost:4173
```

## Testes

```bash
npm test                  # unitários (66)
npm run test:integration  # integração (11) — usa o .env; somente leitura/fake
npm run test:all          # ambos
```

## Variáveis de ambiente

Somente variáveis **públicas** com prefixo `VITE_`, lidas via `import.meta.env`:

| Variável | Exemplo | Descrição |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `https://SEU-PROJETO.supabase.co` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | `SUA_CHAVE_PUBLICA_ANON` | chave publicável (anon/publishable) |

- Use **apenas** a chave anon/publishable. Nunca `service_role`, senha de banco ou token pessoal no frontend.
- Sem essas variáveis, a aplicação exibe mensagem clara de configuração ausente (não abre em branco).
- O arquivo `.env` é ignorado pelo Git; `.env.example` é versionado com placeholders.

> **AVISO DE SEGURANÇA:** Nunca versione o arquivo `.env` (contém a chave real) nem planilhas operacionais com dados de diretores. O `.gitignore` bloqueia `.env*` e todas as planilhas (`*.xlsx`, `*.xls`, `*.csv`). A planilha de exemplo em `tests/fixtures/` contém dados reais e permanece apenas local (não vai para o GitHub).

## Assets

| Arquivo | Uso |
| --- | --- |
| `public/assets/background-topografico.png` | fundo topográfico da interface |
| `public/assets/logo-diretores.png` | logo da lateral e favicon |

Ambos são copiados para `dist/assets/` no build. Planilhas de usuário ficam apenas no Supabase Storage — nenhuma planilha real vai para o repositório nem para o build (a de exemplo é fixture de teste em `tests/fixtures/`).

## Configuração na Vercel

Importe o repositório e use os valores padrão (o `vercel.json` já define tudo):

| Campo | Valor |
| --- | --- |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

Variáveis de ambiente (Settings → Environment Variables) nos ambientes **Production**, **Preview** e, quando necessário, **Development**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

O `vercel.json` configura o fallback de SPA (`/index.html` para rotas do frontend, sem reescrever `/assets/*`) e cabeçalhos básicos de segurança que não bloqueiam Supabase, Storage ou upload.

## Configuração no Supabase

1. Aplique as migrations de `supabase/migrations/` (estrutura, RLS e bucket de Storage).
2. O bucket do Storage precisa aceitar `xlsx`/`xls` (o frontend valida MIME antes do envio).
3. As políticas atuais são provisórias para o papel `anon` (sufixo `_anon_provisorio`) — revisar antes de ampliar o acesso.
4. O frontend usa somente a chave anon; nenhuma configuração administrativa é necessária no cliente.

## Como testar depois do deploy

1. Abra a URL da Vercel: a interface carrega com fundo, logo e favicon (sem tela branca).
2. Filtros de regional/diretor e os cards respondem com os dados publicados do Supabase.
3. Recarregue a página (F5) em qualquer rota: o conteúdo volta normalmente (fallback SPA).
4. Importe uma planilha de teste pelo botão “Atualizar pela planilha”, confirme a prévia e publique; recarregue e confirme que a avaliação permanece.
5. Registre, edite e exclua uma observação de um diretor e confirme o isolamento (a observação de um diretor nunca aparece para outro).
6. Confira gráficos (evolução mensal, radar), matriz histórica e o bloco de indicadores.

## Regras do arquivo

- Usa somente a aba `Planilha1`.
- Não possui filtro de unidade; tem visões Geral, Regional e Diretor.
- Detecta dinamicamente os pares de colunas de período e `NÍVEL` antes dos indicadores finais.
- Mantém todas as avaliações/períodos visíveis para comparação.
- Importa `.xlsx`/`.xls` pelo navegador e arquiva cada upload como uma avaliação única no Supabase (permanece após F5).
