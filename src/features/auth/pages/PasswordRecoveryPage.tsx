import React, { useState } from 'react';
import AuthLayout from '../components/AuthLayout.tsx';
import PasswordInput from '../components/PasswordInput.tsx';
import PasswordRequirements from '../components/PasswordRequirements.tsx';
import PasswordStrengthMeter from '../components/PasswordStrengthMeter.tsx';
import MockCaptcha from '../components/MockCaptcha.tsx';
import { checkRequirements } from '../utils/passwordValidation.ts';
import { recuperarSenhaComCodigo } from '../services/authService.ts';
import type { AuthScreen } from '../types/auth.ts';

interface Props {
  email: string;
  onNavigate: (screen: AuthScreen, codes?: string[], password?: string) => void;
  onBack: () => void;
}

export default function PasswordRecoveryPage({ email, onNavigate, onBack }: Props) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [captcha, setCaptcha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const allMet = checkRequirements(password).every(r => r.met);
  const match = password === confirm && confirm.length > 0;

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!code.trim()) { setError('Informe o código pessoal de recuperação.'); return; }
    if (!allMet) { setError('A nova senha não atende aos requisitos de segurança.'); return; }
    if (!match) { setError('As senhas não coincidem.'); return; }
    if (!captcha) { setError('Confirme a verificação de segurança.'); return; }
    setLoading(true);
    try {
      const result = await recuperarSenhaComCodigo(email, code, password);
      if (!result.sucesso) {
        setError(result.erro || 'Falha ao recuperar senha.');
        return;
      }
      onNavigate('recovery-codes', result.codigos_recuperacao || [], password);
    } catch (err: any) {
      setError(err?.message || 'Erro inesperado na recuperação de senha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Recuperar acesso"
      subtitle="Informe um dos seus 8 códigos pessoais de recuperação e crie uma nova senha"
    >
      <form className="auth-form" onSubmit={handleResetPassword}>
        <div className="auth-email-display">
          <span className="auth-email-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
            {email}
          </span>
          <button type="button" className="auth-link auth-link-sm" onClick={onBack}>
            Trocar e-mail
          </button>
        </div>

        <div className="auth-field">
          <label htmlFor="auth-recovery-code" className="auth-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="auth-field-icon"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Código pessoal de recuperação
          </label>
          <input
            id="auth-recovery-code"
            type="text"
            className="auth-input auth-input-code"
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase()); setError(''); }}
            placeholder="XXXX-XXXX-XXXX"
            disabled={loading}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <PasswordInput
          id="auth-rec-pw"
          label="Nova senha"
          value={password}
          onChange={v => { setPassword(v); setError(''); }}
          placeholder="Crie sua nova senha"
          disabled={loading}
          autoComplete="new-password"
        />

        <PasswordStrengthMeter password={password} />
        <PasswordRequirements password={password} />

        <PasswordInput
          id="auth-rec-confirm"
          label="Confirmar nova senha"
          value={confirm}
          onChange={v => { setConfirm(v); setError(''); }}
          placeholder="Repita a nova senha"
          disabled={loading}
          autoComplete="new-password"
        />

        {confirm && !match && (
          <div className="auth-mismatch">As senhas não coincidem.</div>
        )}

        <MockCaptcha checked={captcha} onChange={setCaptcha} disabled={loading} />

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
          {loading ? <span className="auth-spinner" /> : 'Redefinir senha'}
        </button>

        <div className="auth-links">
          <button type="button" className="auth-link" onClick={() => onNavigate('recovery-request')}>
            Não tenho meu código de recuperação
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
