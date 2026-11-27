import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger, type Ledger, type NewClaim } from '../../src/ledger/ledger.js';

let file: string;
let l: Ledger;
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'fpl-')), 'ledger.db'); l = openLedger(file); });

const claim = (over: Partial<NewClaim> = {}): NewClaim => ({
  network: 'testnet', wallet_idx: 0, address: '5A', nonce: '1', status: 'pending', amount: '10000000000000000000',
  balance_before: '0', public_ip: '203.0.113.7', mode: 'standby', ts: '2026-11-27T00:00:00.000Z', ...over,
});

test('claimsSince counts only rows with ts >= since', () => {
  l.insertClaim(claim({ ts: '2026-11-26T00:00:00.000Z' }));
  l.insertClaim(claim({ ts: '2026-11-27T05:00:00.000Z', nonce: '2' }));
  expect(l.claimsSince('testnet', new Date('2026-11-26T12:00:00Z')).map((c) => c.nonce)).toEqual(['2']);
});

test('updateClaim patches fields and lastClaim returns newest for the wallet', () => {
  const a = l.insertClaim(claim({ nonce: '1' }));
  l.insertClaim(claim({ nonce: '2', ts: '2026-11-27T01:00:00.000Z' }));
  l.updateClaim(a, { status: 'accepted', signature: '0xsig', tx_hash: '0xt' });
  expect(l.claimsByStatus('testnet', ['accepted'])[0]).toMatchObject({ id: a, signature: '0xsig', tx_hash: '0xt' });
  expect(l.lastClaim('testnet', 0)?.nonce).toBe('2');
});

test('amounts roundtrip as bigint strings', () => {
  const id = l.insertClaim(claim({ amount: '10000000000000000000' }));
  const row = l.claimsByStatus('testnet', ['pending']).find((c) => c.id === id)!;
  expect(BigInt(row.amount!)).toBe(10n * 10n ** 18n);
});

test('networks are isolated', () => {
  l.insertClaim(claim({ network: 'testnet' }));
  expect(l.claimsSince('devnet', new Date(0))).toEqual([]);
  expect(l.claimsSince('testnet', new Date(0))).toHaveLength(1);
});

test('addAlert dedupes on an open dedupeKey; after ack a new alert is created', () => {
  expect(l.addAlert('runtime', 'upgrade', 'unsupported:1').created).toBe(true);
  const second = l.addAlert('runtime', 'upgrade', 'unsupported:1');
  expect(second.created).toBe(false);
  l.ackAlert(second.id);
  expect(l.addAlert('runtime', 'upgrade', 'unsupported:1').created).toBe(true);
  expect(l.listAlerts(true)).toHaveLength(1);
});

test('wallets upsert, flags and listing', () => {
  l.upsertWallet({ network: 'testnet', index: 0, address: '5A', claimer: true });
  l.upsertWallet({ network: 'testnet', index: 1, address: '5B', claimer: false });
  l.setWalletFlags('testnet', 0, { enrolled: true });
  const ws = l.listWallets('testnet');
  expect(ws.map((w) => [w.idx, w.address, w.claimer, w.enrolled, w.stopped])).toEqual([[0, '5A', true, true, false], [1, '5B', false, false, false]]);
});

test('spends insert, update, byStatus and since', () => {
  const id = l.insertSpend({ network: 'testnet', wallet_idx: 0, intent_id: 'i1', miner: '5M', miner_url: 'https://m', independence: 'independent', escrow: '5000000000000000000', status: 'prepared', task_id: 't1', public_ip: null, mode: 'standby', ts: '2026-11-27T02:00:00.000Z' });
  l.updateSpend(id, { status: 'settlement_posted', channel_id: '0xch', gn_used: '42', score: 0.5 });
  expect(l.spendsByStatus('testnet', ['settlement_posted'])[0]).toMatchObject({ id, channel_id: '0xch', score: 0.5 });
  expect(l.spendsSince('testnet', new Date('2026-11-27T00:00:00Z'), 0)).toHaveLength(1);
  expect(l.spendsSince('testnet', new Date('2026-11-27T03:00:00Z'))).toHaveLength(0);
});

test('state get/set roundtrips JSON; ticks start/finish; snapshots', () => {
  l.setState('backoff:0', { until: 'x' });
  expect(l.getState('backoff:0')).toEqual({ until: 'x' });
  expect(l.getState('missing')).toBeNull();
  const t = l.startTick('standby', '2026-11-27T00:00:00.000Z');
  l.finishTick(t, { actions: 1 }, ['e1'], '2026-11-27T00:00:05.000Z');
  expect(l.lastTick()).toMatchObject({ id: t, mode: 'standby', errors: ['e1'], summary: { actions: 1 } });
  l.insertSnapshot('https://x', 'h1', 'text');
  expect(l.lastSnapshot('https://x')).toMatchObject({ hash: 'h1', text: 'text' });
});

test('activity merges claims and spends newest first with filters', () => {
  l.insertClaim(claim({ ts: '2026-11-27T01:00:00.000Z' }));
  l.insertSpend({ network: 'testnet', wallet_idx: 1, intent_id: 'i', miner: '5M', miner_url: 'u', independence: 'independent', escrow: '1', status: 'prepared', task_id: 't', public_ip: '1.1.1.1', mode: 'standby', ts: '2026-11-27T02:00:00.000Z' });
  const all = l.activity('testnet', { limit: 10 });
  expect(all.map((a) => a.type)).toEqual(['spend', 'claim']);
  expect(l.activity('testnet', { type: 'claim', limit: 10 })).toHaveLength(1);
  expect(l.activity('testnet', { index: 1, limit: 10 })).toHaveLength(1);
});

test('reopen keeps user_version and data', () => {
  l.insertClaim(claim());
  l.close();
  const again = openLedger(file);
  expect(again.claimsSince('testnet', new Date(0))).toHaveLength(1);
  expect(again.schemaVersion()).toBe(1);
});
