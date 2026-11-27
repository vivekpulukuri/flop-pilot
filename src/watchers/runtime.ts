import type { ChainPort } from '../core/types.js';
import { alert, type Ctx } from '../core/ctx.js';
import { isSupportedSpec } from '../chain/sdk-chain.js';

export const UNSUPPORTED_MSG = 'FLOP upgraded the chain. Run: flop-pilot update';

/**
 * Compares the chain's runtime version with the last one seen. An unsupported version blocks the autopilot
 * via state `runtimeBlocked:<network>` (cleared automatically once supported again, e.g. after an update).
 */
export async function checkRuntime(ctx: Ctx, chain: ChainPort, supported: (v: number) => boolean = isSupportedSpec): Promise<'ok' | 'upgraded' | 'unsupported'> {
  const spec = await chain.specVersion();
  const lastKey = `lastSpec:${ctx.network}`;
  const blockKey = `runtimeBlocked:${ctx.network}`;
  const last = ctx.ledger.getState<number>(lastKey);
  ctx.ledger.setState(lastKey, spec);
  if (!supported(spec)) {
    ctx.ledger.setState(blockKey, spec);
    await alert(ctx, 'runtime_unsupported', UNSUPPORTED_MSG, `unsupported:${ctx.network}:${spec}`);
    return 'unsupported';
  }
  const wasBlocked = ctx.ledger.getState<number>(blockKey) !== null;
  ctx.ledger.setState(blockKey, null);
  if ((last !== null && last !== spec) || wasBlocked) {
    await alert(ctx, 'runtime_upgraded', `FLOP upgraded the ${ctx.network} chain to version ${spec}. flop-pilot supports it; nothing to do.`, `upgraded:${ctx.network}:${spec}`);
    return 'upgraded';
  }
  return 'ok';
}
