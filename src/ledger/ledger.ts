import { chmodSync, existsSync } from 'node:fs';
import type { Network } from '../core/types.js';
import { openDb } from './db.js';

export type ClaimStatus = 'pending' | 'accepted' | 'refused' | 'unavailable' | 'unknown' | 'finalized';
export type SpendStatus = 'prepared' | 'settlement_posted' | 'settled' | 'refunded' | 'unconfirmed' | 'failed';
export type Mode = 'standby' | 'earning';

export interface WalletRow { network: Network; idx: number; address: string; claimer: boolean; enrolled: boolean; stopped: boolean; }

export interface ClaimRow {
  id: number; network: Network; wallet_idx: number; address: string; nonce: string; signature: string | null;
  status: ClaimStatus; reason: string | null; action: string | null; retry_after: number | null;
  tx_hash: string | null; transfer_status: string | null; finalized_block: number | null;
  amount: string | null; balance_before: string | null; public_ip: string | null; mode: string | null;
  error: string | null; ts: string; updated_ts: string | null;
}
export type NewClaim = Pick<ClaimRow, 'network' | 'wallet_idx' | 'address' | 'nonce' | 'status' | 'ts'> & Partial<Omit<ClaimRow, 'id'>>;

export interface SpendRow {
  id: number; network: Network; wallet_idx: number; intent_id: string; miner: string; miner_url: string | null;
  independence: string; escrow: string; fee: string | null; channel_id: string | null; status: SpendStatus;
  gn_used: string | null; output_path: string | null; task_id: string | null; score: number | null;
  public_ip: string | null; mode: string | null; error: string | null; ts: string; updated_ts: string | null;
}
export type NewSpend = Pick<SpendRow, 'network' | 'wallet_idx' | 'intent_id' | 'miner' | 'independence' | 'escrow' | 'status' | 'ts'> & Partial<Omit<SpendRow, 'id'>>;

export interface TickRow { id: number; started: string; ended: string | null; mode: string | null; summary: unknown; errors: string[]; }
export interface AlertRow { id: number; kind: string; message: string; dedupe_key: string | null; acknowledged: boolean; ts: string; }
export interface SnapshotRow { id: number; url: string; hash: string; text: string; ts: string; }
export interface ActivityRow {
  type: 'claim' | 'spend'; id: number; ts: string; wallet_idx: number; amount: string | null; miner: string | null;
  status: string; ref: string | null; public_ip: string | null; reason: string | null;
}

const iso = (d: Date) => d.toISOString();
const nowIso = () => new Date().toISOString();

function patchSql(table: string, patch: Record<string, unknown>, allowed: Set<string>) {
  const keys = Object.keys(patch).filter((k) => allowed.has(k));
  if (keys.length === 0) return null;
  return { sql: `UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_ts = @__now WHERE id = @__id`, keys };
}

const CLAIM_COLS = new Set(['signature', 'status', 'reason', 'action', 'retry_after', 'tx_hash', 'transfer_status', 'finalized_block', 'amount', 'balance_before', 'public_ip', 'mode', 'error']);
const SPEND_COLS = new Set(['miner_url', 'escrow', 'fee', 'channel_id', 'status', 'gn_used', 'output_path', 'task_id', 'score', 'public_ip', 'mode', 'error']);

function toWallet(r: Record<string, unknown>): WalletRow {
  return { network: r.network as Network, idx: r.idx as number, address: r.address as string, claimer: !!r.claimer, enrolled: !!r.enrolled, stopped: !!r.stopped };
}

