import type { Network } from '../core/types.js';
import { paths } from '../core/paths.js';
import { fromPlanck } from '../core/units.js';
import { openLedger } from '../ledger/ledger.js';

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Claims and purchases for sharing. IP redacted unless asked; signatures, nonces and intents never included. */
export function runExport(home: string, o: { format: 'csv' | 'json'; withIp: boolean; network: Network }): string {
  const l = openLedger(paths(home).ledger);
  try {
    const ip = (v: string | null) => (o.withIp ? v : 'redacted');
    const rows = [
      ...l.claimsSince(o.network, new Date(0)).map((c) => ({
        type: 'claim', time: c.ts, wallet: c.wallet_idx, amount_flop: c.amount ? fromPlanck(BigInt(c.amount), 6) : '', status: c.status,
        miner: '', tx_or_channel: c.tx_hash ?? '', reason: c.reason ?? '', origin_ip: ip(c.public_ip),
      })),
      ...l.spendsSince(o.network, new Date(0)).map((s) => ({
        type: 'purchase', time: s.ts, wallet: s.wallet_idx, amount_flop: fromPlanck(BigInt(s.escrow), 6), status: s.status,
        miner: s.miner, tx_or_channel: s.channel_id ?? '', reason: s.error ?? '', origin_ip: ip(s.public_ip),
      })),
    ].sort((a, b) => a.time.localeCompare(b.time));
    if (o.format === 'json') return JSON.stringify({ network: o.network, rows }, null, 2);
    const cols = ['type', 'time', 'wallet', 'amount_flop', 'status', 'miner', 'tx_or_channel', 'reason', 'origin_ip'] as const;
    return [cols.join(','), ...rows.map((r) => cols.map((k) => csvCell(r[k])).join(','))].join('\n') + '\n';
  } finally {
    l.close();
  }
}
