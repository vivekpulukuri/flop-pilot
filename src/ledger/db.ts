import Database from 'better-sqlite3';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE wallets (
    network TEXT NOT NULL, idx INTEGER NOT NULL, address TEXT NOT NULL,
    claimer INTEGER NOT NULL DEFAULT 1, enrolled INTEGER NOT NULL DEFAULT 0, stopped INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (network, idx)
  );
  CREATE TABLE claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL, wallet_idx INTEGER NOT NULL, address TEXT NOT NULL,
    nonce TEXT NOT NULL, signature TEXT, status TEXT NOT NULL,
    reason TEXT, action TEXT, retry_after INTEGER, tx_hash TEXT, transfer_status TEXT,
    finalized_block INTEGER, amount TEXT, balance_before TEXT, public_ip TEXT, mode TEXT,
    error TEXT, ts TEXT NOT NULL, updated_ts TEXT
  );
  CREATE INDEX claims_net_ts ON claims (network, ts);
  CREATE TABLE spends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL, wallet_idx INTEGER NOT NULL, intent_id TEXT NOT NULL,
    miner TEXT NOT NULL, miner_url TEXT, independence TEXT NOT NULL,
    escrow TEXT NOT NULL, fee TEXT, channel_id TEXT, status TEXT NOT NULL, gn_used TEXT,
    output_path TEXT, task_id TEXT, score REAL, public_ip TEXT, mode TEXT, error TEXT,
    ts TEXT NOT NULL, updated_ts TEXT
  );
  CREATE INDEX spends_net_ts ON spends (network, ts);
  CREATE TABLE ticks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, started TEXT NOT NULL, ended TEXT,
    mode TEXT, summary TEXT, errors TEXT
  );
  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, message TEXT NOT NULL,
    dedupe_key TEXT, acknowledged INTEGER NOT NULL DEFAULT 0, ts TEXT NOT NULL
  );
  CREATE TABLE watch_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, hash TEXT NOT NULL, text TEXT NOT NULL, ts TEXT NOT NULL
  );
  CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}
