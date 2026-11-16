import React, { useState } from 'react';
import AuthLayout from '../components/AuthLayout.tsx';
import { MOCK_RECOVERY_CODES } from '../utils/mockData.ts';

interface Props {
  codes?: string[];
  onContinue: () => void;
}

export default function RecoveryCodesPage({ codes, onContinue }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const displayCodes = (codes && codes.length > 0) ? codes : MOCK_RECOVERY_CODES;

  function handleCopy() {
    const text = displayCodes.join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function handleDownload() {
    const text = [
      'Sistema de Avaliação de Diretores',
      'Códigos pessoais de recuperação',
      '═══════════════════════════════',
      '',
      ...displayCodes.map((c, i) => `${String(i + 1).padStart(2, '0')}. ${c}`),
      '',
      'Guarde estes códigos em local seguro.',
      'Cada código pode ser usado apenas uma vez.',
      `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'codigos-recuperacao.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <AuthLayout
      title="Códigos de recuperação"
      subtitle="Guarde estes códigos em local seguro"
    >
      <div className="auth-form">
        <div className="auth-codes-info">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#087f95" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <p>
            Estes são seus <strong>8 códigos pessoais de recuperação</strong>.
            Cada código pode ser usado apenas uma vez para recuperar o acesso à sua conta de forma autônoma.
            Guarde-os em local seguro e não os compartilhe.
          </p>
        </div>

        <div className="auth-codes-grid">
          {displayCodes.map((code, i) => (
            <div key={code} className="auth-code-item">
              <span className="auth-code-num">{String(i + 1).padStart(2, '0')}</span>
              <code className="auth-code-val">{code}</code>
            </div>
          ))}
        </div>

        <div className="auth-codes-actions">
          <button type="button" className="auth-btn auth-btn-secondary" onClick={handleCopy}>
            {copied ? '✓ Copiados!' : 'Copiar códigos'}
          </button>
          <button type="button" className="auth-btn auth-btn-secondary" onClick={handleDownload}>
            Baixar .txt
          </button>
        </div>

        <label className="auth-codes-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
          />
          <span>Confirmo que salvei meus códigos de recuperação em local seguro.</span>
        </label>

        <button
          type="button"
          className="auth-btn auth-btn-primary"
          disabled={!confirmed}
          onClick={onContinue}
        >
          Continuar para o sistema
        </button>
      </div>
    </AuthLayout>
  );
}
