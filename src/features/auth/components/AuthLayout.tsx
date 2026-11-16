import React from 'react';

interface Props {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

/** Layout centralizado para todas as telas de autenticação. */
export default function AuthLayout({ children, title, subtitle }: Props) {
  return (
    <div className="auth-page">
      <div className="auth-bg" />
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <img
              src="/assets/logo-diretores.png"
              alt="SER Educacional — Avaliação de Diretores"
              className="auth-logo"
            />
            <h1 className="auth-title">{title || 'Sistema de Avaliação de Diretores'}</h1>
            {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          </div>
          <div className="auth-body">
            {children}
          </div>
        </div>
        <footer className="auth-footer">
          <span>Desenvolvido por V3LOZ</span>
        </footer>
      </div>
    </div>
  );
}
