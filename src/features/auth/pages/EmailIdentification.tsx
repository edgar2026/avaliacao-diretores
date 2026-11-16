import React, { useState } from 'react';
import AuthLayout from '../components/AuthLayout.tsx';
import { isValidEmail } from '../utils/passwordValidation.ts';
import { identificarUsuario } from '../services/authService.ts';
import type { AuthScreen } from '../types/auth.ts';

interface Props {
  onNavigate: (screen: AuthScreen, email: string) => void;
}

export default function EmailIdentification({ onNavigate }: Props) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setError('Informe o e-mail institucional.'); return; }
    if (!isValidEmail(trimmed)) { setError('Formato de e-mail inválido.'); return; }
    setLoading(true);
    try {
      const result = await identificarUsuario(trimmed);
      if (!result.existe) {
        setError('E-mail ou credenciais não localizadas. Verifique o endereço digitado.');
      } else if (result.estado_acesso === 'bloqueado' || result.ativo === false) {
        setError('Conta inativa ou bloqueada. Entre em contato com a administração.');
      } else if (result.estado_acesso === 'pendente_primeiro_acesso' || !result.primeiro_acesso_concluido) {
        onNavigate('first-access', trimmed);
      } else if (result.estado_acesso === 'pendente_nova_senha') {
        onNavigate('recovery-admin', trimmed);
      } else {
        onNavigate('login', trimmed);
      }
    } catch (err: any) {
      setError(err?.message || 'Falha ao verificar e-mail. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout subtitle="Acesse com suas credenciais institucionais">
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-field">
          <label htmlFor="auth-email" className="auth-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="auth-field-icon"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
            E-mail
          </label>
          <input
            id="auth-email"
            type="email"
            className="auth-input"
            value={email}
            onChange={e => { setEmail(e.target.value); setError(''); }}
            placeholder="seu.email@ser.edu.br"
            disabled={loading}
            autoComplete="email"
            autoFocus
            aria-label="E-mail institucional"
          />
        </div>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
          {loading ? (
            <span className="auth-spinner" />
          ) : 'Continuar'}
        </button>
      </form>
    </AuthLayout>
  );
}
