import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit, type PromptIO } from '../../src/commands/init.js';
import { passphraseStore, storeFor } from '../../src/platform/passphrase.js';
import { autopilotOn, runLoop } from '../../src/commands/autopilot.js';
import { decryptSeed, readVault, VaultLockedError } from '../../src/keys/vault.js';
import { loadConfig } from '../../src/core/config.js';
import { paths } from '../../src/core/paths.js';
import { fakeChain, fakeEnv, fakeFaucet, memSecretStore } from '../fakes.js';
import { TEST_SEED } from '../fixtures/seed.js';

let home: string;
beforeEach(() => { home = join(mkdtempSync(join(tmpdir(), 'fppp-')), 'h'); });

function io(answers: string[], out: string[] = []): PromptIO & { out: string[] } {
  const q = [...answers];
  return { out, print: (s) => out.push(s), clear() {}, ask: async () => q.shift() ?? '', askSecret: async () => q.shift() ?? '' };
}

test('passphrase mode: vault opens with the passphrase, nothing goes to the secret store', async () => {
  const store = memSecretStore();
  const o = io([TEST_SEED, 'correct horse battery', 'correct horse battery']);
  await runInit({ home, network: 'devnet', restore: true, io: o, store, unlock: 'passphrase' });
  expect(store.value).toBeNull();
  expect(decryptSeed(readVault(paths(home).vault), 'correct horse battery')).toBe(TEST_SEED);
  expect(loadConfig(home).unlock).toBe('passphrase');
  expect(o.out.join('\n')).toMatch(/Write this passphrase on paper/);
});

test('passphrase too short or not matching is asked again; 3 failures save nothing', async () => {
  await runInit({ home, network: 'devnet', restore: true, io: io([TEST_SEED, 'short', 'a long enough phrase', 'different phrase!!', 'a long enough phrase', 'a long enough phrase']), store: memSecretStore(), unlock: 'passphrase' });
  expect(decryptSeed(readVault(paths(home).vault), 'a long enough phrase')).toBe(TEST_SEED);
  const home2 = join(mkdtempSync(join(tmpdir(), 'fppp-')), 'h');
  await expect(runInit({ home: home2, network: 'devnet', restore: true, io: io([TEST_SEED, 'x', 'y', 'z']), store: memSecretStore(), unlock: 'passphrase' })).rejects.toThrow(/nothing was saved/i);
  expect(existsSync(paths(home2).vault)).toBe(false);
});

test('passphraseStore asks once and remembers for this run; without a terminal it refuses', async () => {
  let asked = 0;
  const s = passphraseStore(async () => { asked++; return 'pw phrase here'; });
  expect(await s.get()).toBe('pw phrase here');
  expect(await s.get()).toBe('pw phrase here');
  expect(asked).toBe(1);
  expect(s.kind).toBe('passphrase');
  await expect(passphraseStore(null).get()).rejects.toBeInstanceOf(VaultLockedError);
});

test('storeFor picks the passphrase store when config.unlock is passphrase', async () => {
  await runInit({ home, network: 'devnet', restore: true, io: io([TEST_SEED, 'a long enough phrase', 'a long enough phrase']), store: memSecretStore(), unlock: 'passphrase' });
  expect(storeFor(home, { ask: null }).kind).toBe('passphrase');
});

test('autopilot:on refuses in passphrase mode and points to autopilot:run', async () => {
  await runInit({ home, network: 'devnet', restore: true, io: io([TEST_SEED, 'a long enough phrase', 'a long enough phrase']), store: memSecretStore(), unlock: 'passphrase' });
  await expect(autopilotOn(home)).rejects.toThrow(/npm run autopilot:run/);
});

test('runLoop runs ticks on an interval with the in-memory passphrase', async () => {
  await runInit({ home, network: 'devnet', restore: true, io: io([TEST_SEED, 'a long enough phrase', 'a long enough phrase']), store: memSecretStore(), unlock: 'passphrase' });
  const env = fakeEnv();
  env.fetch = (async () => new Response('<p>x</p>')) as typeof fetch;
  const summaries: unknown[] = [];
  await runLoop({ home, env, store: passphraseStore(async () => 'a long enough phrase'), makeChain: async () => fakeChain(), makeFaucet: () => fakeFaucet() }, { intervalMs: 0, maxTicks: 2, onTick: (s) => summaries.push(s) });
  expect(summaries).toHaveLength(2);
  expect((summaries[0] as { skippedAll?: string }).skippedAll).toBeUndefined();
});

test('switch an existing install to passphrase mode and back', async () => {
  const { setUnlockMode } = await import('../../src/platform/passphrase.js');
  const store = memSecretStore();
  await runInit({ home, network: 'devnet', restore: true, io: io([TEST_SEED]), store });
  await setUnlockMode(home, 'passphrase', { current: store, auto: store, io: io(['my paper passphrase', 'my paper passphrase']) });
  expect(loadConfig(home).unlock).toBe('passphrase');
  expect(store.value).toBeNull();
  expect(decryptSeed(readVault(paths(home).vault), 'my paper passphrase')).toBe(TEST_SEED);
  await setUnlockMode(home, 'auto', { current: passphraseStore(async () => 'my paper passphrase'), auto: store, io: io([]) });
  expect(loadConfig(home).unlock).toBe('auto');
  expect(store.value).toBeTruthy();
  expect(decryptSeed(readVault(paths(home).vault), store.value!)).toBe(TEST_SEED);
});
