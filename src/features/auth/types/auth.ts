// Tipos do fluxo de autenticação e perfis integrados ao Supabase

export type TipoPerfil = 'diretor' | 'regional' | 'executivo' | 'admin';

export type EstadoAcesso =
  | 'pendente_primeiro_acesso'
  | 'ativo'
  | 'recuperacao_solicitada'
  | 'pendente_nova_senha'
  | 'inativo'
  | 'bloqueado'
  | 'inexistente'
  | 'erro';

export interface PerfilUsuario {
  id: string;
  user_id: string;
  nome: string;
  email: string;
  perfil: TipoPerfil;
  regional_id?: string | null;
  unidade_id?: string | null;
  diretor_id?: string | null;
  ativo?: boolean;
  estado_acesso: EstadoAcesso;
  primeiro_acesso_concluido: boolean;
  bloqueado?: boolean;
  criado_em?: string;
  ativado_em?: string | null;
  ultimo_acesso_em?: string | null;
}

export type AuthScreen =
  | 'identify'
  | 'sign-in'
  | 'first-access'
  | 'recovery-personal'
  | 'recovery-request'
  | 'recovery-admin'
  | 'recovery-codes'
  | 'authenticated'
  // Legados / Aliases
  | 'email'
  | 'login'
  | 'password-recovery'
  | 'admin-recovery'
  | 'success'
  | 'dashboard'
  | 'usuarios';

export interface AuthState {
  screen: AuthScreen;
  email: string;
  loading: boolean;
  error: string;
  successMessage: string;
}

export interface PasswordRequirement {
  label: string;
  met: boolean;
}

export interface IdentificacaoResult {
  existe: boolean;
  ativo?: boolean;
  nome?: string;
  email?: string;
  perfil?: TipoPerfil;
  estado_acesso: EstadoAcesso;
  primeiro_acesso_concluido: boolean;
  mensagem?: string;
}

export interface PrimeiroAcessoResult {
  sucesso: boolean;
  erro?: string;
  codigos_recuperacao?: string[];
}

export interface RecuperacaoCodigoResult {
  sucesso: boolean;
  erro?: string;
  codigos_recuperacao?: string[];
}
