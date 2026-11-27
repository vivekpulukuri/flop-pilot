import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '../../src/core/config.js';
import { paths, ensureDirs, pilotHome } from '../../src/core/paths.js';

let home: string;
beforeEach(() => { home = join(mkdtempSync(join(tmpdir(), 'fp-')), 'home'); });

test('loadConfig returns DEFAULT_CONFIG when no file exists', () => {
  ensureDirs(home);
  expect(loadConfig(home)).toEqual(DEFAULT_CONFIG);
});

test('DEFAULT_CONFIG pins the spec defaults and practice mode on', () => {
  expect(DEFAULT_CONFIG).toMatchObject({
    version: 1, network: 'devnet', claimers: 3, practice: true, paused: false, killed: false,
    tickMinutes: 15, perTxLimitFlop: 5, dailyCapFlop: 11, dailySpendCeilingFlop: 30,
    feeReserveFlop: 0.1, minEscrowFlop: 0.01, enrollFeeFlop: 0.01, dashboardPort: 4747,
    myMiners: [], minerEndpoints: [], activationBlock: { devnet: null, testnet: null },
  });
});

test('saveConfig then loadConfig roundtrips', () => {
  ensureDirs(home);
  const c = { ...DEFAULT_CONFIG, network: 'testnet' as const, claimers: 2 as const, myMiners: ['5Abc'] };
  saveConfig(home, c);
  expect(loadConfig(home)).toEqual(c);
});

test('saveConfig leaves no temp files behind and file is mode 0600', () => {
  ensureDirs(home);
  saveConfig(home, DEFAULT_CONFIG);
  const files = readdirSync(paths(home).root);
  expect(files.filter((f) => f.includes('.tmp'))).toEqual([]);
  expect(statSync(paths(home).config).mode & 0o777).toBe(0o600);
});

test('loadConfig fills missing keys from defaults (older config files)', () => {
  ensureDirs(home);
  writeFileSync(paths(home).config, JSON.stringify({ version: 1, network: 'testnet' }));
  const c = loadConfig(home);
  expect(c.network).toBe('testnet');
  expect(c.claimers).toBe(3);
});

test('ensureDirs creates root with mode 0700 and subdirs', () => {
  ensureDirs(home);
  const p = paths(home);
  expect(statSync(p.root).mode & 0o777).toBe(0o700);
  for (const d of [p.intents, p.tasks, p.outputs, p.logs]) expect(statSync(d).isDirectory()).toBe(true);
});

test('pilotHome honours FLOP_PILOT_HOME', () => {
  process.env.FLOP_PILOT_HOME = '/tmp/x-flop';
  expect(pilotHome()).toBe('/tmp/x-flop');
  delete process.env.FLOP_PILOT_HOME;
  expect(pilotHome().endsWith('.flop-pilot')).toBe(true);
});
