import React, { useState } from 'react';
import EmailIdentification from './pages/EmailIdentification.tsx';
import LoginPage from './pages/LoginPage.tsx';
import FirstAccessPage from './pages/FirstAccessPage.tsx';
import RecoveryCodesPage from './pages/RecoveryCodesPage.tsx';
import PasswordRecoveryPage from './pages/PasswordRecoveryPage.tsx';
import AdminRecoveryRequest from './pages/AdminRecoveryRequest.tsx';
import RestoreAccessPage from './pages/RestoreAccessPage.tsx';
import SuccessPage from './pages/SuccessPage.tsx';
import { loginUsuario } from './services/authService.ts';
import type { AuthScreen } from './types/auth.ts';
import './auth.css';

interface AuthFlowProps {
  onEnterSystem?: () => void;
}

export default function AuthDemo({ onEnterSystem }: AuthFlowProps) {
  const [screen, setScreen] = useState<AuthScreen>('identify');
  const [email, setEmail] = useState('');
  const [pendingPassword, setPendingPassword] = useState('');
  const [activeCodes, setActiveCodes] = useState<string[]>([]);

  const handleNavigate = (
    nextScreen: AuthScreen,
    nextEmailOrCodes?: string | string[],
    password?: string
  ) => {
    if (typeof nextEmailOrCodes === 'string') {
      setEmail(nextEmailOrCodes);
    } else if (Array.isArray(nextEmailOrCodes)) {
      setActiveCodes(nextEmailOrCodes);
    }
    if (password) {
      setPendingPassword(password);
    }

    if ((nextScreen === 'dashboard' || nextScreen === 'authenticated') && onEnterSystem) {
      onEnterSystem();
      return;
    }
    setScreen(nextScreen);
  };

  async function handleFinishRecoveryCodes() {
    if (email && pendingPassword) {
      try {
        await loginUsuario(email, pendingPassword);
      } catch (e) {
        console.warn('[AuthFlow] Tentativa de login automático pós-códigos:', e);
      }
    }
    if (onEnterSystem) {
      onEnterSystem();
    } else {
      setScreen('identify');
    }
  }

  return (
    <>
      {(screen === 'identify' || screen === 'email') && (
        <EmailIdentification
          onNavigate={(target, em) => handleNavigate(target, em)}
        />
      )}

      {(screen === 'sign-in' || screen === 'login') && (
        <LoginPage
          email={email}
          onNavigate={target => handleNavigate(target)}
          onBack={() => setScreen('identify')}
        />
      )}

      {screen === 'first-access' && (
        <FirstAccessPage
          email={email}
          onNavigate={(target, codes, pw) => handleNavigate(target, codes, pw)}
          onBack={() => setScreen('identify')}
        />
      )}

      {screen === 'recovery-codes' && (
        <RecoveryCodesPage
          codes={activeCodes}
          onContinue={handleFinishRecoveryCodes}
        />
      )}

      {(screen === 'recovery-personal' || screen === 'password-recovery') && (
        <PasswordRecoveryPage
          email={email}
          onNavigate={(target, codes, pw) => handleNavigate(target, codes, pw)}
          onBack={() => setScreen('sign-in')}
        />
      )}

      {screen === 'recovery-request' && (
        <AdminRecoveryRequest
          email={email}
          onNavigate={target => handleNavigate(target)}
          onBack={() => setScreen('identify')}
        />
      )}

      {(screen === 'recovery-admin' || screen === 'admin-recovery') && (
        <RestoreAccessPage
          email={email}
          onNavigate={(target, codes, pw) => handleNavigate(target, codes, pw)}
          onBack={() => setScreen('identify')}
        />
      )}

      {screen === 'success' && (
        <SuccessPage
          onContinue={() => {
            if (onEnterSystem) {
              onEnterSystem();
            } else {
              setScreen('identify');
            }
          }}
          continueText="Acessar o sistema"
        />
      )}
    </>
  );
}
