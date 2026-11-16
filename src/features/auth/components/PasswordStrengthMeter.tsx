import React from 'react';
import { getStrength } from '../utils/passwordValidation.ts';

interface Props {
  password: string;
}

export default function PasswordStrengthMeter({ password }: Props) {
  const s = getStrength(password);
  if (!password) return null;
  const segments = 4;
  return (
    <div className="auth-strength">
      <div className="auth-strength-bar">
        {Array.from({ length: segments }, (_, i) => (
          <div
            key={i}
            className="auth-strength-seg"
            style={{ background: i < s.level ? s.color : '#e2e8f0' }}
          />
        ))}
      </div>
      <span className="auth-strength-label" style={{ color: s.color }}>{s.label}</span>
    </div>
  );
}
