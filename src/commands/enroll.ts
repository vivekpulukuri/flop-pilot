import type { ActionResult } from '../core/ctx.js';
import { openRuntime, type RuntimeDeps } from '../runtime.js';
import { enrollWallet } from '../enroll/enroll.js';

export async function runEnroll(d: RuntimeDeps, o: { dryRun?: boolean }): Promise<ActionResult[]> {
  const rt = await openRuntime(d, { practice: o.dryRun });
  try {
    const out: ActionResult[] = [];
    for (const w of rt.wallets) out.push(await enrollWallet(rt.ctx, w, rt.chain));
    return out;
  } finally {
    await rt.close();
  }
}
