import { existsSync, readFileSync } from 'node:fs';

// Carrega o .env antes de qualquer import que leia variáveis (ordem dos imports).
const envPath = new URL('../../.env', import.meta.url);
if(existsSync(envPath)){
  for(const line of readFileSync(envPath, 'utf8').split(/\r?\n/)){
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if(match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
