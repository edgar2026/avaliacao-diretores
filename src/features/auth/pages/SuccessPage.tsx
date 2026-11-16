import React from 'react';
import AuthLayout from '../components/AuthLayout.tsx';

interface Props {
  title?: string;
  message?: string;
  onContinue: () => void;
  continueText?: string;
}

export default function SuccessPage({
  title = 'Acesso liberado',
  message = 'Suas credenciais foram autenticadas com sucesso.',
  onContinue,
  continueText = 'Acessar o sistema'
}: Props) {
  return (
    <AuthLayout title={title} subtitle="Operação concluída com sucesso">
      <div className="auth-form">
        <div className="auth-success-box">
          <div className="auth-success-icon-wrap">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#087f95" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h2 className="auth-success-title">{title}</h2>
          <p className="auth-success-text">{message}</p>
          <button type="button" className="auth-btn auth-btn-primary" onClick={onContinue}>
            {continueText}
          </button>
        </div>
      </div>
    </AuthLayout>
  );
}
