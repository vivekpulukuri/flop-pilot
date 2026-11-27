import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor, type DoctorDeps } from '../../src/commands/doctor.js';
import { runInit } from '../../src/commands/init.js';
import { fakeChain, memSecretStore } from '../fakes.js';
import { TEST_SEED } from '../fixtures/seed.js';

let home: string;
const store = memSecretStore();
beforeEach(async () => {
  home = join(mkdtempSync(join(tmpdir(), 'fpd-')), 'h');
  await runInit({ home, network: 'testnet', restore: true, store, io: { print() {}, clear() {}, async ask() { return TEST_SEED; } } });
});

const base = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
  home, store, nodeVersion: 'v22.22.3', platform: 'darwin',
  chain: async () => fakeChain(),
  faucetChain: async () => ({ network: 'testnet', genesisHash: '0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800' }),
  launchdLoaded: async () => true,
  isSupportedSpec: (v) => v === 1014039,
  ...over,
});

const byName = (cs: Awaited<ReturnType<typeof runDoctor>>, n: string) => cs.find((c) => c.name === n)!;

test('all checks pass on a healthy setup', async () => {
  const cs = await runDoctor(base());
  expect(cs.filter((c) => !c.ok)).toEqual([]);
});

test('unsupported spec fails with the update fix', async () => {
  const cs = await runDoctor(base({ chain: async () => fakeChain({ spec: 1014099 }) }));
  expect(byName(cs, 'Chain version supported')).toMatchObject({ ok: false, fix: 'Run: flop-pilot update' });
});

test('faucet genesis mismatch fails with a stop message', async () => {
  const cs = await runDoctor(base({ faucetChain: async () => ({ network: 'testnet', genesisHash: '0xdead' }) }));
  expect(byName(cs, 'Faucet is FLOP Testnet')).toMatchObject({ ok: false, fix: 'Faucet is not FLOP Testnet — stop' });
});

test('old Node and missing keychain item fail with fixes', async () => {
  const cs = await runDoctor(base({ nodeVersion: 'v20.1.0', store: memSecretStore(null) }));
  expect(byName(cs, 'Node.js 22 or newer')).toMatchObject({ ok: false });
  expect(byName(cs, 'Vault unlocks')).toMatchObject({ ok: false });
});

test('RPC failure is reported, not thrown', async () => {
  const cs = await runDoctor(base({ chain: async () => { throw new Error('ETIMEDOUT'); } }));
  expect(byName(cs, 'Chain RPC reachable')).toMatchObject({ ok: false });
});

test('autopilot not loaded is a warning only', async () => {
  const cs = await runDoctor(base({ launchdLoaded: async () => false }));
  expect(byName(cs, 'Autopilot installed')).toMatchObject({ ok: true, warn: true });
});
