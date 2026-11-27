import { test, expect } from 'vitest';
import { deriveWallets, derivationPath } from '../../src/keys/derive.js';
import { TEST_SEED } from '../fixtures/seed.js';

test('derivation path includes the network', () => {
  expect(derivationPath('testnet', 2)).toBe('//flop-agent//testnet//2');
});

test('deriveWallets is deterministic', async () => {
  const a = await deriveWallets(TEST_SEED, 'testnet', 3);
  const b = await deriveWallets(TEST_SEED, 'testnet', 3);
  expect(a.map((w) => w.address)).toEqual(b.map((w) => w.address));
});

test('testnet and devnet addresses differ', async () => {
  const t = await deriveWallets(TEST_SEED, 'testnet', 3);
  const d = await deriveWallets(TEST_SEED, 'devnet', 3);
  for (const w of t) expect(d.map((x) => x.address)).not.toContain(w.address);
});

test('3 distinct SS58-42 addresses with index and network set', async () => {
  const ws = await deriveWallets(TEST_SEED, 'testnet', 3);
  expect(new Set(ws.map((w) => w.address)).size).toBe(3);
  ws.forEach((w, i) => { expect(w.index).toBe(i); expect(w.network).toBe('testnet'); expect(w.address.startsWith('5')).toBe(true); });
  expect(ws[0].pair.type).toBe('sr25519');
});
