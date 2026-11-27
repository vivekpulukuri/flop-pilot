import type { ChainPort, Network } from '../core/types.js';
import { alert, type Ctx } from '../core/ctx.js';
import { loadConfig, updateConfig } from '../core/config.js';
import type { Mode } from '../ledger/ledger.js';

/** `earning` once the finalized head reaches the owner-confirmed activation block (spec §4.5/§4.6). */
export async function currentMode(ctx: Ctx, chain: ChainPort): Promise<Mode> {
  const block = ctx.config.activationBlock[ctx.network];
  const mode: Mode = block !== null && (await chain.finalizedHead()) >= block ? 'earning' : 'standby';
  const key = `lastMode:${ctx.network}`;
  if (mode === 'earning' && ctx.ledger.getState<Mode>(key) !== 'earning') {
    await alert(ctx, 'earning_started', `Voucher earning has started on ${ctx.network} (block ${block}). The autopilot keeps claiming and spending as usual.`, `earning:${ctx.network}:${block}`);
  }
  ctx.ledger.setState(key, mode);
  return mode;
}

export function setActivationBlock(home: string, n: Network, block: number | null): void {
  if (block !== null && (!Number.isInteger(block) || block <= 0)) throw new Error('The activation block must be a positive whole number (or "clear").');
  const c = loadConfig(home);
  updateConfig(home, { activationBlock: { ...c.activationBlock, [n]: block } });
}
