/**
 * Configuração centralizada de ativação da autenticação.
 *
 * Controlada pela variável de ambiente pública `VITE_AUTH_ENABLED` ('true' | 'false').
 * - Quando `false`: o sistema opera em modo de acesso livre temporário (abre direto no dashboard).
 * - Quando `true`: o sistema exige login, primeiro acesso, perfis e proteção de rotas.
 */
export const AUTH_ENABLED: boolean = import.meta.env.VITE_AUTH_ENABLED === 'true';

export function isAuthEnabled(): boolean {
  return AUTH_ENABLED;
}
