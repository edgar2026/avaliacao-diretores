import React, { useState } from 'react';
import AuthLayout from '../components/AuthLayout.tsx';
import PasswordInput from '../components/PasswordInput.tsx';
import MockCaptcha from '../components/MockCaptcha.tsx';
import { loginUsuario } from '../services/authService.ts';
import type { AuthScreen } from '../types/auth.ts';

interface Props {
  email: string;
  onNavigate: (screen: AuthScreen) => void;
  onBack: () => void;
}

export default function LoginPage({ email, onNavigate, onBack }: Props) {
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!password) { setError('Informe a senha.'); return; }
    if (!captcha) { setError('Confirme a verificação de segurança.'); return; }
    setLoading(true);
    try {
      const result = await loginUsuario(email, password);
      if (!result.sucesso) {
        setError(result.erro || 'Falha ao autenticar.');
        return;
      }
      onNavigate('dashboard');
    } catch (err: any) {
      setError(err?.message || 'Erro inesperado ao realizar login.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout subtitle="Acesse com suas credenciais institucionais">
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-email-display">
          <span className="auth-email-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
            {email}
          </span>
          <button type="button" className="auth-link auth-link-sm" onClick={onBack}>
            Trocar e-mail
          </button>
        </div>

        <PasswordInput
          id="auth-login-pw"
          label="Senha"
          value={password}
          onChange={v => { setPassword(v); setError(''); }}
          placeholder="Digite sua senha"
          disabled={loading}
          autoComplete="current-password"
        />

        <MockCaptcha checked={captcha} onChange={setCaptcha} disabled={loading} />

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
          {loading ? <span className="auth-spinner" /> : 'Entrar'}
        </button>

        <div className="auth-links">
          <button type="button" className="auth-link" onClick={() => onNavigate('password-recovery')}>
            Esqueci minha senha
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
