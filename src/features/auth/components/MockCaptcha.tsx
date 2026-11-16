import React from 'react';
import TurnstileCaptcha from './TurnstileCaptcha.tsx';

interface Props {
  checked: boolean;
  onChange: (v: boolean, token?: string) => void;
  disabled?: boolean;
}

/** Componente de CAPTCHA integrado ao Cloudflare Turnstile oficial. */
export default function MockCaptcha({ checked, onChange, disabled = false }: Props) {
  return (
    <TurnstileCaptcha
      checked={checked}
      onChange={(verified, token) => onChange(verified, token)}
      disabled={disabled}
    />
  );
}
