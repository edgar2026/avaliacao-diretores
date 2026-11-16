// Validação de senha e força (somente frontend/demo — sem persistência).

import type { PasswordRequirement } from '../types/auth.ts';

export function checkRequirements(password: string): PasswordRequirement[] {
  return [
    { label: 'Mínimo de 8 caracteres', met: password.length >= 8 },
    { label: 'Pelo menos uma letra maiúscula', met: /[A-Z]/.test(password) },
    { label: 'Pelo menos uma letra minúscula', met: /[a-z]/.test(password) },
    { label: 'Pelo menos um número', met: /\d/.test(password) },
    { label: 'Pelo menos um caractere especial (!@#$%&*)', met: /[!@#$%&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) },
    { label: 'Sem espaços', met: password.length > 0 && !/\s/.test(password) },
  ];
}

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export interface StrengthInfo {
  level: StrengthLevel;
  label: string;
  color: string;
}

export function getStrength(password: string): StrengthInfo {
  if (!password) return { level: 0, label: '', color: '#cbd5e1' };
  const reqs = checkRequirements(password);
  const met = reqs.filter(r => r.met).length;
  if (met <= 1) return { level: 1, label: 'Muito fraca', color: '#ef4444' };
  if (met <= 2) return { level: 1, label: 'Fraca', color: '#f97316' };
  if (met <= 4) return { level: 2, label: 'Média', color: '#eab308' };
  if (met <= 5) return { level: 3, label: 'Forte', color: '#22c55e' };
  return { level: 4, label: 'Muito forte', color: '#16a34a' };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
