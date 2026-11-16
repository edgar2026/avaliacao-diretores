import React, { useState } from 'react';
import AuthLayout from '../components/AuthLayout.tsx';
import PasswordInput from '../components/PasswordInput.tsx';
import PasswordRequirements from '../components/PasswordRequirements.tsx';
import PasswordStrengthMeter from '../components/PasswordStrengthMeter.tsx';
import MockCaptcha from '../components/MockCaptcha.tsx';
import { checkRequirements } from '../utils/passwordValidation.ts';
import { concluirPrimeiroAcessoSemCodigo } from '../services/authService.ts';
import type { AuthScreen } from '../types/auth.ts';

interface Props {
  email: string;
  onNavigate: (screen: AuthScreen, codes?: string[], password?: string) => void;
  onBack?: () => void;
}

export default function FirstAccessPage({ email, onNavigate, onBack }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [captcha, setCaptcha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const allMet = checkRequirements(password).every(r => r.met);
  const match = password === confirm && confirm.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!allMet) { setError('A senha não atende a todos os requisitos de segurança.'); return; }
    if (!match) { setError('As senhas não coincidem.'); return; }
    if (!captcha) { setError('Confirme a verificação de segurança.'); return; }
    setLoading(true);
    try {
      const result = await concluirPrimeiroAcessoSemCodigo(email, password);
      if (!result.sucesso) {
        setError(result.erro || 'Falha ao concluir primeiro acesso.');
        return;
      }
      onNavigate('recovery-codes', result.codigos_recuperacao || [], password);
    } catch (err: any) {
      setError(err?.message || 'Erro inesperado ao ativar a conta.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Primeiro acesso"
      subtitle="Crie sua senha para concluir o primeiro acesso."
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-email-display">
          <span className="auth-email-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
            {email}
          </span>
          {onBack && (
            <button type="button" className="auth-link auth-link-sm" onClick={onBack}>
              Trocar e-mail
            </button>
          )}
        </div>

        <PasswordInput
          id="auth-fa-pw"
          label="Nova senha"
          value={password}
          onChange={v => { setPassword(v); setError(''); }}
          placeholder="Crie sua senha"
          disabled={loading}
          autoComplete="new-password"
        />

        <PasswordStrengthMeter password={password} />
        <PasswordRequirements password={password} />

        <PasswordInput
          id="auth-fa-confirm"
          label="Confirmar nova senha"
          value={confirm}
          onChange={v => { setConfirm(v); setError(''); }}
          placeholder="Repita a senha"
          disabled={loading}
          autoComplete="new-password"
        />

        {confirm && !match && (
          <div className="auth-mismatch">As senhas não coincidem.</div>
        )}

        <MockCaptcha checked={captcha} onChange={setCaptcha} disabled={loading} />

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
          {loading ? <span className="auth-spinner" /> : 'Criar senha'}
        </button>
      </form>
    </AuthLayout>
  );
}
