import { test, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTick } from '../../src/autopilot/tick.js';
import { acquireLock, releaseLock } from '../../src/autopilot/lock.js';
import { runInit } from '../../src/commands/init.js';
import { updateConfig } from '../../src/core/config.js';
import { paths } from '../../src/core/paths.js';
import { openLedger } from '../../src/ledger/ledger.js';
import { VaultLockedError } from '../../src/keys/vault.js';
import type { RuntimeDeps } from '../../src/runtime.js';
import { fakeChain, fakeEnv, fakeFaucet, memSecretStore, callsOf } from '../fakes.js';
import { TEST_SEED } from '../fixtures/seed.js';

const E = 10n ** 18n;
let home: string;
let store: ReturnType<typeof memSecretStore>;
let env: ReturnType<typeof fakeEnv>;
let chain: ReturnType<typeof fakeChain>;
let faucet: ReturnType<typeof fakeFaucet>;
let pageFetches = 0;
const MINER = '5GrmgqmvwX2WgedTsz7UTJix9k4az2NdEBT9my4yFnRTD23m';

beforeEach(async () => {
  home = join(mkdtempSync(join(tmpdir(), 'fptk-')), 'h');
  store = memSecretStore();
  await runInit({ home, network: 'testnet', restore: true, store, io: { print() {}, clear() {}, async ask() { return TEST_SEED; } } });
  updateConfig(home, { practice: false, minerEndpoints: [{ address: MINER, url: 'https://miner.example' }] });
  env = fakeEnv(new Date('2026-11-27T12:00:00Z'));
  pageFetches = 0;
  env.fetch = (async () => { pageFetches++; return new Response('<p>page</p>'); }) as typeof fetch;
  chain = fakeChain({ registered: [{ address: MINER, models: ['0xm'] }], urlMiners: { 'https://miner.example': MINER } });
  faucet = fakeFaucet();
});

const deps = (over: Partial<RuntimeDeps> = {}): RuntimeDeps => ({
  home, env, store, makeChain: async () => chain, makeFaucet: () => faucet, ...over,
});
const ledger = () => openLedger(paths(home).ledger);

test('killed → returns immediately: no lock, no network calls', async () => {
  updateConfig(home, { killed: true });
  const s = await runTick(deps());
  expect(s.skippedAll).toBe('killed');
  expect(existsSync(paths(home).lock)).toBe(false);
  expect(chain.calls).toHaveLength(0);
  expect(faucet.calls).toHaveLength(0);
});

test('a second concurrent tick exits "already_running"', async () => {
  expect(acquireLock(paths(home).lock)).toBe(true);
  const s = await runTick(deps());
  expect(s.skippedAll).toBe('already_running');
  releaseLock(paths(home).lock);
});

test('a stale lock from a dead process is replaced', () => {
  writeFileSync(paths(home).lock, '999999');
  expect(acquireLock(paths(home).lock)).toBe(true);
  releaseLock(paths(home).lock);
  expect(existsSync(paths(home).lock)).toBe(false);
});

test('REVIEW-FOCUS-2: unsupported runtime → no claim/spend calls and one alert after two ticks', async () => {
  chain.spec = 1014099;
  await runTick(deps());
  const s = await runTick(deps());
  expect(s.skippedAll).toBe('runtime_unsupported');
  expect(callsOf(faucet, 'claim')).toHaveLength(0);
  expect(callsOf(chain, 'prepareInference')).toHaveLength(0);
  const l = ledger();
  expect(l.listAlerts(true).filter((a) => a.kind === 'runtime_unsupported')).toHaveLength(1);
  expect(callsOf(env, 'notify')).toHaveLength(1);
  l.close();
});

test('REVIEW-FOCUS-3: chain connect timeout → error recorded, lock released, no half-written claim rows', async () => {
  const s = await runTick(deps({ makeChain: async () => { throw new Error('connect ETIMEDOUT'); } }));
  expect(s.errors.join(' ')).toMatch(/ETIMEDOUT/);
  expect(existsSync(paths(home).lock)).toBe(false);
  const l = ledger();
  expect(l.claimsSince('testnet', new Date(0))).toHaveLength(0);
  expect(l.lastTick()).toMatchObject({ errors: expect.arrayContaining([expect.stringMatching(/ETIMEDOUT/)]) });
  expect(l.lastTick()!.ended).not.toBeNull();
  l.close();
});

test('REVIEW-FOCUS-5: Keychain unavailable → one vault_locked alert over two ticks, clean exit', async () => {
  store.failGet = new VaultLockedError();
  const a = await runTick(deps());
  await runTick(deps());
  expect(a.skippedAll).toBe('vault_locked');
  expect(existsSync(paths(home).lock)).toBe(false);
  const l = ledger();
  expect(l.listAlerts(true).filter((x) => x.kind === 'vault_locked')).toHaveLength(1);
  l.close();
});

test('faucet genesis mismatch → no claims, other steps still run', async () => {
  faucet.chain = async () => ({ network: 'testnet', genesisHash: '0xevil' });
  const s = await runTick(deps());
  expect(callsOf(faucet, 'claim')).toHaveLength(0);
  expect(s.errors.join(' ')).toMatch(/genesis/i);
  expect(pageFetches).toBeGreaterThan(0);
});

test('paused → watchers run, no claim/spend/reconcile', async () => {
  updateConfig(home, { paused: true });
  await runTick(deps());
  expect(pageFetches).toBe(4);
  expect(callsOf(faucet, 'claim')).toHaveLength(0);
  expect(callsOf(chain, 'prepareInference')).toHaveLength(0);
});

test('happy path across ticks: claim → (finalized) enroll → spend', async () => {
  const t1 = await runTick(deps());
  expect(t1.actions.filter((a) => a.action === 'claim').map((a) => a.kind)).toEqual(['done', 'done', 'done']);
  const l = ledger();
  const addrs = l.listWallets('testnet').map((w) => w.address);
  l.close();
  for (const a of addrs) chain.balances[a] = 10n * E;
  const t2 = await runTick(deps());
  const kinds = t2.actions.map((a) => `${a.action}:${a.kind}`);
  expect(kinds.filter((k) => k === 'enroll:done')).toHaveLength(3);
  expect(kinds.filter((k) => k === 'spend:done').length).toBeGreaterThan(0);
  expect(kinds.indexOf('enroll:done')).toBeLessThan(kinds.indexOf('spend:done'));
  expect(t2.mode).toBe('standby');
});

test('practice mode tick simulates and sends nothing', async () => {
  updateConfig(home, { practice: true });
  const s = await runTick(deps());
  expect(s.actions.every((a) => a.kind === 'simulated' || a.kind === 'skipped')).toBe(true);
  expect(callsOf(faucet, 'claim')).toHaveLength(0);
});
