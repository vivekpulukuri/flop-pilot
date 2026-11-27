/** Tests for the final-review findings (each failed before its fix). */
import { test, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimWallet, reconcileClaims } from '../src/faucet/claim.js';
import { spendWallet, resumeSpends } from '../src/spend/purchase.js';
import { runTick } from '../src/autopilot/tick.js';
import { acquireLock, releaseLock } from '../src/autopilot/lock.js';
import { resumeAll, actionGate } from '../src/commands/autopilot.js';
import { runInit } from '../src/commands/init.js';
import type { Ctx } from '../src/core/ctx.js';
import { DEFAULT_CONFIG, loadConfig, updateConfig } from '../src/core/config.js';
import { ensureDirs, paths } from '../src/core/paths.js';
import { openLedger } from '../src/ledger/ledger.js';
import { deriveWallets, type Wallet } from '../src/keys/derive.js';
import { VaultLockedError } from '../src/keys/vault.js';
import { fakeChain, fakeEnv, fakeFaucet, fakeMiners, memSecretStore, callsOf } from './fakes.js';
import { TEST_SEED } from './fixtures/seed.js';

const E = 10n ** 18n;
let ctx: Ctx & { env: ReturnType<typeof fakeEnv> };
let wallets: Wallet[];
const MINER = { address: '5MinerIndependent', url: 'https://miner.example', models: [], linkedAccounts: [] };

beforeEach(async () => {
  const home = join(mkdtempSync(join(tmpdir(), 'fprf-')), 'h');
  ensureDirs(home);
  const ledger = openLedger(paths(home).ledger);
  wallets = await deriveWallets(TEST_SEED, 'testnet', 3);
  for (const w of wallets) ledger.upsertWallet({ network: 'testnet', index: w.index, address: w.address, claimer: true });
  ledger.setWalletFlags('testnet', 0, { enrolled: true });
  ctx = { home, config: { ...DEFAULT_CONFIG, network: 'testnet', practice: false }, ledger, env: fakeEnv(new Date('2026-11-27T12:00:00Z')), network: 'testnet' };
});

test('C1: after agent_spend_missing, no further POST until a new settled spend', async () => {
  const faucet = fakeFaucet({ result: { outcome: 'refused', action: 'fix_request', reason: 'agent_spend_missing', httpStatus: 400 } });
  await claimWallet(ctx, wallets[1], { faucet, chain: fakeChain() });
  for (let h = 0; h < 5; h++) { ctx.env.advance(2 * 3600_000); expect((await claimWallet(ctx, wallets[1], { faucet, chain: fakeChain() })).reason).toBe('rollover_unspent'); }
  expect(callsOf(faucet, 'claim')).toHaveLength(1);
  ctx.ledger.insertSpend({ network: 'testnet', wallet_idx: 1, intent_id: 'x', miner: 'm', independence: 'independent', escrow: '1', status: 'settled', ts: ctx.env.now().toISOString() });
  ctx.env.advance(60_000);
  await claimWallet(ctx, wallets[1], { faucet, chain: fakeChain() });
  expect(callsOf(faucet, 'claim')).toHaveLength(2);
});

test('C1: refusals without an action back off 1h, 6h, then stop the wallet with an alert', async () => {
  const faucet = fakeFaucet({ result: { outcome: 'refused', reason: 'forbidden', httpStatus: 403 } });
  await claimWallet(ctx, wallets[1], { faucet, chain: fakeChain() });
  expect(ctx.ledger.getState<{ until: string }>('backoff:testnet:1')!.until).toBe('2026-11-27T13:00:00.000Z');
  ctx.env.advance(3600_000);
  await claimWallet(ctx, wallets[1], { faucet, chain: fakeChain() });
  expect(ctx.ledger.getState<{ until: string }>('backoff:testnet:1')!.until).toBe('2026-11-27T19:00:00.000Z');
  ctx.env.advance(6 * 3600_000);
  await claimWallet(ctx, wallets[1], { faucet, chain: fakeChain() });
  expect(ctx.ledger.listWallets('testnet')[1].stopped).toBe(true);
  expect(ctx.ledger.listAlerts(true).some((a) => a.kind === 'faucet_fix')).toBe(true);
  ctx.env.advance(48 * 3600_000);
  await claimWallet(ctx, wallets[1], { faucet, chain: fakeChain() });
  expect(callsOf(faucet, 'claim')).toHaveLength(3);
});

test('C2: a pre-check refusal (no HTTP status) during reconcile keeps the claim unknown', async () => {
  const faucet = fakeFaucet();
  faucet.throwOnClaim = new Error('ECONNRESET');
  await claimWallet(ctx, wallets[1], { faucet, chain: fakeChain() });
  delete faucet.throwOnClaim;
  const pre = fakeFaucet({ result: { outcome: 'refused', error: 'GET /chain timed out' } });
  await reconcileClaims(ctx, { faucet: pre, chain: fakeChain() }, wallets);
  expect(ctx.ledger.lastClaim('testnet', 1)!.status).toBe('unknown');
  ctx.env.advance(2 * 3600_000);
  expect((await claimWallet(ctx, wallets[1], { faucet: pre, chain: fakeChain() })).reason).toBe('unresolved_pending');
});