export function openLedger(path: string) {
  const isNew = !existsSync(path);
  const db = openDb(path);
  if (isNew) chmodSync(path, 0o600);

  const insertClaimStmt = db.prepare(`INSERT INTO claims (network, wallet_idx, address, nonce, signature, status, reason, action, retry_after, tx_hash, transfer_status, finalized_block, amount, balance_before, public_ip, mode, error, ts)
    VALUES (@network, @wallet_idx, @address, @nonce, @signature, @status, @reason, @action, @retry_after, @tx_hash, @transfer_status, @finalized_block, @amount, @balance_before, @public_ip, @mode, @error, @ts)`);
  const insertSpendStmt = db.prepare(`INSERT INTO spends (network, wallet_idx, intent_id, miner, miner_url, independence, escrow, fee, channel_id, status, gn_used, output_path, task_id, score, public_ip, mode, error, ts)
    VALUES (@network, @wallet_idx, @intent_id, @miner, @miner_url, @independence, @escrow, @fee, @channel_id, @status, @gn_used, @output_path, @task_id, @score, @public_ip, @mode, @error, @ts)`);

  const claimDefaults = { signature: null, reason: null, action: null, retry_after: null, tx_hash: null, transfer_status: null, finalized_block: null, amount: null, balance_before: null, public_ip: null, mode: null, error: null };
  const spendDefaults = { miner_url: null, fee: null, channel_id: null, gn_used: null, output_path: null, task_id: null, score: null, public_ip: null, mode: null, error: null };

  const ledger = {
    close: () => db.close(),
    schemaVersion: () => db.pragma('user_version', { simple: true }) as number,

    upsertWallet(w: { network: Network; index: number; address: string; claimer: boolean }) {
      db.prepare(`INSERT INTO wallets (network, idx, address, claimer) VALUES (?, ?, ?, ?)
        ON CONFLICT (network, idx) DO UPDATE SET address = excluded.address, claimer = excluded.claimer`).run(w.network, w.index, w.address, w.claimer ? 1 : 0);
    },
    listWallets(n: Network): WalletRow[] {
      return (db.prepare('SELECT * FROM wallets WHERE network = ? ORDER BY idx').all(n) as Record<string, unknown>[]).map(toWallet);
    },
    setWalletFlags(n: Network, index: number, p: Partial<{ enrolled: boolean; stopped: boolean; claimer: boolean }>) {
      for (const [k, v] of Object.entries(p)) {
        if (!['enrolled', 'stopped', 'claimer'].includes(k)) continue;
        db.prepare(`UPDATE wallets SET ${k} = ? WHERE network = ? AND idx = ?`).run(v ? 1 : 0, n, index);
      }
    },

    insertClaim(r: NewClaim): number {
      return Number(insertClaimStmt.run({ ...claimDefaults, ...r }).lastInsertRowid);
    },
    updateClaim(id: number, p: Partial<ClaimRow>) {
      const q = patchSql('claims', p as Record<string, unknown>, CLAIM_COLS);
      if (q) db.prepare(q.sql).run({ ...Object.fromEntries(q.keys.map((k) => [k, (p as Record<string, unknown>)[k]])), __now: nowIso(), __id: id });
    },
    claimsSince(n: Network, since: Date): ClaimRow[] {
      return db.prepare('SELECT * FROM claims WHERE network = ? AND ts >= ? ORDER BY ts').all(n, iso(since)) as ClaimRow[];
    },
    lastClaim(n: Network, index: number): ClaimRow | null {
      return (db.prepare('SELECT * FROM claims WHERE network = ? AND wallet_idx = ? ORDER BY ts DESC, id DESC LIMIT 1').get(n, index) as ClaimRow | undefined) ?? null;
    },
    claimsByStatus(n: Network, s: string[]): ClaimRow[] {
      return db.prepare(`SELECT * FROM claims WHERE network = ? AND status IN (${s.map(() => '?').join(',')}) ORDER BY ts`).all(n, ...s) as ClaimRow[];
    },
    claimsForWallet(n: Network, index: number): ClaimRow[] {
      return db.prepare('SELECT * FROM claims WHERE network = ? AND wallet_idx = ? ORDER BY ts').all(n, index) as ClaimRow[];
    },

    insertSpend(r: NewSpend): number {
      return Number(insertSpendStmt.run({ ...spendDefaults, ...r }).lastInsertRowid);
    },
    updateSpend(id: number, p: Partial<SpendRow>) {
      const q = patchSql('spends', p as Record<string, unknown>, SPEND_COLS);
      if (q) db.prepare(q.sql).run({ ...Object.fromEntries(q.keys.map((k) => [k, (p as Record<string, unknown>)[k]])), __now: nowIso(), __id: id });
    },
    spendsByStatus(n: Network, s: string[]): SpendRow[] {
      return db.prepare(`SELECT * FROM spends WHERE network = ? AND status IN (${s.map(() => '?').join(',')}) ORDER BY ts`).all(n, ...s) as SpendRow[];
    },
    spendsSince(n: Network, since: Date, index?: number): SpendRow[] {
      return index === undefined
        ? db.prepare('SELECT * FROM spends WHERE network = ? AND ts >= ? ORDER BY ts').all(n, iso(since)) as SpendRow[]
        : db.prepare('SELECT * FROM spends WHERE network = ? AND ts >= ? AND wallet_idx = ? ORDER BY ts').all(n, iso(since), index) as SpendRow[];
    },

    startTick(mode: string, ts = nowIso()): number {
      return Number(db.prepare('INSERT INTO ticks (started, mode) VALUES (?, ?)').run(ts, mode).lastInsertRowid);
    },
    finishTick(id: number, summary: object, errors: string[], ts = nowIso()) {
      db.prepare('UPDATE ticks SET ended = ?, summary = ?, errors = ? WHERE id = ?').run(ts, JSON.stringify(summary), JSON.stringify(errors), id);
    },
    setTickMode(id: number, mode: string) {
      db.prepare('UPDATE ticks SET mode = ? WHERE id = ?').run(mode, id);
    },
    lastTick(): TickRow | null {
      const r = db.prepare('SELECT * FROM ticks ORDER BY id DESC LIMIT 1').get() as Record<string, unknown> | undefined;
      if (!r) return null;
      return { id: r.id as number, started: r.started as string, ended: (r.ended as string) ?? null, mode: (r.mode as string) ?? null, summary: r.summary ? JSON.parse(r.summary as string) : null, errors: r.errors ? JSON.parse(r.errors as string) : [] };
    },

    addAlert(kind: string, message: string, dedupeKey?: string, ts = nowIso()): { created: boolean; id: number } {
      if (dedupeKey) {
        const open = db.prepare('SELECT id FROM alerts WHERE dedupe_key = ? AND acknowledged = 0 LIMIT 1').get(dedupeKey) as { id: number } | undefined;
        if (open) return { created: false, id: open.id };
      }
      const id = Number(db.prepare('INSERT INTO alerts (kind, message, dedupe_key, ts) VALUES (?, ?, ?, ?)').run(kind, message, dedupeKey ?? null, ts).lastInsertRowid);
      return { created: true, id };
    },
    listAlerts(onlyOpen = false): AlertRow[] {
      const rows = db.prepare(`SELECT * FROM alerts ${onlyOpen ? 'WHERE acknowledged = 0' : ''} ORDER BY id DESC`).all() as Record<string, unknown>[];
      return rows.map((r) => ({ ...(r as unknown as AlertRow), acknowledged: !!r.acknowledged }));
    },
    ackAlert(id: number) {
      db.prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?').run(id);
    },

    getState<T>(key: string): T | null {
      const r = db.prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined;
      return r ? (JSON.parse(r.value) as T) : null;
    },
    setState(key: string, value: unknown) {
      if (value === null || value === undefined) { db.prepare('DELETE FROM state WHERE key = ?').run(key); return; }
      db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
    },

    lastSnapshot(url: string): SnapshotRow | null {
      return (db.prepare('SELECT * FROM watch_snapshots WHERE url = ? ORDER BY id DESC LIMIT 1').get(url) as SnapshotRow | undefined) ?? null;
    },
    insertSnapshot(url: string, hash: string, text: string, ts = nowIso()) {
      db.prepare('INSERT INTO watch_snapshots (url, hash, text, ts) VALUES (?, ?, ?, ?)').run(url, hash, text, ts);
    },

    activity(n: Network, f: { type?: 'claim' | 'spend'; index?: number; outcome?: string; limit: number }): ActivityRow[] {
      const parts: string[] = [];
      const params: unknown[] = [];
      const where = (alias: string) => {
        const w = [`${alias}.network = ?`];
        params.push(n);
        if (f.index !== undefined) { w.push(`${alias}.wallet_idx = ?`); params.push(f.index); }
        if (f.outcome) { w.push(`${alias}.status = ?`); params.push(f.outcome); }
        return w.join(' AND ');
      };
      if (f.type !== 'spend') parts.push(`SELECT 'claim' AS type, c.id, c.ts, c.wallet_idx, c.amount, NULL AS miner, c.status, c.tx_hash AS ref, c.public_ip, c.reason FROM claims c WHERE ${where('c')}`);
      if (f.type !== 'claim') parts.push(`SELECT 'spend' AS type, s.id, s.ts, s.wallet_idx, s.escrow AS amount, s.miner, s.status, s.channel_id AS ref, s.public_ip, s.error AS reason FROM spends s WHERE ${where('s')}`);
      params.push(f.limit);
      return db.prepare(`${parts.join(' UNION ALL ')} ORDER BY ts DESC LIMIT ?`).all(...params) as ActivityRow[];
    },
  };
  return ledger;
}

export type Ledger = ReturnType<typeof openLedger>;
