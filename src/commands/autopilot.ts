import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { loadConfig, updateConfig } from '../core/config.js';
import type { ActionResult } from '../core/ctx.js';
import { installAgent, isLoaded, launchdLabel, uninstallAgent } from '../autopilot/launchd.js';
import { openRuntime, type RuntimeDeps } from '../runtime.js';
import type { Ctx } from '../core/ctx.js';
import { NETWORKS } from '../core/types.js';
import { paths } from '../core/paths.js';
import { openLedger } from '../ledger/ledger.js';
import { acquireLock, releaseLock } from '../autopilot/lock.js';
import { runTick, type TickSummary } from '../autopilot/tick.js';
import { unlockSeed } from '../keys/vault.js';

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');

export const PASSPHRASE_NO_BACKGROUND = "Passphrase mode can't unlock your wallets in the background. Keep a Terminal window open and run: npm run autopilot:run (on a server, run it inside tmux or screen so it keeps going after you log out).";

export async function autopilotOn(home: string): Promise<string> {
  if (loadConfig(home).unlock === 'passphrase') throw new Error(PASSPHRASE_NO_BACKGROUND);
  updateConfig(home, { killed: false, paused: false });
  const c = loadConfig(home);
  return installAgent({ home, nodePath: process.execPath, cliPath: CLI_PATH, intervalSec: c.tickMinutes * 60 });
}

/** Clears pause, kill switch and faucet stops (after the owner has read the alerts). */
export function resumeAll(home: string): void {
  const c = updateConfig(home, { paused: false, killed: false });
  const l = openLedger(paths(home).ledger);
  try {
    for (const n of NETWORKS) {
      l.setState(`claimsStopped:${n}`, null);
      for (const w of l.listWallets(n)) { l.setWalletFlags(n, w.idx, { stopped: false }); l.setState(`refusals:${n}:${w.idx}`, null); }
    }
  } finally {
    l.close();
  }
  void c;
}

/** Why a real (non-practice) manual action must not run now, or null. With checkLock, also refuses while a tick runs. */
export function actionGate(ctx: Ctx, o: { checkLock?: boolean } = {}): string | null {
  if (ctx.config.killed) return 'The autopilot is stopped by the kill switch. Run: npm run autopilot:on';
  if (ctx.config.paused) return 'Paused. Resume first (npm run resume, or Resume on the Controls page).';
  if (ctx.ledger.getState<number>(`runtimeBlocked:${ctx.network}`) !== null) return 'FLOP upgraded the chain. Run: npm run update';
  if (o.checkLock) {
    if (!acquireLock(paths(ctx.home).lock)) return 'The autopilot is running right now. Try again in a minute.';
    releaseLock(paths(ctx.home).lock);
  }
  return null;
}

/** Runs a real manual action under the tick lock so it never races the autopilot. */
export async function withActionLock<T>(ctx: Ctx, f: () => Promise<T>): Promise<T> {
  if (!acquireLock(paths(ctx.home).lock)) throw new Error('The autopilot is running right now. Try again in a minute.');
  try { return await f(); } finally { releaseLock(paths(ctx.home).lock); }
}

/** Foreground autopilot: unlock once (passphrase or store), then tick every interval until stopped. */
export async function runLoop(deps: RuntimeDeps, o: { intervalMs: number; maxTicks?: number; onTick?: (s: TickSummary) => void; signal?: AbortSignal }): Promise<void> {
  await unlockSeed(deps.home, deps.store); // fails fast on a wrong passphrase
  for (let n = 1; !o.signal?.aborted; n++) {
    const s = await runTick(deps);
    o.onTick?.(s);
    if (o.maxTicks && n >= o.maxTicks) break;
    await new Promise<void>((res) => { const t = setTimeout(res, o.intervalMs); o.signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });
  }
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
  const rt = await openRuntime(o.deps, { skipGate: true });
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
