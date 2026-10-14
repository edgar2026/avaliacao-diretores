import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base na raiz do domínio (compatível com domínio da Vercel e domínio
// personalizado futuro). Nenhum caminho absoluto de máquina, porta ou URL
// localhost é fixado aqui.
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    host: true
  },
  preview: {
    port: 4173,
    host: true
  }
});
