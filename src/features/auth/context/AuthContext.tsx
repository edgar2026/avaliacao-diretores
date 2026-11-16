import React, { createContext, useContext, useEffect, useState } from 'react';
import { getSupabase, isSupabaseConfigured } from '../../../services/supabaseClient.ts';
import { obterPerfilAtual, logoutUsuario } from '../services/authService.ts';
import { AUTH_ENABLED } from '../config/authConfig.ts';
import type { PerfilUsuario } from '../types/auth.ts';

interface AuthContextType {
  perfil: PerfilUsuario | null;
  loading: boolean;
  logout: () => Promise<void>;
  reloadPerfil: () => Promise<void>;
  setPerfil: (p: PerfilUsuario | null) => void;
}

const AuthContext = createContext<AuthContextType>({
  perfil: null,
  loading: AUTH_ENABLED,
  logout: async () => {},
  reloadPerfil: async () => {},
  setPerfil: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [loading, setLoading] = useState<boolean>(AUTH_ENABLED);

  async function carregarPerfil() {
    if (!AUTH_ENABLED) {
      setLoading(false);
      return;
    }

    try {
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }
      const p = await obterPerfilAtual();
      if (p && !p.bloqueado) {
        setPerfil(p);
      } else {
        if (p?.bloqueado) {
          await logoutUsuario();
        }
        setPerfil(null);
      }
    } catch (err) {
      console.error('[AuthProvider] Erro ao carregar perfil inicial:', err);
      setPerfil(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!AUTH_ENABLED) {
      setLoading(false);
      return;
    }

    carregarPerfil();

    if (!isSupabaseConfigured()) return;
    const supabase = getSupabase();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        const p = await obterPerfilAtual();
        if (p && !p.bloqueado) {
          setPerfil(p);
        } else {
          setPerfil(null);
        }
      } else {
        setPerfil(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    if (!AUTH_ENABLED) return;
    await logoutUsuario();
    setPerfil(null);
  }

  async function reloadPerfil() {
    if (!AUTH_ENABLED) return;
    await carregarPerfil();
  }

  return (
    <AuthContext.Provider value={{ perfil, loading, logout, reloadPerfil, setPerfil }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
