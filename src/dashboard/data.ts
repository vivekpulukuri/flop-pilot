import type { ChainPort, Env, FaucetLimits } from '../core/types.js';
import type { Ctx } from '../core/ctx.js';
import { loadConfig } from '../core/config.js';
import { fromPlanck } from '../core/units.js';
import type { Ledger, WalletRow } from '../ledger/ledger.js';
import { claimGuard, lastFundedClaim, SKIP_TEXT } from '../faucet/claim.js';

export interface WalletView {
  row: WalletRow; balance: string | null; nextClaim: { ready: boolean; text: string; at: Date | null };
  lastClaim: string | null; lastSpend: string | null; claimed: bigint; spent: bigint;
}

const DAY = 86400_000;

export function relTime(to: Date, now: Date): string {
  const ms = to.getTime() - now.getTime();
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `in ${h} h ${m % 60} m` : `in ${m} m`;
}

export function hhmmUtc(iso: string): string {
  return `${iso.slice(11, 16)} UTC`;
}

export async function gather(home: string, env: Env, ledger: Ledger, chain: ChainPort | null) {
  const config = loadConfig(home);
  const n = config.network;
  const ctx: Ctx = { home, config, ledger, env, network: n };
  const now = env.now();
  const limits = ledger.getState<FaucetLimits>(`lastLimits:${n}`);
  const wallets: WalletView[] = [];
  for (const row of ledger.listWallets(n)) {
    let balance: string | null = null;
    if (chain) { try { balance = fromPlanck(await chain.finalizedFreeBalance(row.address)); } catch { balance = null; } }
    let nextClaim: WalletView['nextClaim'] = { ready: false, text: 'faucet limits not checked yet (run a tick)', at: null };
    if (limits) {
      const d = claimGuard(ctx, row.idx, limits);
      nextClaim = d.ok ? { ready: true, text: 'ready to claim', at: null }
        : { ready: false, text: d.until ? `${SKIP_TEXT[d.reason]} (${relTime(d.until, now)})` : SKIP_TEXT[d.reason], at: d.until ?? null };
    }
    const claims = ledger.claimsForWallet(n, row.idx);
    const spends = ledger.spendsSince(n, new Date(0), row.idx);
    wallets.push({
      row, balance, nextClaim,
      lastClaim: lastFundedClaim(ctx, row.idx)?.ts ?? null,
      lastSpend: spends.length ? spends[spends.length - 1].ts : null,
      claimed: claims.filter((c) => c.status === 'finalized' || c.status === 'accepted').reduce((a, c) => a + BigInt(c.amount ?? '0'), 0n),
      spent: spends.filter((s) => s.status !== 'failed').reduce((a, s) => a + BigInt(s.escrow), 0n),
    });
  }
  const since = new Date(now.getTime() - DAY);
  const claimed24 = ledger.claimsSince(n, since).filter((c) => c.status === 'finalized' || c.status === 'accepted').reduce((a, c) => a + BigInt(c.amount ?? '0'), 0n);
  const spent24 = ledger.spendsSince(n, since).filter((s) => s.status !== 'failed').reduce((a, s) => a + BigInt(s.escrow), 0n);
  return {
    config, network: n, now, limits, wallets, claimed24, spent24,
    poolResetAt: ledger.getState<string>(`poolResetAt:${n}`),
    mode: (ledger.getState<string>(`lastMode:${n}`) ?? 'standby') as 'standby' | 'earning',
    runtimeBlocked: ledger.getState<number>(`runtimeBlocked:${n}`),
    alerts: ledger.listAlerts(true),
    lastTick: ledger.lastTick(),
  };
}

/** Per-day claimed/spent FLOP for one wallet, oldest first, ending today (UTC). */
export function series(ledger: Ledger, n: WalletRow['network'], idx: number, now: Date, days = 30) {
  const keys = Array.from({ length: days }, (_, i) => new Date(now.getTime() - (days - 1 - i) * DAY).toISOString().slice(0, 10));
  const claimed = new Map(keys.map((k) => [k, 0n]));
  const spent = new Map(keys.map((k) => [k, 0n]));
  for (const c of ledger.claimsForWallet(n, idx)) if ((c.status === 'finalized' || c.status === 'accepted') && claimed.has(c.ts.slice(0, 10))) claimed.set(c.ts.slice(0, 10), claimed.get(c.ts.slice(0, 10))! + BigInt(c.amount ?? '0'));
  for (const s of ledger.spendsSince(n, new Date(0), idx)) if (s.status !== 'failed' && spent.has(s.ts.slice(0, 10))) spent.set(s.ts.slice(0, 10), spent.get(s.ts.slice(0, 10))! + BigInt(s.escrow));
  const toNum = (p: bigint) => Number(fromPlanck(p, 6));
  return { days: keys, claimed: keys.map((k) => toNum(claimed.get(k)!)), spent: keys.map((k) => toNum(spent.get(k)!)) };
}
