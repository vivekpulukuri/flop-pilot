import { existsSync } from 'node:fs';
import type { ChainPort, Env, FaucetPort, Network, SecretStore } from './core/types.js';
import type { Ctx } from './core/ctx.js';
import { loadConfig } from './core/config.js';
import { ensureDirs, paths } from './core/paths.js';
import { openLedger } from './ledger/ledger.js';
import { unlockSeed } from './keys/vault.js';
import { deriveWallets, type Wallet } from './keys/derive.js';
import { WALLET_COUNT } from './commands/init.js';
import { acquireLock, releaseLock } from './autopilot/lock.js';

export interface RuntimeDeps {
  home: string;
  env: Env;
  store: SecretStore;
  makeChain: (n: Network) => Promise<ChainPort>;
  makeFaucet: (n: Network, env: Env) => FaucetPort;
}

export function openCtx(home: string, env: Env, o: { practice?: boolean } = {}): Ctx {
  if (!existsSync(paths(home).vault)) throw new Error('flop-pilot is not set up yet. Run: flop-pilot init');
  ensureDirs(home);
  const config = loadConfig(home);
  if (o.practice) config.practice = true;
  return { home, config, ledger: openLedger(paths(home).ledger), env, network: config.network };
}

export async function loadWallets(ctx: Ctx, store: SecretStore): Promise<Wallet[]> {
  const seed = await unlockSeed(ctx.home, store);
  const ws = await deriveWallets(seed, ctx.network, WALLET_COUNT);
  for (const w of ws) {
    if (!ctx.ledger.listWallets(ctx.network).some((r) => r.idx === w.index)) {
      ctx.ledger.upsertWallet({ network: ctx.network, index: w.index, address: w.address, claimer: w.index < ctx.config.claimers });
    }
  }
  return ws;
}

/** Connects everything a command needs; always call close(). Real (non-practice) runs pass the action gate. */
export async function openRuntime(d: RuntimeDeps, o: { practice?: boolean; skipGate?: boolean } = {}) {
  const ctx = openCtx(d.home, d.env, o);
  let locked = false;
  if (!ctx.config.practice && !o.skipGate) {
    const { actionGate } = await import('./commands/autopilot.js');
    const blocked = actionGate(ctx);
    if (blocked) { ctx.ledger.close(); throw new Error(blocked); }
    // Hold the tick lock for the whole command so it never races the autopilot.
    if (!acquireLock(paths(d.home).lock)) { ctx.ledger.close(); throw new Error('The autopilot is running right now. Try again in a minute.'); }
    locked = true;
  }
  const unlock = () => { if (locked) releaseLock(paths(d.home).lock); };
  let chain: ChainPort | null = null;
  try {
    const wallets = await loadWallets(ctx, d.store);
    chain = await d.makeChain(ctx.network);
    const faucet = d.makeFaucet(ctx.network, d.env);
    const c = chain;
    return {
      ctx, wallets, chain: c, faucet,
      async close() { await c.disconnect().catch(() => {}); ctx.ledger.close(); unlock(); },
    };
  } catch (e) {
    if (chain) await chain.disconnect().catch(() => {});
    ctx.ledger.close();
    unlock();
    throw e;
  }
}
