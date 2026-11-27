import { u8aToHex } from '@polkadot/util';
import type { ChainPort, ClaimResult, FaucetLimits, FaucetPort } from '../core/types.js';
import { alert, type ActionResult, type Ctx } from '../core/ctx.js';
import { toPlanck } from '../core/units.js';
import type { ClaimRow } from '../ledger/ledger.js';
import type { Wallet } from '../keys/derive.js';
import { decideClaim, nextBackoff, type SkipReason } from './guard.js';

export const SHARED_IP_ALERT =
  'Another install or device may share your internet connection. Lower the number of claiming wallets, or set up only one install per connection.';
const IP_LIMIT_REASON = /(^|_)ip(_|$)/i;
const DAY = 86400_000;
const HOUR = 3600_000;

const COUNTED = new Set(['pending', 'accepted', 'finalized', 'unknown']);

const keys = (ctx: Ctx, idx?: number) => ({
  backoff: `backoff:${ctx.network}:${idx}`,
  sharedIp: `sharedIpPauseUntil:${ctx.network}`,
  stopped: `claimsStopped:${ctx.network}`,
});

export const SKIP_TEXT: Record<SkipReason, string> = {
  not_claimer: 'not a claiming wallet (see `flop-pilot claimers`)',
  wallet_stopped: 'wallet stopped after a faucet refusal; check alerts',
  claims_stopped: 'all claims stopped after a faucet report; check alerts',
  unresolved_pending: 'waiting to confirm an earlier claim',
  shared_ip_pause: 'paused: your internet connection may be shared with another install',
  backoff: 'faucet asked us to wait',
  global_cap: '3 claims already made in the last 24 hours',
  cooldown: 'this wallet claimed less than 24 hours ago',
  rollover_unspent: 'spend the last grant on inference first (faucet rule)',
  faucet_closed: 'faucet is not open right now',
  pool_empty: "faucet's daily pool is empty; waiting for it to refill",
};

export function lastFundedClaim(ctx: Ctx, idx: number): ClaimRow | null {
  const rows = ctx.ledger.claimsForWallet(ctx.network, idx).filter((c) => c.status === 'accepted' || c.status === 'finalized');
  return rows.length ? rows[rows.length - 1] : null;
}

/** Devnet findings Q3: a finalized paid compute channel after the last grant unlocks the next one. */
export function lastGrantSpent(ctx: Ctx, idx: number): boolean {
  const last = lastFundedClaim(ctx, idx);
  if (!last) return true;
  return ctx.ledger.spendsSince(ctx.network, new Date(last.ts), idx).some((s) => s.status === 'settled');
}

function claimsIn24h(ctx: Ctx): number {
  return ctx.ledger.claimsSince(ctx.network, new Date(ctx.env.now().getTime() - DAY)).filter((c) => COUNTED.has(c.status)).length;
}

function nextNonce(ctx: Ctx, idx: number): string {
  const prev = ctx.ledger.claimsForWallet(ctx.network, idx).reduce((m, c) => (BigInt(c.nonce) > m ? BigInt(c.nonce) : m), 0n);
  const t = BigInt(ctx.env.now().getTime());
  return (t > prev ? t : prev + 1n).toString();
}

export function claimGuard(ctx: Ctx, idx: number, limits: FaucetLimits) {
  const k = keys(ctx, idx);
  const row = ctx.ledger.listWallets(ctx.network).find((w) => w.idx === idx);
  const backoff = ctx.ledger.getState<{ until: string; attempt: number }>(k.backoff);
  const shared = ctx.ledger.getState<string>(k.sharedIp);
  const last = lastFundedClaim(ctx, idx);
  return decideClaim({
    now: ctx.env.now(),
    wallet: { claimer: !!row?.claimer && idx < ctx.config.claimers, stopped: !!row?.stopped },
    claims24h: claimsIn24h(ctx),
    lastAcceptedAt: last ? new Date(last.ts) : null,
    lastGrantSpent: lastGrantSpent(ctx, idx),
    hasUnresolved: ctx.ledger.claimsForWallet(ctx.network, idx).some((c) => c.status === 'unknown' || c.status === 'pending'),
    backoffUntil: backoff ? new Date(backoff.until) : null,
    sharedIpPauseUntil: shared ? new Date(shared) : null,
    claimsStopped: !!ctx.ledger.getState<boolean>(k.stopped),
    limits,
  });
}

