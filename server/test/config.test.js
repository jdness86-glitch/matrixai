import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../src/config.js';

test('chiffre et déchiffre un secret en AES-GCM versionné', () => {
  const encrypted = encrypt('secret SSH');
  assert.match(encrypted, /^v1\./);
  assert.notEqual(encrypted, 'secret SSH');
  assert.equal(decrypt(encrypted), 'secret SSH');
});

test('rejette silencieusement une charge chiffrée corrompue', () => {
  assert.equal(decrypt('v1.invalid.invalid.invalid'), '');
});
