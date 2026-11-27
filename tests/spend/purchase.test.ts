import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spendWallet, resumeSpends } from '../../src/spend/purchase.js';
import type { Ctx } from '../../src/core/ctx.js';
import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { ensureDirs, paths } from '../../src/core/paths.js';
import { openLedger } from '../../src/ledger/ledger.js';
import { deriveWallets, type Wallet } from '../../src/keys/derive.js';
import { fakeChain, fakeEnv, fakeMiners, callsOf } from '../fakes.js';
import { TEST_SEED } from '../fixtures/seed.js';

const E = 10n ** 18n;
let ctx: Ctx;
let wallets: Wallet[];
const MINER = { address: '5MinerIndependent', url: 'https://miner.example', models: [], linkedAccounts: [] };

beforeEach(async () => {
  const home = join(mkdtempSync(join(tmpdir(), 'fpp-')), 'h');
  ensureDirs(home);
  const ledger = openLedger(paths(home).ledger);
  wallets = await deriveWallets(TEST_SEED, 'testnet', 3);
  for (const w of wallets) ledger.upsertWallet({ network: 'testnet', index: w.index, address: w.address, claimer: true });
  ledger.setWalletFlags('testnet', 0, { enrolled: true });
  ctx = { home, config: { ...DEFAULT_CONFIG, network: 'testnet', practice: false }, ledger, env: fakeEnv(new Date('2026-11-27T12:00:00Z')), network: 'testnet' };
});

const funded = () => fakeChain({ balances: { [wallets[0].address]: 10n * E + E / 10n } });

test('practice → simulated "would spend", no prepare or buy', async () => {
  ctx.config.practice = true;
  const chain = funded();
  const r = await spendWallet(ctx, wallets[0], { chain, miners: fakeMiners([MINER]) });
  expect(r.map((x) => x.kind)).toEqual(['simulated', 'simulated']);
  expect(r[0].detail).toMatch(/would spend 5\.0000 FLOP to miner 5MinerIndependent/);
  expect(callsOf(chain, 'prepareInference')).toHaveLength(0);
  expect(callsOf(chain, 'buyInference')).toHaveLength(0);
});

test('only non-independent miners → skipped, no chain purchase calls', async () => {
  const chain = funded();
  const r = await spendWallet(ctx, wallets[0], { chain, miners: fakeMiners([{ ...MINER, linkedAccounts: null }, { ...MINER, address: wallets[1].address }]) });
  expect(r).toEqual([expect.objectContaining({ kind: 'skipped', reason: 'no_independent_miner' })]);
  expect(r[0].detail).toMatch(/2 miners found/);
  expect(callsOf(chain, 'prepareInference')).toHaveLength(0);
});

test('independent miner without an endpoint URL is not spent to', async () => {
  const r = await spendWallet(ctx, wallets[0], { chain: funded(), miners: fakeMiners([{ ...MINER, url: null }]) });
  expect(r[0]).toMatchObject({ kind: 'skipped', reason: 'no_independent_miner' });
});

test('not enrolled → skipped', async () => {
  const r = await spendWallet(ctx, wallets[1], { chain: funded(), miners: fakeMiners([MINER]) });
  expect(r[0]).toMatchObject({ kind: 'skipped', reason: 'not_enrolled' });
});

test('happy path: 0600 intent file, output file, settlement_posted rows with channel and score', async () => {
  const chain = funded();
  const r = await spendWallet(ctx, wallets[0], { chain, miners: fakeMiners([MINER]) });
  expect(r.map((x) => x.kind)).toEqual(['done', 'done']);
  const rows = ctx.ledger.spendsByStatus('testnet', ['settlement_posted']);
  expect(rows.map((s) => BigInt(s.escrow))).toEqual([5n * E, 5n * E]);
  expect(rows[0]).toMatchObject({ miner: '5MinerIndependent', independence: 'independent', public_ip: '203.0.113.7' });
  expect(rows[0].channel_id).toMatch(/^0xch/);
  const intentFile = join(paths(ctx.home).intents, `${rows[0].intent_id}.json`);
  expect(statSync(intentFile).mode & 0o777).toBe(0o600);
  expect(readdirSync(paths(ctx.home).outputs)).toHaveLength(2);
  expect(readFileSync(rows[0].output_path!, 'utf8')).toContain('ok answer');
});

