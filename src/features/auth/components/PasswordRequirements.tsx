import React from 'react';
import { checkRequirements } from '../utils/passwordValidation.ts';

interface Props {
  password: string;
}

export default function PasswordRequirements({ password }: Props) {
  const reqs = checkRequirements(password);
  return (
    <ul className="auth-reqs">
      {reqs.map(r => (
        <li key={r.label} className={r.met ? 'auth-req met' : 'auth-req'}>
          <span className="auth-req-icon">{r.met ? '✓' : '○'}</span>
          <span className={r.met ? 'auth-req-text met' : 'auth-req-text'}>{r.label}</span>
        </li>
      ))}
    </ul>
  );
}
