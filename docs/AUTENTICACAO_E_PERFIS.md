# Sistema de Avaliação de Diretores: Autenticação, Perfis e Controle de Acesso

Documento consolidado de especificação, arquitetura e operação do fluxo de acesso seguro ao Sistema de Avaliação de Diretores.

---

## 1. Visão Geral da Arquitetura de Segurança

A autenticação e autorização do sistema foram implementadas diretamente sobre a infraestrutura do **Supabase** (Postgres + Supabase Auth), garantindo:
- **Zero armazenamento de credenciais em texto puro**: Senhas e códigos de uso único são armazenados exclusivamente como hashes criptográficos (`bcrypt` para senhas e `SHA-256` para códigos).
- **Primeiro acesso direto e sem código**: O usuário previamente cadastrado pelo Admin informa seu e-mail e cria a própria senha, sem necessidade de código temporário, e-mail de ativação, OTP ou link mágico.
- **Códigos pessoais autônomos**: Após a criação da senha inicial ou recuperação, o sistema gera exatamente 8 códigos pessoais de uso único para recuperação de senha sem depender do Administrador.
- **Recuperação administrativa excepcional**: O código temporário de 30 minutos gerado pelo Administrador é reservado exclusivamente para os casos em que o usuário esqueceu a senha e perdeu todos os 8 códigos de recuperação.
- **Menor privilégio e isolamento (RLS)**: Cada perfil visualiza e atua apenas no escopo autorizado no banco e na interface.
- **Proteção contra bots (CAPTCHA)**: Integração com Cloudflare Turnstile oficial via Site Key parametrizável no frontend e validação nativa.

---

## 2. Estrutura de Banco de Dados (Schema `public`)

### 2.1. Tabela `public.perfis`
Vinculada 1:1 a `auth.users(id)`:
- `id`: UUID (PK).
- `user_id`: UUID (FK `auth.users.id`, UNIQUE, on delete cascade).
- `nome`: Nome completo do colaborador.
- `email`: E-mail institucional (UNIQUE, normalizado em minúsculas).
- `perfil`: `diretor` | `regional` | `executivo` | `admin`.
- `regional_id`: Regional vinculada (opcional/obrigatória para regionais).
- `unidade_id`: Unidade vinculada (obrigatória para diretores).
- `diretor_id`: Nome do diretor vinculado.
- `ativo`: Booleano indicando situação geral da conta.
- `estado_acesso`:
  - `pendente_primeiro_acesso`: Conta cadastrada pelo Admin aguardando criação da primeira senha.
  - `ativo`: Conta operando normalmente.
  - `recuperacao_solicitada`: Usuário solicitou reset à administração por perda dos códigos.
  - `pendente_nova_senha`: Admin emitiu código temporário excepcional de restauração.
  - `inativo`: Conta desativada.
  - `bloqueado`: Conta suspensa por segurança.
- `primeiro_acesso_concluido`: Booleano indicando se a senha inicial já foi criada.
- `criado_em`, `atualizado_em`, `ativado_em`, `ultimo_acesso_em`, `senha_redefinida_em`.

### 2.2. Tabela `public.codigos_recuperacao`
- Armazena os **8 códigos pessoais de recuperação** por usuário.
- `codigo_hash`: Hash SHA-256 do código formatado (`XXXX-XXXX-XXXX`).
- `tentativas`: Contador de tentativas incorretas (máximo de 5 antes de invalidação).
- `usado_em`, `revogado_em`: Timestamps de controle de uso único.

### 2.3. Tabela `public.codigos_temporarios`
- Armazena os códigos de 30 minutos gerados pelo Admin para restauração administrativa de acesso.
- `codigo_hash`: Hash SHA-256 do código formatado (`XXXX-XXXX`).
- `tipo`: `recuperacao_admin`.
- `expira_em`: Validade de 30 minutos a partir da emissão.
- `tentativas`: Máximo de 5 tentativas.
- `usado_em`, `revogado_em`, `criado_por`.

