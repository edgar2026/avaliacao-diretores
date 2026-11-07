#!/usr/bin/env node
// Guarda da migração TypeScript: impede que novos arquivos JavaScript (.js/.jsx)
// ou imports apontando para .js/.jsx apareçam em src/. Executado pelo
// `npm run typecheck` (e portanto pelo `npm run build`).
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
const FILE_RX = /\.(js|jsx)$/;
const IMPORT_RX = /(?:from\s*|import\s*\(\s*|import\s+|require\s*\()\s*['"][^'"]+\.(js|jsx)['"]/;

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else files.push(path);
  }
};
walk(SRC);

const problems = [];
for (const file of files) {
  const rel = relative(process.cwd(), file).replace(/\\/g, '/');
  if (FILE_RX.test(extname(file))) {
    problems.push(`arquivo JavaScript em src: ${rel}`);
    continue;
  }
  if (!/\.(ts|tsx)$/.test(extname(file))) continue;
  const text = readFileSync(file, 'utf8');
  const match = text.match(IMPORT_RX);
  if (match) problems.push(`import com extensão .js/.jsx: ${rel} -> ${match[0].trim()}`);
}

if (problems.length > 0) {
  console.error('Migração TypeScript violada:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`src/ sem JavaScript: ${files.length} arquivos verificados (0 .js/.jsx, 0 imports .js/.jsx)`);
