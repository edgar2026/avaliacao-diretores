import React, { useState } from 'react';
import AuthLayout from '../components/AuthLayout.tsx';
import MockCaptcha from '../components/MockCaptcha.tsx';
import { solicitarRecuperacaoAdmin } from '../services/authService.ts';
import type { AuthScreen } from '../types/auth.ts';

interface Props {
  email: string;
  onNavigate: (screen: AuthScreen) => void;
  onBack: () => void;
}

export default function AdminRecoveryRequest({ email, onNavigate, onBack }: Props) {
  const [captcha, setCaptcha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!captcha) { setError('Confirme a verificação de segurança.'); return; }
    setLoading(true);
    try {
      await solicitarRecuperacaoAdmin(email);
      setSent(true);
    } catch (err: any) {
      setError(err?.message || 'Erro ao registrar solicitação.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Solicitação registrada"
        subtitle="Procure o administrador do sistema."
      >
        <div className="auth-form">
          <div className="auth-success-box">
            <div className="auth-success-icon-wrap">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#087f95" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <h2 className="auth-success-title">Solicitação registrada</h2>
            <p className="auth-success-text">
              Solicitação registrada. Procure o administrador do sistema para receber um código temporário de restauração de acesso.
            </p>
            <button type="button" className="auth-btn auth-btn-primary" onClick={onBack}>
              Voltar ao início
            </button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Recuperação administrativa"
      subtitle="Solicite o reset da senha à administração"
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-admin-info">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <div>
            <p>
              Se você não possui seus códigos pessoais de recuperação, a administração do sistema poderá emitir um código temporário para você restaurar seu acesso.
            </p>
            <p className="auth-admin-detail">
              A solicitação será associada ao e-mail <strong>{email}</strong>.
            </p>
          </div>
        </div>

        <MockCaptcha checked={captcha} onChange={setCaptcha} disabled={loading} />

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
          {loading ? <span className="auth-spinner" /> : 'Solicitar recuperação'}
        </button>

        <div className="auth-links">
          <button type="button" className="auth-link" onClick={onBack}>
            Voltar
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
