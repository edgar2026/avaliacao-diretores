/// <reference types="vite/client" />

// Variáveis de ambiente públicas usadas pelo app (somente prefixo VITE_).
// Valores reais vivem em .env (dev) / Environment Variables da Vercel —
// nunca neste arquivo.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
