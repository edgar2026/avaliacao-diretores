import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSha256 } from '../../src/services/hashService.js';

test('SHA-256 de bytes conhecidos', async () => {
  const hash = await computeSha256(new TextEncoder().encode('abc'));
  assert.equal(hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('hashs diferentes para conteúdos diferentes e estáveis para o mesmo conteúdo', async () => {
  const a = await computeSha256(new Uint8Array([1, 2, 3]));
  const b = await computeSha256(new Uint8Array([1, 2, 4]));
  const a2 = await computeSha256(new Uint8Array([1, 2, 3]));
  assert.notEqual(a, b);
  assert.equal(a, a2);
  assert.match(a, /^[0-9a-f]{64}$/);
});
