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

test('addMinerEndpoint validates SS58 and https URL; removeMinerEndpoint removes it', async () => {
  const { addMinerEndpoint, removeMinerEndpoint } = await import('../../src/commands/settings.js');
  const addr = '5GrmgqmvwX2WgedTsz7UTJix9k4az2NdEBT9my4yFnRTD23m';
  expect(() => addMinerEndpoint(home, 'not-an-address', 'https://m.example')).toThrow(/address/i);
  expect(() => addMinerEndpoint(home, addr, 'ftp://m.example')).toThrow(/https/i);
  addMinerEndpoint(home, addr, 'https://m.example/');
  addMinerEndpoint(home, addr, 'https://m2.example');
  expect(loadConfig(home).minerEndpoints).toEqual([{ address: addr, url: 'https://m2.example' }]);
  removeMinerEndpoint(home, addr);
  expect(loadConfig(home).minerEndpoints).toEqual([]);
});

test('I5: fund (real) is refused while paused; dry-run still simulates', async () => {
  const { runFund } = await import('../../src/commands/fund.js');
  const { fakeChain, fakeEnv, fakeFaucet } = await import('../fakes.js');
  const { updateConfig } = await import('../../src/core/config.js');
  const deps = { home, env: fakeEnv(), store, makeChain: async () => fakeChain(), makeFaucet: () => fakeFaucet() };
  updateConfig(home, { practice: false, paused: true });
  await expect(runFund(deps, {})).rejects.toThrow(/Resume first/);
  const sim = await runFund(deps, { dryRun: true });
  expect(sim.every((r) => r.kind === 'simulated' || r.kind === 'skipped')).toBe(true);
});

test('I5: a real CLI action holds the tick lock while it runs and releases it after', async () => {
  const { openRuntime } = await import('../../src/runtime.js');
  const { acquireLock } = await import('../../src/autopilot/lock.js');
  const { fakeChain, fakeEnv, fakeFaucet } = await import('../fakes.js');
  const { updateConfig } = await import('../../src/core/config.js');
  updateConfig(home, { practice: false, paused: false });
  const rt = await openRuntime({ home, env: fakeEnv(), store, makeChain: async () => fakeChain(), makeFaucet: () => fakeFaucet() });
  expect(acquireLock(paths(home).lock)).toBe(false);
  await rt.close();
  expect(acquireLock(paths(home).lock)).toBe(true);
});
