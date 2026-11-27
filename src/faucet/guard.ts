import type { FaucetLimits } from '../core/types.js';

/** Max accepted-or-pending claims per rolling 24 h per network, whatever the IP (one participant). */
export const HARD_CLAIM_CAP = 3;

export interface ClaimGuardInput {
  now: Date;
  wallet: { claimer: boolean; stopped: boolean };
  claims24h: number;
  lastAcceptedAt: Date | null;
  lastGrantSpent: boolean;
  hasUnresolved: boolean;
  backoffUntil: Date | null;
  sharedIpPauseUntil: Date | null;
  claimsStopped: boolean;
  limits: FaucetLimits;
}

export type SkipReason =
  | 'not_claimer' | 'wallet_stopped' | 'claims_stopped' | 'unresolved_pending' | 'shared_ip_pause'
  | 'backoff' | 'global_cap' | 'cooldown' | 'rollover_unspent' | 'faucet_closed' | 'pool_empty';

export type ClaimDecision = { ok: true } | { ok: false; reason: SkipReason; until?: Date };

/** Checks run in a fixed order; the first failure wins. */
export function decideClaim(i: ClaimGuardInput): ClaimDecision {
  const t = i.now.getTime();
  if (!i.wallet.claimer) return { ok: false, reason: 'not_claimer' };
  if (i.wallet.stopped) return { ok: false, reason: 'wallet_stopped' };
  if (i.claimsStopped) return { ok: false, reason: 'claims_stopped' };
  if (i.hasUnresolved) return { ok: false, reason: 'unresolved_pending' };
  if (i.sharedIpPauseUntil && i.sharedIpPauseUntil.getTime() > t) return { ok: false, reason: 'shared_ip_pause', until: i.sharedIpPauseUntil };
  if (i.backoffUntil && i.backoffUntil.getTime() > t) return { ok: false, reason: 'backoff', until: i.backoffUntil };
  if (i.claims24h >= HARD_CLAIM_CAP) return { ok: false, reason: 'global_cap' };
  if (i.lastAcceptedAt) {
    const until = i.lastAcceptedAt.getTime() + i.limits.cooldownSeconds * 1000;
    if (until > t) return { ok: false, reason: 'cooldown', until: new Date(until) };
    if (i.limits.rolloverRequiresSpend && !i.lastGrantSpent) return { ok: false, reason: 'rollover_unspent' };
  }
  if (i.limits.status !== 'open') return { ok: false, reason: 'faucet_closed' };
  if (i.limits.remainingFlop < i.limits.grantFlop) return { ok: false, reason: 'pool_empty' };
  return { ok: true };
}

const HOUR = 3600_000;
/** Backoff after `unavailable`: 1 h, 2 h, 4 h, then 6 h. */
export function nextBackoff(attempt: number): number {
  return [1, 2, 4][attempt - 1] !== undefined ? [1, 2, 4][attempt - 1] * HOUR : 6 * HOUR;
}

export function detectPoolReset(prev: FaucetLimits, curr: FaucetLimits): Date | null {
  // The cap may be a rolling window; only a large drop means the pool actually refilled.
  return curr.usedFlop < prev.usedFlop * 0.5 ? new Date(curr.asOf) : null;
}
