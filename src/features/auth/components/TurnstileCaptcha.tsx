import React, { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        params: {
          sitekey: string;
          callback?: (token: string) => void;
          'error-callback'?: (code: string) => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact' | 'flexible';
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    onloadTurnstileCallback?: () => void;
  }
}

interface TurnstileCaptchaProps {
  checked: boolean;
  onChange: (verified: boolean, token?: string) => void;
  disabled?: boolean;
  siteKey?: string;
}

// Chave pública de teste oficial da Cloudflare que sempre aprova (para desenvolvimento/testes locais)
// Quando você criar a chave oficial no Cloudflare, basta colocar VITE_TURNSTILE_SITE_KEY no arquivo .env
const CLOUDFLARE_TEST_SITEKEY = '1x00000000000000000000AA';

export default function TurnstileCaptcha({
  checked,
  onChange,
  disabled = false,
  siteKey
}: TurnstileCaptchaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const activeSiteKey =
    siteKey ||
    (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY ||
    CLOUDFLARE_TEST_SITEKEY;

  useEffect(() => {
    let isMounted = true;

    function renderWidget() {
      if (!containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignora
        }
      }

      try {
        const id = window.turnstile.render(containerRef.current, {
          sitekey: activeSiteKey,
          theme: 'light',
          size: 'flexible',
          callback: (token: string) => {
            if (isMounted) onChange(true, token);
          },
          'expired-callback': () => {
            if (isMounted) onChange(false);
          },
          'error-callback': () => {
            if (isMounted) {
              setLoadError(true);
              // Fallback para permitir interação caso haja bloqueio de rede
            }
          }
        });
        widgetIdRef.current = id;
      } catch (err) {
        console.warn('[Turnstile] Erro ao renderizar widget:', err);
        if (isMounted) setLoadError(true);
      }
    }

    // Carrega o script oficial do Cloudflare Turnstile se ainda não estiver presente
    const SCRIPT_ID = 'cf-turnstile-script';
    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback';
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        if (isMounted) setLoadError(true);
      };
      window.onloadTurnstileCallback = () => {
        if (isMounted) renderWidget();
      };
      document.head.appendChild(script);
    } else if (window.turnstile) {
      renderWidget();
    } else {
      const existingCallback = window.onloadTurnstileCallback;
      window.onloadTurnstileCallback = () => {
        if (existingCallback) existingCallback();
        if (isMounted) renderWidget();
      };
    }

    return () => {
      isMounted = false;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignora
        }
      }
    };
  }, [activeSiteKey]);

  // Se houver falha de rede/bloqueio ao carregar a CDN da Cloudflare, oferece o fallback elegante
  if (loadError) {
    return (
      <div className="auth-captcha" style={{ borderStyle: 'dashed' }}>
        <label className="auth-captcha-label">
          <input
            type="checkbox"
            className="auth-captcha-check"
            checked={checked}
            onChange={e => onChange(e.target.checked, 'mock-offline-token')}
            disabled={disabled}
          />
          <span className="auth-captcha-box">
            {checked && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#087f95" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
          <span className="auth-captcha-text">Eu não sou um robô (Modo Local)</span>
        </label>
        <div className="auth-captcha-brand">
          <span style={{ color: '#087f95' }}>Cloudflare</span>
          <span>Turnstile</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="auth-turnstile-container"
      style={{ minHeight: '65px', width: '100%', display: 'flex', justifyContent: 'center' }}
    >
      <div ref={containerRef} style={{ width: '100%' }} />
    </div>
  );
}
