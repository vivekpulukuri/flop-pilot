import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickLatestTag, runUpdate } from '../../src/commands/update.js';
import { runExport } from '../../src/commands/export.js';
import { ensureDirs, paths } from '../../src/core/paths.js';
import { openLedger } from '../../src/ledger/ledger.js';

test('pickLatestTag picks the highest vX.Y.Z and ignores pre-releases', () => {
  expect(pickLatestTag(['v0.1.0', 'v0.10.0', 'v0.9.1', 'v1.0.0-rc1', 'junk'])).toBe('v0.10.0');
  expect(pickLatestTag([])).toBeNull();
});

function gitRecorder(status: string, tags: string) {
  const calls: string[][] = [];
  return {
    calls,
    exec: async (file: string, args: string[]) => {
      calls.push([file, ...args]);
      if (args[0] === 'status') return { stdout: status };
      if (args[0] === 'tag') return { stdout: tags };
      return { stdout: '' };
    },
  };
}

test('runUpdate aborts on a dirty tree without checking out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fpu-')); mkdirSync(join(dir, '.git'));
  const g = gitRecorder(' M src/cli.ts\n', 'v0.1.0\n');
  const r = await runUpdate({ cwd: dir, exec: g.exec, doctor: async () => true });
  expect(r.ok).toBe(false);
  expect(r.message).toMatch(/local changes/i);
  expect(g.calls.some((c) => c[1] === 'checkout')).toBe(false);
});

test('runUpdate fetches tags, checks out the newest tag, runs npm ci and doctor; never pushes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fpu-')); mkdirSync(join(dir, '.git'));
  const g = gitRecorder('', 'v0.1.0\nv0.2.0\n');
  let doctored = false;
  const r = await runUpdate({ cwd: dir, exec: g.exec, doctor: async () => { doctored = true; return true; } });
  expect(r.ok).toBe(true);
  expect(g.calls.map((c) => c.slice(1).join(' '))).toEqual(['status --porcelain', 'fetch --tags --force', 'tag --list v*', 'checkout --quiet v0.2.0', 'ci --no-fund --no-audit']);
  expect(g.calls.every((c) => !c.includes('push'))).toBe(true);
  expect(doctored).toBe(true);
});

test('runUpdate without .git explains the ZIP re-download', async () => {
  const r = await runUpdate({ cwd: mkdtempSync(join(tmpdir(), 'fpu-')), exec: async () => ({ stdout: '' }), doctor: async () => true });
  expect(r.ok).toBe(false);
  expect(r.message).toMatch(/ZIP/);
});

let home: string;
beforeEach(() => {
  home = join(mkdtempSync(join(tmpdir(), 'fpx-')), 'h'); ensureDirs(home);
  const l = openLedger(paths(home).ledger);
  l.insertClaim({ network: 'testnet', wallet_idx: 0, address: '5A', nonce: '1', status: 'finalized', signature: '0xSIGNATURE', public_ip: '203.0.113.7', amount: '10', ts: '2026-11-27T00:00:00.000Z' });
  l.insertSpend({ network: 'testnet', wallet_idx: 0, intent_id: 'intent-123', miner: '5M', independence: 'independent', escrow: '5', status: 'settled', public_ip: '203.0.113.7', ts: '2026-11-27T01:00:00.000Z' });
  l.close();
});

test('export redacts IP by default and never includes signatures or intent ids', () => {
  for (const format of ['csv', 'json'] as const) {
    const out = runExport(home, { format, withIp: false, network: 'testnet' });
    expect(out).toContain('redacted');
    expect(out).not.toContain('203.0.113.7');
    expect(out).not.toContain('0xSIGNATURE');
    expect(out).not.toMatch(/signature/i);
    expect(out).not.toContain('intent-123');
  }
  expect(runExport(home, { format: 'csv', withIp: true, network: 'testnet' })).toContain('203.0.113.7');
});
