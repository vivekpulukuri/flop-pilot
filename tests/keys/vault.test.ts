import { test, expect } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptSeed, decryptSeed, writeVault, readVault, unlockSeed, newVaultPassword, VaultLockedError } from '../../src/keys/vault.js';
import { ensureDirs, paths } from '../../src/core/paths.js';
import { memSecretStore } from '../fakes.js';
import { TEST_SEED } from '../fixtures/seed.js';

test('decrypt(encrypt(seed)) returns the seed', () => {
  const v = encryptSeed(TEST_SEED, 'pw-1');
  expect(decryptSeed(v, 'pw-1')).toBe(TEST_SEED);
});

test('wrong password throws', () => {
  const v = encryptSeed(TEST_SEED, 'pw-1');
  expect(() => decryptSeed(v, 'pw-2')).toThrow();
});

test('vault JSON never contains any seed word', () => {
  const json = JSON.stringify(encryptSeed(TEST_SEED, 'pw-1'));
  for (const w of TEST_SEED.split(' ')) expect(json.includes(`${w} `) || json.includes(` ${w}`)).toBe(false);
  expect(json).not.toContain(TEST_SEED.split(' ').slice(0, 3).join(' '));
});

test('vault uses scrypt N=131072 r=8 p=1 and AES-GCM fields', () => {
  const v = encryptSeed(TEST_SEED, 'pw');
  expect(v).toMatchObject({ v: 1, kdf: 'scrypt', N: 131072, r: 8, p: 1 });
  for (const k of ['salt', 'iv', 'tag', 'ct'] as const) expect(typeof v[k]).toBe('string');
});

test('writeVault writes mode 0600 and refuses to overwrite', () => {
  const home = join(mkdtempSync(join(tmpdir(), 'fp-')), 'h'); ensureDirs(home);
  const file = paths(home).vault;
  writeVault(file, encryptSeed(TEST_SEED, 'pw'));
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(() => writeVault(file, encryptSeed(TEST_SEED, 'pw'))).toThrow();
  expect(readVault(file).kdf).toBe('scrypt');
  expect(readFileSync(file, 'utf8')).not.toContain(TEST_SEED.split(' ')[0] + ' ');
});

test('unlockSeed uses the secret store password', async () => {
  const home = join(mkdtempSync(join(tmpdir(), 'fp-')), 'h'); ensureDirs(home);
  const pw = newVaultPassword();
  expect(pw.length).toBeGreaterThanOrEqual(43);
  writeVault(paths(home).vault, encryptSeed(TEST_SEED, pw));
  expect(await unlockSeed(home, memSecretStore(pw))).toBe(TEST_SEED);
});

test('unlockSeed with no stored password throws VaultLockedError', async () => {
  const home = join(mkdtempSync(join(tmpdir(), 'fp-')), 'h'); ensureDirs(home);
  writeVault(paths(home).vault, encryptSeed(TEST_SEED, 'x'));
  await expect(unlockSeed(home, memSecretStore(null))).rejects.toBeInstanceOf(VaultLockedError);
});