test('I3: if the endpoint reports a different miner than the one checked, nothing is bought', async () => {
  const chain = fakeChain({ balances: { [wallets[0].address]: 10n * E }, urlMiners: { 'https://miner.example': wallets[2].address } });
  const r = await spendWallet(ctx, wallets[0], { chain, miners: fakeMiners([MINER]) });
  expect(r[0]).toMatchObject({ kind: 'failed', reason: 'miner_mismatch' });
  expect(callsOf(chain, 'buyInference')).toHaveLength(0);
  expect(readdirSync(paths(ctx.home).intents)).toEqual([]);
  expect(ctx.ledger.listAlerts(true).some((a) => a.kind === 'miner_mismatch')).toBe(true);
});

test('I4: the channel id is stored at prepare time; unconfirmed purchases are polled and recovered', async () => {
  const chain = fakeChain({ balances: { [wallets[0].address]: 10n * E }, urlMiners: { 'https://miner.example': MINER.address } });
  ctx.config.perTxLimitFlop = 10;
  chain.throwOn.buyInference = Object.assign(new Error('unconfirmed'), { code: 'INFERENCE_PURCHASE_UNCONFIRMED' });
  await spendWallet(ctx, wallets[0], { chain, miners: fakeMiners([MINER]) });
  const row = ctx.ledger.spendsByStatus('testnet', ['unconfirmed'])[0];
  expect(row.channel_id).toMatch(/^0xchan/);
  chain.channels[row.channel_id!] = 'open';
  ctx.env.advance(3 * 3600_000);
  await resumeSpends(ctx, wallets, chain);
  expect(callsOf(chain, 'recoverChannel')).toHaveLength(1);
  await resumeSpends(ctx, wallets, chain);
  expect(callsOf(chain, 'recoverChannel')).toHaveLength(1); // rate-limited to once per hour
  chain.channels[row.channel_id!] = 'refunded';
  await resumeSpends(ctx, wallets, chain);
  expect(ctx.ledger.spendsByStatus('testnet', ['refunded'])).toHaveLength(1);
  expect(existsSync(join(paths(ctx.home).intents, `${row.intent_id}.json`))).toBe(false);
});

test('I5: actionGate blocks real actions while killed, paused or runtime-blocked, and when a tick holds the lock', () => {
  expect(actionGate(ctx)).toBeNull();
  ctx.ledger.setState('runtimeBlocked:testnet', 1014099);
  expect(actionGate(ctx)).toMatch(/npm run update/);
  ctx.ledger.setState('runtimeBlocked:testnet', null);
  ctx.config.paused = true;
  expect(actionGate(ctx)).toMatch(/paused/i);
  ctx.config.paused = false;
  expect(acquireLock(paths(ctx.home).lock)).toBe(true);
  expect(actionGate(ctx, { checkLock: true })).toMatch(/running right now/i);
  releaseLock(paths(ctx.home).lock);
});

test('I6 + I7 + I8: Keychain not re-asked while locked; autopilot restart and resume clear pause and stops', async () => {
  const home = join(mkdtempSync(join(tmpdir(), 'fprf2-')), 'h');
  const store = memSecretStore();
  await runInit({ home, network: 'testnet', restore: true, store, io: { print() {}, clear() {}, async ask() { return TEST_SEED; } } });
  updateConfig(home, { practice: true });
  let gets = 0;
  const counting = { ...store, async get() { gets++; throw new VaultLockedError(); } };
  const env = fakeEnv(new Date('2026-11-27T12:00:00Z'));
  env.fetch = (async () => new Response('<p>x</p>')) as typeof fetch;
  const deps = { home, env, store: counting, makeChain: async () => fakeChain(), makeFaucet: () => fakeFaucet() };
  await runTick(deps);
  env.advance(15 * 60_000);
  await runTick(deps);
  expect(gets).toBe(1);
  env.advance(7 * 3600_000);
  await runTick(deps);
  expect(gets).toBe(2);

  const l = openLedger(paths(home).ledger);
  l.setWalletFlags('testnet', 1, { stopped: true });
  l.setState('claimsStopped:testnet', true);
  l.close();
  updateConfig(home, { paused: true, killed: true });
  resumeAll(home);
  expect(loadConfig(home)).toMatchObject({ paused: false, killed: false });
  const l2 = openLedger(paths(home).ledger);
  expect(l2.listWallets('testnet')[1].stopped).toBe(false);
  expect(l2.getState('claimsStopped:testnet')).toBeNull();
  l2.close();
});
