import { test, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimWallet, reconcileClaims, lastGrantSpent, SHARED_IP_ALERT } from '../../src/faucet/claim.js';
import type { Ctx } from '../../src/core/ctx.js';
import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { ensureDirs, paths } from '../../src/core/paths.js';
import { openLedger } from '../../src/ledger/ledger.js';
import { deriveWallets, type Wallet } from '../../src/keys/derive.js';
import { fakeChain, fakeEnv, fakeFaucet, callsOf } from '../fakes.js';
import { TEST_SEED } from '../fixtures/seed.js';

let ctx: Ctx & { env: ReturnType<typeof fakeEnv> };
let wallets: Wallet[];
const GRANT = 10n * 10n ** 18n;

beforeEach(async () => {
  const home = join(mkdtempSync(join(tmpdir(), 'fpc-')), 'h');
  ensureDirs(home);
  const ledger = openLedger(paths(home).ledger);
  wallets = await deriveWallets(TEST_SEED, 'testnet', 3);
  for (const w of wallets) ledger.upsertWallet({ network: 'testnet', index: w.index, address: w.address, claimer: true });
  ctx = { home, config: { ...DEFAULT_CONFIG, network: 'testnet', practice: false }, ledger, env: fakeEnv(new Date('2026-11-27T12:00:00Z')), network: 'testnet' };
});

