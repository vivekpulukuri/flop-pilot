import type { ActionResult } from '../core/ctx.js';
import { openRuntime, type RuntimeDeps } from '../runtime.js';
import { claimWallet, reconcileClaims } from '../faucet/claim.js';

export async function runFund(d: RuntimeDeps, o: { wallet?: number; dryRun?: boolean }): Promise<ActionResult[]> {
  const rt = await openRuntime(d, { practice: o.dryRun });
  try {
    const out: ActionResult[] = [];
    if (!rt.ctx.config.practice) out.push(...(await reconcileClaims(rt.ctx, rt, rt.wallets)));
    const limits = await rt.faucet.limits();
    for (const w of rt.wallets) {
      if (o.wallet !== undefined && w.index !== o.wallet) continue;
      out.push(await claimWallet(rt.ctx, w, { faucet: rt.faucet, chain: rt.chain, limits }));
    }
    return out;
  } finally {
    await rt.close();
  }
}

const ICON: Record<ActionResult['kind'], string> = { done: '✓', simulated: '○', skipped: '–', failed: '✗' };
export function formatResults(rs: ActionResult[]): string {
  return rs.length ? rs.map((r) => `${ICON[r.kind]} ${r.kind === 'simulated' ? 'practice: ' : ''}${r.detail}`).join('\n') : 'Nothing to do.';
}
