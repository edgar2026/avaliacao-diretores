import { createClient } from '@supabase/supabase-js';

// Produção/navegador: somente variáveis públicas VITE_ via import.meta.env.
// O acesso a process.env é protegido por typeof e existe APENAS para os
// testes de integração em Node (tests/integration/loadEnv.mjs carrega o .env
// em process.env). No bundle da Vite esse ramo nunca é avaliado — process é
// indefinido no navegador. Nenhuma credencial administrativa é aceita aqui.
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
const nodeEnv = (typeof process !== 'undefined' && process.env) ? process.env : {};

const url = env.VITE_SUPABASE_URL || nodeEnv.SUPABASE_URL || nodeEnv.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY || nodeEnv.SUPABASE_ANON_KEY || nodeEnv.VITE_SUPABASE_ANON_KEY;

let client = null;

export function isSupabaseConfigured(){
  return Boolean(url && anonKey);
}

export function getSupabase(){
  if(!isSupabaseConfigured()){
    throw new Error('Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente (arquivo .env em desenvolvimento; Environment Variables no Vercel).');
  }
  if(!client){
    client = createClient(url, anonKey, {
      auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
      global:{ headers:{ 'x-application-module':'avaliacoes-diretores' } }
    });
  }
  return client;
}