test('practice mode: faucet.claim is never called and no claims row is written', async () => {
  ctx.config.practice = true;
  const faucet = fakeFaucet();
  const r = await claimWallet(ctx, wallets[0], { faucet, chain: fakeChain() });
  expect(r).toMatchObject({ kind: 'simulated' });
  expect(r.detail).toMatch(/would claim 10 FLOP for wallet #0/);
  expect(callsOf(faucet, 'claim')).toHaveLength(0);
  expect(ctx.ledger.claimsSince('testnet', new Date(0))).toHaveLength(0);
});

test('accepted claim records tx, IP, nonce and balance_before', async () => {
  const r = await claimWallet(ctx, wallets[0], { faucet: fakeFaucet(), chain: fakeChain() });
  expect(r.kind).toBe('done');
  const row = ctx.ledger.lastClaim('testnet', 0)!;
  expect(row).toMatchObject({ status: 'accepted', public_ip: '203.0.113.7', balance_before: '0', amount: GRANT.toString() });
  expect(row.signature).toMatch(/^0x[0-9a-f]{128}$/);
  expect(row.tx_hash).toBe('0xtx' + row.nonce);
});

test('signature is persisted before the POST: a network failure leaves an unknown row with the signature', async () => {
  const faucet = fakeFaucet();
  faucet.throwOnClaim = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  const r = await claimWallet(ctx, wallets[0], { faucet, chain: fakeChain() });
  expect(r.kind).toBe('failed');
  const row = ctx.ledger.lastClaim('testnet', 0)!;
  expect(row.status).toBe('unknown');
  expect(row.signature).toMatch(/^0x/);
});

test('REVIEW-FOCUS-1: reconcile resends the identical nonce and signature without signing again', async () => {
  const faucet = fakeFaucet();
  faucet.throwOnClaim = new Error('ECONNRESET');
  await claimWallet(ctx, wallets[0], { faucet, chain: fakeChain() });
  const before = ctx.ledger.lastClaim('testnet', 0)!;
  delete faucet.throwOnClaim;
  const spy = vi.spyOn(wallets[0].pair, 'sign');
  await reconcileClaims(ctx, { faucet, chain: fakeChain() }, wallets);
  expect(spy).not.toHaveBeenCalled();
  const posts = callsOf(faucet, 'claim');
  expect(posts).toHaveLength(2);
  expect(posts[1].args).toEqual([wallets[0].address, before.nonce, before.signature]);
  expect(ctx.ledger.lastClaim('testnet', 0)!.status).toBe('accepted');
});

test('refused retry_later 3600 sets backoff; a second call is skipped without a POST', async () => {
  const faucet = fakeFaucet({ result: { outcome: 'refused', action: 'retry_later', retryAfterSeconds: 3600, reason: 'cooldown' } });
  await claimWallet(ctx, wallets[0], { faucet, chain: fakeChain() });
  expect(ctx.ledger.getState<{ until: string }>('backoff:testnet:0')!.until).toBe('2026-11-27T13:00:00.000Z');
  const second = await claimWallet(ctx, wallets[0], { faucet, chain: fakeChain() });
  expect(second).toMatchObject({ kind: 'skipped', reason: 'backoff' });
  expect(callsOf(faucet, 'claim')).toHaveLength(1);
});

test('refused report_to_operator stops all claims and alerts', async () => {
  const faucet = fakeFaucet({ result: { outcome: 'refused', action: 'report_to_operator', reason: 'faucet_misconfigured', error: 'contact us' } });
  await claimWallet(ctx, wallets[0], { faucet, chain: fakeChain() });
  const other = await claimWallet(ctx, wallets[1], { faucet, chain: fakeChain() });
  expect(other).toMatchObject({ kind: 'skipped', reason: 'claims_stopped' });
  expect(ctx.ledger.listAlerts(true)[0].kind).toBe('faucet_report');
  expect(callsOf(ctx.env, 'notify')).toHaveLength(1);
});

test('refused fix_request stops only that wallet', async () => {
  const faucet = fakeFaucet({ result: { outcome: 'refused', action: 'fix_request', reason: 'bad_signature' } });
  await claimWallet(ctx, wallets[0], { faucet, chain: fakeChain() });
  expect(ctx.ledger.listWallets('testnet')[0].stopped).toBe(true);
  expect(ctx.ledger.listWallets('testnet')[1].stopped).toBe(false);
});

test('agent_spend_missing is treated as rollover, not a wallet stop', async () => {
  const faucet = fakeFaucet({ result: { outcome: 'refused', action: 'fix_request', reason: 'agent_spend_missing' } });
  const r = await claimWallet(ctx, wallets[0], { faucet, chain: fakeChain() });
  expect(r).toMatchObject({ kind: 'skipped', reason: 'rollover_unspent' });
  expect(ctx.ledger.listWallets('testnet')[0].stopped).toBe(false);
  expect(ctx.ledger.getState('backoff:testnet:0')).not.toBeNull();
});

test('IP-limit refusal pauses all claims for 24h with the spec alert text', async () => {
  const faucet = fakeFaucet({ result: { outcome: 'refused', action: 'retry_later', reason: 'ip_daily_limit', retryAfterSeconds: 5000 } });
  await claimWallet(ctx, wallets[0], { faucet, chain: fakeChain() });
  expect(ctx.ledger.getState<string>('sharedIpPauseUntil:testnet')).toBe('2026-11-28T12:00:00.000Z');
  expect(ctx.ledger.listAlerts(true)[0].message).toBe(SHARED_IP_ALERT);
  expect(SHARED_IP_ALERT).toBe('Another install or device may share your internet connection. Lower the number of claiming wallets, or set up only one install per connection.');
  expect(await claimWallet(ctx, wallets[1], { faucet, chain: fakeChain() })).toMatchObject({ kind: 'skipped', reason: 'shared_ip_pause' });
});

test('unavailable backs off 1h then 2h', async () => {
  const faucet = fakeFaucet({ result: { outcome: 'unavailable' } });
  await claimWallet(ctx, wallets[0], { faucet, chain: fakeChain() });
  expect(ctx.ledger.getState<{ until: string }>('backoff:testnet:0')!.until).toBe('2026-11-27T13:00:00.000Z');
  ctx.env.advance(3600_000);
  await claimWallet(ctx, wallets[0], { faucet, chain: fakeChain() });
  expect(ctx.ledger.getState<{ until: string; attempt: number }>('backoff:testnet:0')).toEqual({ until: '2026-11-27T15:00:00.000Z', attempt: 2 });
});

test('3 counted claims in the last 24h (any wallets) block a 4th with no POST', async () => {
  const faucet = fakeFaucet();
  for (const [i, status] of [[1, 'accepted'], [2, 'finalized'], [1, 'unknown']] as const) {
    ctx.ledger.insertClaim({ network: 'testnet', wallet_idx: i, address: wallets[i].address, nonce: String(i) + status, status, ts: '2026-11-27T01:00:00.000Z' });
  }
  ctx.ledger.insertClaim({ network: 'testnet', wallet_idx: 2, address: wallets[2].address, nonce: '9', status: 'refused', ts: '2026-11-27T02:00:00.000Z' });
  const r = await claimWallet(ctx, wallets[0], { faucet, chain: fakeChain() });
  expect(r).toMatchObject({ kind: 'skipped', reason: 'global_cap' });
  expect(callsOf(faucet, 'claim')).toHaveLength(0);
});

test('three wallets can each claim once in a day', async () => {
  const faucet = fakeFaucet();
  for (const w of wallets) expect((await claimWallet(ctx, w, { faucet, chain: fakeChain() })).kind).toBe('done');
  expect(callsOf(faucet, 'claim')).toHaveLength(3);
});

test('reconcile marks an accepted claim finalized once the finalized balance includes the grant', async () => {
  const chain = fakeChain();
  await claimWallet(ctx, wallets[0], { faucet: fakeFaucet(), chain });
  chain.balances[wallets[0].address] = GRANT;
  await reconcileClaims(ctx, { faucet: fakeFaucet(), chain }, wallets);
  expect(ctx.ledger.lastClaim('testnet', 0)).toMatchObject({ status: 'finalized', finalized_block: 1000 });
});

test('lastGrantSpent is true only with a settled spend after the last claim', async () => {
  await claimWallet(ctx, wallets[0], { faucet: fakeFaucet(), chain: fakeChain() });
  expect(lastGrantSpent(ctx, 0)).toBe(false);
  ctx.ledger.insertSpend({ network: 'testnet', wallet_idx: 0, intent_id: 'i', miner: '5M', independence: 'independent', escrow: '1', status: 'settled', ts: '2026-11-27T13:00:00.000Z' });
  expect(lastGrantSpent(ctx, 0)).toBe(true);
});
