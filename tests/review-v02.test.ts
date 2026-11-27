/** Tests for the v0.2 review findings (each failed before its fix). */
import { test, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit, type PromptIO } from '../src/commands/init.js';
import { secretStoreFor } from '../src/platform/secrets.js';
import { storeFor, setUnlockMode, passphraseStore, vaultUnlockMode } from '../src/platform/passphrase.js';
import { cronLine, schedulerFor, taskXml, vbsLauncher } from '../src/autopilot/scheduler.js';
import { runDoctor } from '../src/commands/doctor.js';
import { openDb } from '../src/ledger/db.js';
import { loadConfig } from '../src/core/config.js';
import { ensureDirs, paths } from '../src/core/paths.js';
import { decryptSeed, readVault } from '../src/keys/vault.js';
import type { ExecFn } from '../src/sys/exec.js';
import { fakeChain, memSecretStore } from './fakes.js';
import { TEST_SEED } from './fixtures/seed.js';

const newHome = () => { const h = join(mkdtempSync(join(tmpdir(), 'fpv2-')), 'h'); return h; };
const io = (answers: string[]): PromptIO => { const q = [...answers]; return { print() {}, clear() {}, ask: async () => q.shift() ?? '', askSecret: async () => q.shift() ?? '' }; };

test('C1: the chosen store kind is saved at init and used later even without the desktop session env', async () => {
  const home = newHome();
  const store = memSecretStore();
  await runInit({ home, network: 'devnet', restore: true, io: io([TEST_SEED]), store: Object.assign(store, { kind: 'secret-service' as const, weak: false }) });
  expect(loadConfig(home).store).toBe('secret-service');
  const s = secretStoreFor(home, { plat: 'linux', exec: async () => ({ stdout: '' }), env: {}, hasCommand: () => true, kind: loadConfig(home).store });
  expect(s.kind).toBe('secret-service');
});

test('C1: cron line passes the desktop session bus address when the keyring is used', () => {
  const l = cronLine({ home: '/h', nodePath: '/n', cliPath: '/c', intervalMin: 15, env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' } }, 't');
  expect(l).toContain("DBUS_SESSION_BUS_ADDRESS='unix:path=/run/user/1000/bus' FLOP_PILOT_HOME='/h'");
});

test('I9: Linux keyring is only chosen with a desktop display; SSH session with a bus → key file', () => {
  const env = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' };
  expect(secretStoreFor(newHome(), { plat: 'linux', exec: async () => ({ stdout: '' }), env, hasCommand: () => true }).kind).toBe('key-file');
  expect(secretStoreFor(newHome(), { plat: 'linux', exec: async () => ({ stdout: '' }), env: { ...env, DISPLAY: ':0' }, hasCommand: () => true }).kind).toBe('secret-service');
});

test('I9: if the keyring refuses during init, setup falls back to the key file and records it', async () => {
  const home = newHome();
  const failing = Object.assign(memSecretStore(), { kind: 'secret-service' as const, weak: false, async set() { throw new Error('keyring locked'); } });
  await runInit({ home, network: 'devnet', restore: true, io: io([TEST_SEED]), store: failing });
  expect(loadConfig(home).store).toBe('key-file');
  expect(readFileSync(join(home, 'vault.key'), 'utf8').trim().length).toBeGreaterThan(20);
});

test('I2: a crontab read failure that is not "no crontab" aborts without writing', async () => {
  const writes: string[] = [];
  const exec: ExecFn = async (_f, args, o = {}) => {
    if (args[0] === '-l') throw Object.assign(new Error('crontab: LDAP lookup timed out'), { code: 1 });
    writes.push(o.input ?? ''); return { stdout: '' };
  };
  await expect(schedulerFor('linux', exec).install({ home: '/h', nodePath: '/n', cliPath: '/c', intervalMin: 15 })).rejects.toThrow(/nothing was changed/i);
  const killed: ExecFn = async (_f, args) => { if (args[0] === '-l') throw Object.assign(new Error('killed'), { code: null }); writes.push('x'); return { stdout: '' }; };
  await expect(schedulerFor('linux', killed).install({ home: '/h', nodePath: '/n', cliPath: '/c', intervalMin: 15 })).rejects.toThrow(/nothing was changed/i);
  expect(writes).toEqual([]);
});

test('I3: the Windows .vbs is written as UTF-16LE with a BOM so accented user names survive', async () => {
  const home = newHome(); ensureDirs(home);
  await schedulerFor('win32', async () => ({ stdout: '' })).install({ home, nodePath: 'C:\\node.exe', cliPath: 'C:\\Users\\José\\flop-pilot\\dist\\cli.js', intervalMin: 15 });
  const bytes = readFileSync(join(home, 'run-tick.vbs'));
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe]);
  expect(bytes.toString('utf16le')).toContain('José');
  expect(vbsLauncher({ home: 'C:\\h', nodePath: 'C:\\n.exe', cliPath: 'C:\\c.js' })).toContain('0, False');
});