### 2.4. Tabela `public.solicitacoes_recuperacao`
- Registro quando o usuário não possui códigos pessoais de recuperação.
- `user_id`, `email`, `situacao` (`pendente`, `atendida`, `recusada`, `cancelada`), `admin_responsavel`, `resolvido_em`.

### 2.5. Tabela `public.auditoria_autenticacao`
- Log imutável de eventos: criação de usuário, primeiro acesso concluído, logins, solicitações de recuperação, emissão de códigos temporários, reset lógico, bloqueios e alterações de perfil.

---

## 3. Matriz de Perfis e Permissões

| Perfil | Escopo de Dados | Matrizes (Ninebox / Risco) | Upload Planilha | Gerenciar Usuários |
| :--- | :--- | :---: | :---: | :---: |
| **Diretor** | Somente a própria Unidade vinculada | ❌ Bloqueado | ❌ Bloqueado | ❌ Bloqueado |
| **Regional** | Unidades e Diretores da Regional | ❌ Bloqueado | ✅ Permitido | ❌ Bloqueado |
| **Executivo** | Todas as Regionais e Unidades | ✅ Permitido | ✅ Permitido | ❌ Bloqueado |
| **Admin** | Acesso Global Completo | ✅ Permitido | ✅ Permitido | ✅ Permitido |

---

## 4. Fluxos de Acesso Operacionais

### 4.1. Primeiro Acesso (Sem Código)
1. Usuário digita seu e-mail institucional na tela de identificação.
2. O sistema consulta `rpc_identificar_usuario` e constata `estado_acesso = 'pendente_primeiro_acesso'`.
3. Abre diretamente a tela **“Primeiro acesso”** com o subtítulo: *“Crie sua senha para concluir o primeiro acesso.”* (sem campo de código).
4. O usuário cria e confirma a senha conforme os requisitos:
   - Mínimo de 8 caracteres;
   - Ao menos 1 maiúscula, 1 minúscula, 1 número e 1 caractere especial;
   - Sem espaços;
   - Senhas idênticas.
5. Resolve o CAPTCHA e clica em **Criar senha**.
6. A RPC `rpc_concluir_primeiro_acesso`:
   - Encripta a senha no `auth.users` via `bcrypt`;
   - Atualiza `primeiro_acesso_concluido = true`, `estado_acesso = 'ativo'`, `ativado_em = now()`;
   - Invalida eventuais códigos temporários remanescentes;
   - Gera exatamente 8 códigos pessoais criptograficamente seguros e armazena os respectivos hashes SHA-256;
   - Registra auditoria;
   - Retorna os 8 códigos originais em tela.
7. O sistema abre a tela **“Códigos de recuperação”**.
8. O usuário pode copiar ou baixar o arquivo `.txt` seguro e marca a caixa de confirmação: *“Confirmo que salvei meus códigos de recuperação em local seguro.”*.
9. Ao clicar em **“Continuar para o sistema”**, o acesso ao Dashboard é liberado.

### 4.2. Login Normal
1. Usuário informa e-mail institucional, senha e resolve o CAPTCHA.
2. `loginUsuario` autentica a credencial via Supabase Auth.
3. Valida se o perfil está ativo e não bloqueado.
4. Sessão persistente inicia e o sistema é exibido conforme a matriz de permissões.

### 4.3. Recuperação Autônoma com Código Pessoal (Esqueci minha senha)
1. Usuário clica em **“Esqueci minha senha”** e abre **“Recuperar acesso”**.
2. Informa um dos seus 8 códigos pessoais (`XXXX-XXXX-XXXX`).
3. Digita a nova senha, confirmação e resolve o CAPTCHA.
4. A RPC `rpc_recuperar_senha_codigo`:
   - Valida o hash do código, consumo e limite de tentativas;
   - Atualiza a senha no Auth;
   - Consome o código utilizado e revoga os outros 7 códigos do conjunto anterior;
   - Gera 8 novos códigos pessoais de recuperação e retorna para exibição única;
   - Atualiza `senha_redefinida_em = now()`.
