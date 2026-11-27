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
  expect(byName(cs, 'Chain version supported')).toMatchObject({ ok: false, fix: 'Run: npm run update' });
});

test('faucet genesis mismatch fails with a stop message', async () => {
  const cs = await runDoctor(base({ faucetChain: async () => ({ network: 'testnet', genesisHash: '0xdead' }) }));
  expect(byName(cs, 'Faucet is FLOP Testnet')).toMatchObject({ ok: false, fix: 'Faucet is not FLOP Testnet — stop' });
});

test('old Node and missing keychain item fail with fixes', async () => {
  const cs = await runDoctor(base({ nodeVersion: 'v20.1.0', store: memSecretStore(null) }));
  expect(byName(cs, 'Node.js 22.13 or newer')).toMatchObject({ ok: false });
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

test.skipIf(process.platform !== 'darwin')('project inside Documents → install-location check fails with the move hint', async () => {
  const { homedir } = await import('node:os');
  const cs = await runDoctor(base({ cliPath: `${homedir()}/Documents/flop-pilot/dist/cli.js` }));
  expect(byName(cs, 'Install location works with the autopilot')).toMatchObject({ ok: false, fix: expect.stringMatching(/move the flop-pilot folder/i) });
  const ok = await runDoctor(base({ cliPath: `${homedir()}/flop-pilot/dist/cli.js` }));
  expect(byName(ok, 'Install location works with the autopilot').ok).toBe(true);
});

test('doctor names the password store and warns when it is the key file', async () => {
  const cs = await runDoctor(base({ storeKind: { kind: 'key-file', weak: true } }));
  expect(byName(cs, 'Password store')).toMatchObject({ ok: true, warn: true, detail: 'key file' });
  expect(byName(cs, 'Password store').fix).toMatch(/anyone who can log in as you/i);
  const ok = await runDoctor(base({ storeKind: { kind: 'keychain', weak: false } }));
  expect(byName(ok, 'Password store')).toMatchObject({ ok: true, detail: 'macOS Keychain' });
});

test('doctor in passphrase mode does not try to unlock (it would prompt)', async () => {
  const { setUnlockMode } = await import('../../src/platform/passphrase.js');
  const pio = { print() {}, clear() {}, ask: async () => 'paper passphrase 1', askSecret: async () => 'paper passphrase 1' };
  await setUnlockMode(home, 'passphrase', { current: store, auto: store, io: pio });
  const cs = await runDoctor(base({ store: memSecretStore(null), storeKind: { kind: 'passphrase', weak: false } }));
  expect(byName(cs, 'Vault unlocks')).toMatchObject({ ok: true, detail: expect.stringMatching(/passphrase/) });
});

test('Node 22.12 is too old for built-in SQLite; 22.13 and 24 are fine', async () => {
  expect(byName(await runDoctor(base({ nodeVersion: 'v22.12.0' })), 'Node.js 22.13 or newer').ok).toBe(false);
  expect(byName(await runDoctor(base({ nodeVersion: 'v22.13.0' })), 'Node.js 22.13 or newer').ok).toBe(true);
  expect(byName(await runDoctor(base({ nodeVersion: 'v24.1.0' })), 'Node.js 22.13 or newer').ok).toBe(true);
});