async function applyOutcome(ctx: Ctx, id: number, idx: number, r: ClaimResult): Promise<ActionResult> {
  const now = ctx.env.now();
  const k = keys(ctx, idx);
  const base = { wallet: idx, action: 'claim' as const };
  const common = { reason: r.reason ?? null, action: r.action ?? null, retry_after: r.retryAfterSeconds ?? null, error: r.error ?? null };
  const setBackoff = (ms: number, attempt = 1) => ctx.ledger.setState(k.backoff, { until: new Date(now.getTime() + ms).toISOString(), attempt });

  switch (r.outcome) {
    case 'accepted': {
      ctx.ledger.updateClaim(id, {
        ...common, status: r.transferStatus === 'finalized' ? 'finalized' : 'accepted', tx_hash: r.txHash ?? null,
        transfer_status: r.transferStatus ?? null, ...(r.amountFlop ? { amount: toPlanck(r.amountFlop).toString() } : {}),
      });
      ctx.ledger.setState(k.backoff, null);
      return { ...base, kind: 'done', detail: `claimed ${r.amountFlop ?? ''} FLOP for wallet #${idx}${r.txHash ? ` (tx ${r.txHash})` : ''}`.replace('  ', ' ') };
    }
    case 'unknown':
      ctx.ledger.updateClaim(id, { ...common, status: 'unknown' });
      return { ...base, kind: 'failed', reason: 'unknown', detail: `wallet #${idx}: faucet result unclear; the same request is re-checked next run` };
    case 'unavailable': {
      const attempt = (ctx.ledger.getState<{ attempt: number }>(k.backoff)?.attempt ?? 0) + 1;
      ctx.ledger.updateClaim(id, { ...common, status: 'unavailable' });
      setBackoff(nextBackoff(attempt), attempt);
      return { ...base, kind: 'skipped', reason: 'unavailable', detail: `wallet #${idx}: faucet unavailable; waiting ${nextBackoff(attempt) / HOUR}h` };
    }
    case 'refused': {
      ctx.ledger.updateClaim(id, { ...common, status: 'refused' });
      const reason = r.reason ?? '';
      if (reason === 'agent_spend_missing') {
        setBackoff((r.retryAfterSeconds ?? 3600) * 1000);
        return { ...base, kind: 'skipped', reason: 'rollover_unspent', detail: `wallet #${idx}: ${SKIP_TEXT.rollover_unspent}` };
      }
      if (IP_LIMIT_REASON.test(reason)) {
        ctx.ledger.setState(k.sharedIp, new Date(now.getTime() + DAY).toISOString());
        await alert(ctx, 'shared_ip', SHARED_IP_ALERT, `shared_ip:${ctx.network}`);
        return { ...base, kind: 'skipped', reason: 'shared_ip_pause', detail: `wallet #${idx}: ${SKIP_TEXT.shared_ip_pause}` };
      }
      if (r.action === 'fix_request') {
        ctx.ledger.setWalletFlags(ctx.network, idx, { stopped: true });
        await alert(ctx, 'faucet_fix', `Wallet #${idx} stopped claiming: the faucet said "${r.error ?? reason}" (${reason}).`, `faucet_fix:${ctx.network}:${idx}:${reason}`);
        return { ...base, kind: 'failed', reason: 'wallet_stopped', detail: `wallet #${idx}: faucet refused (${reason}); wallet stopped` };
      }
      if (r.action === 'report_to_operator') {
        ctx.ledger.setState(k.stopped, true);
        await alert(ctx, 'faucet_report', `All claims stopped: the faucet said "${r.error ?? reason}" (${reason}). Report this to the FLOP team.`, `faucet_report:${ctx.network}`);
        return { ...base, kind: 'failed', reason: 'claims_stopped', detail: `faucet asked to report (${reason}); all claims stopped` };
      }
      setBackoff((r.retryAfterSeconds ?? 3600) * 1000);
      return { ...base, kind: 'skipped', reason: 'backoff', detail: `wallet #${idx}: faucet refused (${reason || 'no reason'}); retrying later` };
    }
  }
}