5. Usuário confirma o salvamento dos novos códigos e continua para o sistema.

### 4.4. Recuperação Administrativa Excepcional (Restaurar Acesso)
1. Usuário que esqueceu a senha e perdeu todos os códigos clica em **“Não tenho meu código de recuperação”**.
2. Preenche o formulário de solicitação administrativa com CAPTCHA.
3. O Admin visualiza a solicitação na aba **Solicitações de Recuperação** na tela **Gerenciar Usuários**.
4. O Admin clica em **Gerar código temporário**, que gera um código temporário de 30 minutos de uso único.
5. O usuário recebe o código do Admin e, ao digitar seu e-mail, é direcionado à tela **“Restaurar acesso”** (`recovery-admin`).
6. A tela solicita o código temporário, a nova senha, confirmação e CAPTCHA.
7. A RPC `rpc_restaurar_acesso_admin` valida o código, define a nova senha, consome o código temporário, reativa a conta e gera 8 novos códigos pessoais de recuperação.

---

## 5. Administrador Principal

- **Nome**: Edgar Tavares do Espirito Santo
- **E-mail**: `edgar.tavares@mauriciodenassau.edu.br`
- **Perfil**: `admin`
- **User ID**: `ef5c6a2d-3b36-4ae0-a291-fa1230473027`
- **Estado de Acesso**: `pendente_primeiro_acesso`
- **Primeiro Acesso Concluído**: `false`

---

## 6. Procedimento de Reset Lógico de Usuário para Novo Teste

Para retornar um usuário ao estado de primeiro acesso limpo, preservando seus vínculos, ID e dados históricos:

```sql
DO $$
DECLARE
  v_uid uuid := 'ef5c6a2d-3b36-4ae0-a291-fa1230473027'; -- user_id do usuário
BEGIN
  -- 1. Resetar perfil
  UPDATE public.perfis
  SET perfil = 'admin',
      ativo = true,
      estado_acesso = 'pendente_primeiro_acesso',
      primeiro_acesso_concluido = false,
      ativado_em = null,
      senha_redefinida_em = null,
      ultimo_acesso_em = null,
      atualizado_em = now()
  WHERE user_id = v_uid;

  -- 2. Atribuir senha criptográfica imprevisível (força novo primeiro acesso)
  UPDATE auth.users
  SET encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf')),
      updated_at = now()
  WHERE id = v_uid;

  -- 3. Revogar todos os códigos temporários e de recuperação
  UPDATE public.codigos_temporarios SET revogado_em = now() WHERE user_id = v_uid AND revogado_em IS NULL;
  UPDATE public.codigos_recuperacao SET revogado_em = now() WHERE user_id = v_uid AND revogado_em IS NULL;
  UPDATE public.solicitacoes_recuperacao SET situacao = 'cancelada' WHERE user_id = v_uid AND situacao = 'pendente';

  -- 4. Encerrar sessões ativas
  DELETE FROM auth.sessions WHERE user_id = v_uid;

  -- 5. Registrar auditoria do reset
  INSERT INTO public.auditoria_autenticacao (usuario_responsavel, usuario_afetado, acao, resultado, detalhes)
  VALUES (v_uid, v_uid, 'reset_logico_primeiro_acesso', 'sucesso', jsonb_build_object('motivo', 'novo_teste'));
END $$;
```

---

## 7. Variáveis de Ambiente Necessárias

- `VITE_SUPABASE_URL`: URL pública do projeto Supabase.
- `VITE_SUPABASE_ANON_KEY`: Chave anônima publicável.
- `VITE_TURNSTILE_SITE_KEY`: Chave do site do Cloudflare Turnstile.
