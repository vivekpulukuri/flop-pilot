import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enrollWallet } from '../../src/enroll/enroll.js';
import type { Ctx } from '../../src/core/ctx.js';
import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { ensureDirs, paths } from '../../src/core/paths.js';
import { openLedger } from '../../src/ledger/ledger.js';
import { deriveWallets, type Wallet } from '../../src/keys/derive.js';
import { fakeChain, fakeEnv, callsOf } from '../fakes.js';
import { TEST_SEED } from '../fixtures/seed.js';

let ctx: Ctx;
let w: Wallet;
beforeEach(async () => {
  const home = join(mkdtempSync(join(tmpdir(), 'fpe-')), 'h');
  ensureDirs(home);
  const ledger = openLedger(paths(home).ledger);
  [w] = await deriveWallets(TEST_SEED, 'testnet', 1);
  ledger.upsertWallet({ network: 'testnet', index: 0, address: w.address, claimer: true });
  ctx = { home, config: { ...DEFAULT_CONFIG, network: 'testnet', practice: false }, ledger, env: fakeEnv(), network: 'testnet' };
});

test('0 balance → skipped needs_funds, no extrinsic', async () => {
  const chain = fakeChain();
  expect(await enrollWallet(ctx, w, chain)).toMatchObject({ kind: 'skipped', reason: 'needs_funds' });
  expect(callsOf(chain, 'createAgentWallet')).toHaveLength(0);
});

test('already active on chain → enrolled flag set, no extrinsic', async () => {
  const chain = fakeChain({ wallets: { [w.address]: { perTxLimit: 1n, dailyCap: 1n, active: true } } });
  expect((await enrollWallet(ctx, w, chain)).kind).toBe('skipped');
  expect(ctx.ledger.listWallets('testnet')[0].enrolled).toBe(true);
  expect(callsOf(chain, 'createAgentWallet')).toHaveLength(0);
});

test('caps passed as planck: perTxLimit 5e18, dailyCap 11e18; wallet marked enrolled', async () => {
  const chain = fakeChain({ balances: { [w.address]: 10n * 10n ** 18n } });
  expect((await enrollWallet(ctx, w, chain)).kind).toBe('done');
  expect(callsOf(chain, 'createAgentWallet')[0].args[1]).toEqual({ perTxLimit: 5n * 10n ** 18n, dailyCap: 11n * 10n ** 18n });
  expect(ctx.ledger.listWallets('testnet')[0].enrolled).toBe(true);
});

test('practice → simulated, no extrinsic', async () => {
  ctx.config.practice = true;
  const chain = fakeChain({ balances: { [w.address]: 10n * 10n ** 18n } });
  expect((await enrollWallet(ctx, w, chain)).kind).toBe('simulated');
  expect(callsOf(chain, 'createAgentWallet')).toHaveLength(0);
});

test('balance exactly enrollFeeFlop (0.01) is enough', async () => {
  const chain = fakeChain({ balances: { [w.address]: 10n ** 16n } });
  expect((await enrollWallet(ctx, w, chain)).kind).toBe('done');
});
