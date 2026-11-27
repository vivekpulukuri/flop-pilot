import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { loadConfig, updateConfig } from '../core/config.js';
import type { ActionResult } from '../core/ctx.js';
import { installAgent, isLoaded, launchdLabel, uninstallAgent } from '../autopilot/launchd.js';
import { openRuntime, type RuntimeDeps } from '../runtime.js';

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');

export async function autopilotOn(home: string): Promise<string> {
  updateConfig(home, { killed: false });
  const c = loadConfig(home);
  return installAgent({ home, nodePath: process.execPath, cliPath: CLI_PATH, intervalSec: c.tickMinutes * 60 });
}

export async function autopilotOff(home: string): Promise<void> {
  await uninstallAgent(home);
}

export async function autopilotStatus(home: string): Promise<{ loaded: boolean; label: string; paused: boolean; killed: boolean; practice: boolean }> {
  const c = loadConfig(home);
  const label = launchdLabel(home);
  return { loaded: await isLoaded(label), label, paused: c.paused, killed: c.killed, practice: c.practice };
}

/** Kill switch: stops the autopilot at once; optionally deactivates agent wallets on chain after confirmation. */
export async function stopAll(home: string, o: { deactivate?: boolean; confirm?: () => Promise<string>; deps?: RuntimeDeps } = {}): Promise<ActionResult[]> {
  updateConfig(home, { killed: true, paused: true });
  await autopilotOff(home).catch(() => {});
  if (!o.deactivate) return [];
  const answer = o.confirm ? (await o.confirm()).trim() : '';
  if (answer !== 'DEACTIVATE') return [{ kind: 'skipped', detail: 'Deactivation cancelled (you did not type DEACTIVATE). The autopilot is stopped.' }];
  if (!o.deps) throw new Error('deactivation needs runtime dependencies');
  const rt = await openRuntime(o.deps);
  try {
    const out: ActionResult[] = [];
    for (const w of rt.wallets) {
      if (!rt.ctx.ledger.listWallets(rt.ctx.network).find((r) => r.idx === w.index)?.enrolled) continue;
      const tx = await rt.chain.deactivateWallet(w.pair);
      out.push({ wallet: w.index, kind: 'done', detail: `deactivated agent wallet #${w.index} (tx ${tx})` });
    }
    return out;
  } finally {
    await rt.close();
  }
}
