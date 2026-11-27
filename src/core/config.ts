import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import type { Config } from './types.js';
import { paths } from './paths.js';

export const DEFAULT_CONFIG: Config = Object.freeze({
  version: 1,
  network: 'devnet',
  claimers: 3,
  practice: true,
  paused: false,
  killed: false,
  tickMinutes: 15,
  perTxLimitFlop: 5,
  dailyCapFlop: 11,
  dailySpendCeilingFlop: 30,
  feeReserveFlop: 0.1,
  minEscrowFlop: 0.01,
  enrollFeeFlop: 0.01,
  myMiners: [],
  minerEndpoints: [],
  activationBlock: { devnet: null, testnet: null },
  dashboardPort: 4747,
  unlock: 'auto',
  store: null,
}) as Config;

function clone(c: Config): Config {
  return JSON.parse(JSON.stringify(c)) as Config;
}

export function loadConfig(home: string): Config {
  const file = paths(home).config;
  if (!existsSync(file)) return clone(DEFAULT_CONFIG);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>;
  const base = clone(DEFAULT_CONFIG);
  return { ...base, ...raw, activationBlock: { ...base.activationBlock, ...(raw.activationBlock ?? {}) } };
}

/** Atomic write: temp file in the same dir, then rename. */
export function saveConfig(home: string, c: Config): void {
  const file = paths(home).config;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}

export function updateConfig(home: string, patch: Partial<Config>): Config {
  const next = { ...loadConfig(home), ...patch };
  saveConfig(home, next);
  return next;
}
