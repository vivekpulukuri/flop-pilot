import type { ActionResult } from '../core/ctx.js';
import { openRuntime, type RuntimeDeps } from '../runtime.js';
import { resumeSpends, spendWallet } from '../spend/purchase.js';
import { createMinerDirectory } from '../spend/miners.js';

export async function runSpend(d: RuntimeDeps, o: { wallet?: number; dryRun?: boolean }): Promise<ActionResult[]> {
  const rt = await openRuntime(d, { practice: o.dryRun });
  try {
    const out: ActionResult[] = [];
    if (!rt.ctx.config.practice) out.push(...(await resumeSpends(rt.ctx, rt.wallets, rt.chain)));
    const miners = createMinerDirectory(rt.chain, rt.ctx.config.minerEndpoints);
    for (const w of rt.wallets) {
      if (o.wallet !== undefined && w.index !== o.wallet) continue;
      out.push(...(await spendWallet(rt.ctx, w, { chain: rt.chain, miners })));
    }
    return out;
  } finally {
    await rt.close();
  }
}
