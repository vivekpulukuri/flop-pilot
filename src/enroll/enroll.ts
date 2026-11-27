import type { ChainPort } from '../core/types.js';
import type { ActionResult, Ctx } from '../core/ctx.js';
import { fromPlanck, toPlanck } from '../core/units.js';
import type { Wallet } from '../keys/derive.js';

/**
 * Makes the wallet an on-chain agent wallet with spending caps (spec §4.2).
 * No DID in v1: not required for claims or sessions (devnet findings Q5).
 */
export async function enrollWallet(ctx: Ctx, w: Wallet, chain: ChainPort): Promise<ActionResult> {
  const base = { wallet: w.index, action: 'enroll' as const };
  const existing = await chain.getAgentWallet(w.address);
  if (existing?.active) {
    ctx.ledger.setWalletFlags(ctx.network, w.index, { enrolled: true });
    return { ...base, kind: 'skipped', reason: 'already_enrolled', detail: `wallet #${w.index} is already enrolled as an agent` };
  }
  const fee = toPlanck(ctx.config.enrollFeeFlop);
  const balance = await chain.finalizedFreeBalance(w.address);
  if (balance < fee) {
    return { ...base, kind: 'skipped', reason: 'needs_funds', detail: `wallet #${w.index} needs at least ${ctx.config.enrollFeeFlop} FLOP to enroll (has ${fromPlanck(balance)}); it enrolls after its first claim` };
  }
  const caps = { perTxLimit: toPlanck(ctx.config.perTxLimitFlop), dailyCap: toPlanck(ctx.config.dailyCapFlop) };
  if (ctx.config.practice) {
    return { ...base, kind: 'simulated', detail: `would enroll wallet #${w.index} as an agent (caps ${ctx.config.perTxLimitFlop} FLOP per tx, ${ctx.config.dailyCapFlop} FLOP per day)` };
  }
  const tx = await chain.createAgentWallet(w.pair, caps);
  ctx.ledger.setWalletFlags(ctx.network, w.index, { enrolled: true });
  return { ...base, kind: 'done', detail: `enrolled wallet #${w.index} as an agent (tx ${tx})` };
}
