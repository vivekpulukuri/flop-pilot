import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/dashboard/server.js';
import { runInit } from '../../src/commands/init.js';
import { loadConfig, updateConfig } from '../../src/core/config.js';
import { paths } from '../../src/core/paths.js';
import { openLedger } from '../../src/ledger/ledger.js';
import { fakeChain, fakeEnv, fakeFaucet, memSecretStore, callsOf } from '../fakes.js';
import { TEST_SEED } from '../fixtures/seed.js';

const PORT = 4747;
const TOKEN = 'tok_abcdefghijklmnopqrstuvwx';
let home: string;
let app: ReturnType<typeof createApp>;
let faucet: ReturnType<typeof fakeFaucet>;

beforeEach(async () => {
  home = join(mkdtempSync(join(tmpdir(), 'fpdc-')), 'h');
  const store = memSecretStore();
  await runInit({ home, network: 'testnet', restore: true, store, io: { print() {}, clear() {}, async ask() { return TEST_SEED; } } });
  updateConfig(home, { practice: false });
  faucet = fakeFaucet();
  app = createApp({ home, env: fakeEnv(new Date('2026-11-27T12:00:00Z')), store, ledgerOf: () => openLedger(paths(home).ledger), chainOf: async () => fakeChain(), makeFaucet: () => faucet, token: TOKEN, port: PORT });
});

const H = { host: `127.0.0.1:${PORT}`, cookie: `fp_session=${TOKEN}`, origin: `http://127.0.0.1:${PORT}` };
const post = (path: string, body: Record<string, string> = {}) => app.request(path, { method: 'POST', headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

test('POST /api/claim/0 while in cooldown → skipped cooldown, no faucet POST', async () => {
  const l = openLedger(paths(home).ledger);
  const w = l.listWallets('testnet')[0];
  l.insertClaim({ network: 'testnet', wallet_idx: 0, address: w.address, nonce: '1', status: 'finalized', ts: '2026-11-27T06:00:00.000Z' });
  l.close();
  const r = await post('/api/claim/0');
  const j = (await r.json()) as { result: { kind: string; reason: string } };
  expect(j.result).toMatchObject({ kind: 'skipped', reason: 'cooldown' });
  expect(callsOf(faucet, 'claim')).toHaveLength(0);
});

test('POST /api/claim/1 claims through the same guarded flow', async () => {
  const j = (await (await post('/api/claim/1')).json()) as { result: { kind: string } };
  expect(j.result.kind).toBe('done');
  expect(callsOf(faucet, 'claim')).toHaveLength(1);
});

test('settings: claimers=4 → 400 with the faucet message; valid values saved', async () => {
  const bad = await post('/api/settings', { claimers: '4' });
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { message: string }).message).toMatch(/3 claims per internet connection/);
  expect((await post('/api/settings', { tickMinutes: '2' })).status).toBe(400);
  expect((await post('/api/settings', { dailySpendCeilingFlop: '-1' })).status).toBe(400);
  expect((await post('/api/settings', { claimers: '2', dailySpendCeilingFlop: '20', tickMinutes: '30' })).status).toBe(200);
  expect(loadConfig(home)).toMatchObject({ claimers: 2, dailySpendCeilingFlop: 20, tickMinutes: 30 });
});

test('stop needs the typed confirmation', async () => {
  expect((await post('/api/stop')).status).toBe(400);
  expect((await post('/api/stop', { confirm: 'STOP' })).status).toBe(200);
  expect(loadConfig(home)).toMatchObject({ killed: true, paused: true });
});

test('pause, resume and practice toggle', async () => {
  await post('/api/pause');
  expect(loadConfig(home).paused).toBe(true);
  await post('/api/resume');
  expect(loadConfig(home).paused).toBe(false);
  await post('/api/practice', { on: 'true' });
  expect(loadConfig(home).practice).toBe(true);
});

test('my-miners validates SS58; activation saves and clears; alert ack', async () => {
  expect((await post('/api/my-miners', { addresses: 'nope' })).status).toBe(400);
  await post('/api/my-miners', { addresses: '5GrmgqmvwX2WgedTsz7UTJix9k4az2NdEBT9my4yFnRTD23m\n' });
  expect(loadConfig(home).myMiners).toEqual(['5GrmgqmvwX2WgedTsz7UTJix9k4az2NdEBT9my4yFnRTD23m']);
  await post('/api/activation', { block: '123456' });
  expect(loadConfig(home).activationBlock.testnet).toBe(123456);
  await post('/api/activation', { block: '' });
  expect(loadConfig(home).activationBlock.testnet).toBeNull();
  const l = openLedger(paths(home).ledger);
  const { id } = l.addAlert('x', 'y');
  l.close();
  await post(`/api/alerts/${id}/ack`);
  const l2 = openLedger(paths(home).ledger);
  expect(l2.listAlerts(true)).toHaveLength(0);
  l2.close();
});

test('miner endpoint add/remove via dashboard', async () => {
  expect((await post('/api/miner-endpoints', { address: '5GrmgqmvwX2WgedTsz7UTJix9k4az2NdEBT9my4yFnRTD23m', url: 'http://evil.example' })).status).toBe(400);
  await post('/api/miner-endpoints', { address: '5GrmgqmvwX2WgedTsz7UTJix9k4az2NdEBT9my4yFnRTD23m', url: 'https://m.example' });
  expect(loadConfig(home).minerEndpoints).toHaveLength(1);
  await post('/api/miner-endpoints/remove', { address: '5GrmgqmvwX2WgedTsz7UTJix9k4az2NdEBT9my4yFnRTD23m' });
  expect(loadConfig(home).minerEndpoints).toHaveLength(0);
});

test('claim-status explains each wallet and the controls page renders', async () => {
  const j = (await (await app.request('/api/claim-status', { headers: H })).json()) as { wallets: { index: number; ok: boolean; reason: string | null }[] };
  expect(j.wallets.map((w) => w.index)).toEqual([0, 1, 2]);
  const page = await (await app.request('/controls', { headers: H })).text();
  expect(page).toMatch(/Claim now/);
  expect(page).toMatch(/Type STOP/);
});

test('I5: Claim now is refused while paused or while the autopilot holds the lock (no faucet POST)', async () => {
  const { acquireLock, releaseLock } = await import('../../src/autopilot/lock.js');
  updateConfig(home, { paused: true });
  const r1 = await post('/api/claim/1');
  expect(r1.status).toBe(409);
  expect(((await r1.json()) as { message: string }).message).toMatch(/Resume first/);
  updateConfig(home, { paused: false });
  acquireLock(paths(home).lock);
  const r2 = await post('/api/claim/1');
  expect(r2.status).toBe(409);
  expect(((await r2.json()) as { message: string }).message).toMatch(/running right now/);
  releaseLock(paths(home).lock);
  expect(callsOf(faucet, 'claim')).toHaveLength(0);
});

test('I8: dashboard Resume also clears stopped wallets', async () => {
  const l = openLedger(paths(home).ledger);
  l.setWalletFlags('testnet', 2, { stopped: true });
  l.close();
  await post('/api/resume');
  const l2 = openLedger(paths(home).ledger);
  expect(l2.listWallets('testnet')[2].stopped).toBe(false);
  l2.close();
});
