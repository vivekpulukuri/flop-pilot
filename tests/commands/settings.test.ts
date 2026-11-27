import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../src/commands/init.js';
import { setPractice, setNetwork, setClaimers } from '../../src/commands/settings.js';
import { loadConfig } from '../../src/core/config.js';
import { paths } from '../../src/core/paths.js';
import { openLedger } from '../../src/ledger/ledger.js';
import { memSecretStore } from '../fakes.js';
import { TEST_SEED } from '../fixtures/seed.js';

let home: string;
const store = memSecretStore();
beforeEach(async () => {
  home = join(mkdtempSync(join(tmpdir(), 'fps-')), 'h');
  await runInit({ home, network: 'devnet', restore: true, store, io: { print() {}, clear() {}, async ask() { return TEST_SEED; } } });
});

test('setPractice toggles config.practice', () => {
  setPractice(home, false);
  expect(loadConfig(home).practice).toBe(false);
  setPractice(home, true);
  expect(loadConfig(home).practice).toBe(true);
});

test('setClaimers(4) throws with the faucet message', () => {
  expect(() => setClaimers(home, 4)).toThrow('The faucet allows 3 claims per internet connection per day');
  expect(() => setClaimers(home, 0)).toThrow();
});

test('setClaimers(2) marks wallet 2 as non-claimer', () => {
  setClaimers(home, 2);
  expect(loadConfig(home).claimers).toBe(2);
  const l = openLedger(paths(home).ledger);
  expect(l.listWallets('devnet').map((w) => w.claimer)).toEqual([true, true, false]);
  l.close();
});

test('setNetwork("testnet") adds testnet wallets and leaves devnet rows unchanged', async () => {
  const l0 = openLedger(paths(home).ledger);
  const devBefore = l0.listWallets('devnet');
  l0.close();
  await setNetwork(home, 'testnet', store);
  expect(loadConfig(home).network).toBe('testnet');
  const l = openLedger(paths(home).ledger);
  expect(l.listWallets('testnet')).toHaveLength(3);
  expect(l.listWallets('devnet')).toEqual(devBefore);
  expect(l.listWallets('testnet')[0].address).not.toBe(devBefore[0].address);
  l.close();
});