test('respects the daily spend ceiling across wallets', async () => {
  ctx.config.dailySpendCeilingFlop = 7;
  ctx.ledger.insertSpend({ network: 'testnet', wallet_idx: 2, intent_id: 'old', miner: 'x', independence: 'independent', escrow: (4n * E).toString(), status: 'settled', ts: '2026-11-27T06:00:00.000Z' });
  await spendWallet(ctx, wallets[0], { chain: funded(), miners: fakeMiners([MINER]) });
  expect(ctx.ledger.spendsByStatus('testnet', ['settlement_posted']).map((s) => BigInt(s.escrow))).toEqual([3n * E]);
});

test('REVIEW-FOCUS-1: crash after intent saved → resume buys with the same intent, prepare stays at 1', async () => {
  const chain = funded();
  chain.throwOn.buyInference = new Error('socket hang up');
  ctx.config.perTxLimitFlop = 10;
  const first = await spendWallet(ctx, wallets[0], { chain, miners: fakeMiners([MINER]) });
  expect(first[0].kind).toBe('failed');
  const row = ctx.ledger.spendsByStatus('testnet', ['prepared'])[0];
  expect(row).toBeTruthy();
  await resumeSpends(ctx, wallets, chain);
  expect(callsOf(chain, 'prepareInference')).toHaveLength(1);
  const buys = callsOf(chain, 'buyInference');
  expect(buys).toHaveLength(2);
  expect(buys[1].args[1]).toBe(row.intent_id);
  expect(ctx.ledger.spendsByStatus('testnet', ['settlement_posted'])).toHaveLength(1);
});

test('INFERENCE_PURCHASE_UNCONFIRMED → unconfirmed + alert, never re-prepared', async () => {
  const chain = funded();
  ctx.config.perTxLimitFlop = 10;
  chain.throwOn.buyInference = Object.assign(new Error('purchase unconfirmed'), { code: 'INFERENCE_PURCHASE_UNCONFIRMED' });
  await spendWallet(ctx, wallets[0], { chain, miners: fakeMiners([MINER]) });
  expect(ctx.ledger.spendsByStatus('testnet', ['unconfirmed'])).toHaveLength(1);
  expect(ctx.ledger.listAlerts(true)[0].kind).toBe('purchase_unconfirmed');
  await resumeSpends(ctx, wallets, chain);
  expect(callsOf(chain, 'prepareInference')).toHaveLength(1);
  expect(callsOf(chain, 'buyInference')).toHaveLength(1);
});

test('resume moves settlement_posted → settled when the channel settles', async () => {
  const chain = funded();
  await spendWallet(ctx, wallets[0], { chain, miners: fakeMiners([MINER]) });
  for (const id of Object.keys(chain.channels)) chain.channels[id] = 'settled';
  await resumeSpends(ctx, wallets, chain);
  expect(ctx.ledger.spendsByStatus('testnet', ['settled'])).toHaveLength(2);
});

test('the intent secret never appears in the ledger', async () => {
  await spendWallet(ctx, wallets[0], { chain: funded(), miners: fakeMiners([MINER]) });
  expect(JSON.stringify(ctx.ledger.activity('testnet', { limit: 50 }))).not.toContain('s3cr3t');
  expect(readFileSync(paths(ctx.home).ledger, 'latin1')).not.toContain('s3cr3t');
});

test('no-miner message is plain English, not JSON', async () => {
  const r = await spendWallet(ctx, wallets[0], { chain: funded(), miners: fakeMiners([{ ...MINER, url: null }, { ...MINER, address: '5B', url: null }, { ...MINER, address: '5C', linkedAccounts: null }]) });
  expect(r[0].detail).toBe('wallet #0: no miner to buy from yet. 3 miners found: 2 have no endpoint added yet, 1 could not be checked for independence. Add a miner endpoint on the Controls page.');
});
