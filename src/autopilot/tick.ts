import { existsSync } from 'node:fs';
import type { ChainPort, FaucetLimits } from '../core/types.js';
import { alert, type ActionResult, type Ctx } from '../core/ctx.js';
import { loadConfig } from '../core/config.js';
import { paths } from '../core/paths.js';
import { NETWORK_PROFILES } from '../core/networks.js';
import { openCtx, loadWallets, type RuntimeDeps } from '../runtime.js';
import { VaultLockedError } from '../keys/vault.js';
import type { Wallet } from '../keys/derive.js';
import { acquireLock, releaseLock } from './lock.js';
import { claimWallet, reconcileClaims } from '../faucet/claim.js';
import { detectPoolReset } from '../faucet/guard.js';
import { enrollWallet } from '../enroll/enroll.js';
import { resumeSpends, spendWallet } from '../spend/purchase.js';
import { createMinerDirectory } from '../spend/miners.js';
import { checkRuntime } from '../watchers/runtime.js';
import { currentMode } from '../watchers/mode.js';
import { runWatchers } from '../watchers/pagewatch.js';
import type { Mode } from '../ledger/ledger.js';

export interface TickSummary { mode: Mode | null; actions: ActionResult[]; errors: string[]; skippedAll?: string; publicIp?: string | null; }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One autopilot cycle, in the fixed order of spec §4.5. Never throws. */
export async function runTick(d: RuntimeDeps): Promise<TickSummary> {
  const s: TickSummary = { mode: null, actions: [], errors: [] };
  if (!existsSync(paths(d.home).vault)) return { ...s, skippedAll: 'not_set_up' };
  if (loadConfig(d.home).killed) return { ...s, skippedAll: 'killed' };
  const lock = paths(d.home).lock;
  if (!acquireLock(lock)) return { ...s, skippedAll: 'already_running' };

  let ctx: Ctx | null = null;
  let chain = null as ChainPort | null;
  let tickId = 0;
  try {
    ctx = openCtx(d.home, d.env);
    const c = ctx;
    tickId = c.ledger.startTick('standby', c.env.now().toISOString());
    const step = async (name: string, f: () => Promise<void>) => { try { await f(); } catch (e) { s.errors.push(`${name}: ${msg(e)}`); } };

    let wallets: Wallet[];
    try {
      wallets = await loadWallets(c, d.store);
    } catch (e) {
      if (e instanceof VaultLockedError) {
        await alert(c, 'vault_locked', 'The autopilot could not unlock your wallets: the macOS Keychain is locked or denied access. Log in to your Mac and allow access, then it resumes by itself.', 'vault_locked');
        s.skippedAll = 'vault_locked';
        return s;
      }
      throw e;
    }

    // Faucet: genesis check and limits. Claims are never attempted after a mismatch.
    const faucet = d.makeFaucet(c.network, c.env);
    let limits = null as FaucetLimits | null;
    await step('faucet', async () => {
      const fc = await faucet.chain();
      if (fc.network !== c.network || fc.genesisHash.toLowerCase() !== NETWORK_PROFILES[c.network].genesis) {
        throw new Error(`faucet reports ${fc.network} genesis ${fc.genesisHash}; expected FLOP ${c.network}. Claims skipped.`);
      }
      const l = await faucet.limits();
      const prev = c.ledger.getState<FaucetLimits>(`lastLimits:${c.network}`);
      const reset = prev ? detectPoolReset(prev, l) : null;
      if (reset) c.ledger.setState(`poolResetAt:${c.network}`, reset.toISOString());
      c.ledger.setState(`lastLimits:${c.network}`, l);
      limits = l;
    });

    await step('chain', async () => { chain = await d.makeChain(c.network); });
    if (chain) {
      const ch: ChainPort = chain;
      let runtime = 'ok' as 'ok' | 'upgraded' | 'unsupported';
      await step('runtime', async () => { runtime = await checkRuntime(c, ch); });
      if (runtime === 'unsupported') { s.skippedAll = 'runtime_unsupported'; return s; }
      await step('mode', async () => { s.mode = await currentMode(c, ch); c.mode = s.mode; c.ledger.setTickMode(tickId, s.mode); });
    }
    s.publicIp = await c.env.publicIp();

    const cfg = c.config;
    if (!cfg.paused && chain) {
      const ch: ChainPort = chain;
      const ports = { faucet, chain: ch };
      if (!cfg.practice) {
        await step('reconcile', async () => { s.actions.push(...(await reconcileClaims(c, ports, wallets))); });
        await step('resume', async () => { s.actions.push(...(await resumeSpends(c, wallets, ch))); });
      }
      if (limits) {
        for (const w of wallets) await step(`claim #${w.index}`, async () => { s.actions.push(await claimWallet(c, w, { ...ports, limits: limits! })); });
        if (!cfg.practice) await step('reconcile', async () => { await reconcileClaims(c, ports, wallets); });
      }
      for (const w of wallets) {
        if (c.ledger.listWallets(c.network).find((r) => r.idx === w.index)?.enrolled) continue;
        await step(`enroll #${w.index}`, async () => { s.actions.push(await enrollWallet(c, w, ch)); });
      }
      const miners = createMinerDirectory(ch, cfg.minerEndpoints);
      for (const w of wallets) await step(`spend #${w.index}`, async () => { s.actions.push(...(await spendWallet(c, w, { chain: ch, miners }))); });
    }

    s.errors.push(...(await runWatchers(c)));
    return s;
  } catch (e) {
    s.errors.push(msg(e));
    return s;
  } finally {
    if (ctx) {
      try { ctx.ledger.finishTick(tickId, { mode: s.mode, actions: s.actions, skippedAll: s.skippedAll ?? null, publicIp: s.publicIp ?? null }, s.errors, ctx.env.now().toISOString()); } catch { /* ledger closed */ }
      ctx.ledger.close();
    }
    if (chain) await (chain as ChainPort).disconnect().catch(() => {});
    releaseLock(lock);
  }
}