test('I4: the Windows task runs on battery, catches up after sleep, and is created from XML', async () => {
  const x = taskXml('C:\\Users\\Ann & Lee\\.flop-pilot\\run-tick.vbs', 15);
  expect(x).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>');
  expect(x).toContain('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>');
  expect(x).toContain('<StartWhenAvailable>true</StartWhenAvailable>');
  expect(x).toContain('<Interval>PT15M</Interval>');
  expect(x).toContain('<Arguments>"C:\\Users\\Ann &amp; Lee\\.flop-pilot\\run-tick.vbs"</Arguments>');
  const home = newHome(); ensureDirs(home);
  const calls: string[][] = [];
  await schedulerFor('win32', async (f, a) => { calls.push([f, ...a]); return { stdout: '' }; }).install({ home, nodePath: 'C:\\n.exe', cliPath: 'C:\\c.js', intervalMin: 15 });
  expect(calls[0]).toEqual(['schtasks', '/Create', '/F', '/TN', 'flop-pilot-' + calls[0][4].slice(11), '/XML', join(home, 'task.xml')]);
  const xb = readFileSync(join(home, 'task.xml'));
  expect([xb[0], xb[1]]).toEqual([0xff, 0xfe]);
});

test('I5: the unlock mode lives in the vault; a failed cleanup after switching cannot lock the user out', async () => {
  const home = newHome();
  const store = memSecretStore();
  await runInit({ home, network: 'devnet', restore: true, io: io([TEST_SEED]), store });
  const brokenRemove = Object.assign(store, { async remove() { throw new Error('file in use'); } });
  await setUnlockMode(home, 'passphrase', { current: brokenRemove, auto: brokenRemove, io: io(['paper passphrase 1', 'paper passphrase 1']) });
  expect(vaultUnlockMode(home)).toBe('passphrase');
  expect(readVault(paths(home).vault).unlock).toBe('passphrase');
  expect(decryptSeed(readVault(paths(home).vault), 'paper passphrase 1')).toBe(TEST_SEED);
  expect(storeFor(home, { ask: null }).kind).toBe('passphrase');
  await setUnlockMode(home, 'auto', { current: passphraseStore(async () => 'paper passphrase 1'), auto: memSecretStore(), io: io([]) });
  expect(vaultUnlockMode(home)).toBe('auto');
});

test('I7: busy_timeout is set when the ledger opens', () => {
  const home = newHome(); ensureDirs(home);
  const db = openDb(paths(home).ledger);
  expect((db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout).toBe(5000);
  db.close();
});

test('I8: doctor accepts Windows and Linux and uses neutral wording', async () => {
  const home = newHome();
  const store = memSecretStore();
  await runInit({ home, network: 'testnet', restore: true, io: io([TEST_SEED]), store });
  for (const platform of ['win32', 'linux']) {
    const cs = await runDoctor({ home, store, nodeVersion: 'v22.22.3', platform, chain: async () => fakeChain(), faucetChain: async () => ({ network: 'testnet', genesisHash: '0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800' }), launchdLoaded: async () => true, isSupportedSpec: () => true });
    expect(cs.filter((c) => !c.ok).map((c) => c.name)).toEqual([]);
    expect(JSON.stringify(cs)).not.toMatch(/macOS only|Mac Keychain/);
  }
});