export async function claimWallet(ctx: Ctx, w: Wallet, ports: { faucet: FaucetPort; chain: ChainPort; limits?: FaucetLimits }): Promise<ActionResult> {
  const limits = ports.limits ?? (await ports.faucet.limits());
  const d = claimGuard(ctx, w.index, limits);
  if (!d.ok) return { wallet: w.index, action: 'claim', kind: 'skipped', reason: d.reason, detail: `wallet #${w.index}: ${SKIP_TEXT[d.reason]}${d.until ? ` (until ${d.until.toISOString()})` : ''}` };
  if (ctx.config.practice) return { wallet: w.index, action: 'claim', kind: 'simulated', detail: `would claim ${limits.grantFlop} FLOP for wallet #${w.index}` };

  const balanceBefore = await ports.chain.finalizedFreeBalance(w.address);
  const id = ctx.ledger.insertClaim({
    network: ctx.network, wallet_idx: w.index, address: w.address, nonce: nextNonce(ctx, w.index), status: 'pending',
    amount: toPlanck(limits.grantFlop).toString(), balance_before: balanceBefore.toString(),
    public_ip: await ctx.env.publicIp(), mode: ctx.mode ?? 'standby', ts: ctx.env.now().toISOString(),
  });
  const nonce = ctx.ledger.claimsForWallet(ctx.network, w.index).find((c) => c.id === id)!.nonce;
  let result: ClaimResult;
  try {
    result = await ports.faucet.claim(w.address, {
      nonce,
      // Write-ahead: the signature is saved before the request is sent, so a crash can resend it unchanged.
      sign: async (msg) => { const sig = u8aToHex(w.pair.sign(msg)); ctx.ledger.updateClaim(id, { signature: sig }); return sig; },
    });
  } catch (e) {
    result = { outcome: 'unknown', nonce, error: (e as Error).message };
  }
  return applyOutcome(ctx, id, w.index, result);
}

export async function reconcileClaims(ctx: Ctx, ports: { faucet: FaucetPort; chain: ChainPort }, wallets: Wallet[]): Promise<ActionResult[]> {
  const out: ActionResult[] = [];
  const byIdx = new Map(wallets.map((w) => [w.index, w]));
  for (const row of ctx.ledger.claimsByStatus(ctx.network, ['pending', 'unknown'])) {
    if (!byIdx.has(row.wallet_idx)) continue;
    if (!row.signature) {
      // No signature means no request was sent (testnet), or devnet's unsigned route.
      const credited = row.balance_before !== null && row.amount !== null
        && (await ports.chain.finalizedFreeBalance(row.address)) >= BigInt(row.balance_before) + BigInt(row.amount);
      if (credited) ctx.ledger.updateClaim(row.id, { status: 'finalized', finalized_block: await ports.chain.finalizedHead() });
      else if (ctx.network === 'testnet' || ctx.env.now().getTime() - new Date(row.ts).getTime() > HOUR) ctx.ledger.updateClaim(row.id, { status: 'refused', reason: 'not_sent' });
      continue;
    }
    let r: ClaimResult;
    try {
      r = await ports.faucet.claim(row.address, { nonce: row.nonce, sign: async () => row.signature! });
    } catch (e) {
      r = { outcome: 'unknown', nonce: row.nonce, error: (e as Error).message };
    }
    out.push(await applyOutcome(ctx, row.id, row.wallet_idx, r));
  }
  for (const row of ctx.ledger.claimsByStatus(ctx.network, ['accepted'])) {
    if (row.transfer_status === 'finalized' || (row.balance_before !== null && row.amount !== null
      && (await ports.chain.finalizedFreeBalance(row.address)) >= BigInt(row.balance_before) + BigInt(row.amount))) {
      ctx.ledger.updateClaim(row.id, { status: 'finalized', finalized_block: await ports.chain.finalizedHead() });
    }
  }
  return out;
}
