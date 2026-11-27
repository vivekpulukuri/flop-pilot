import type { Config, Env, Network } from './types.js';
import type { Ledger, Mode } from '../ledger/ledger.js';

export interface Ctx {
  home: string;
  config: Config;
  ledger: Ledger;
  env: Env;
  network: Network;
  mode?: Mode;
}

export type ActionKind = 'done' | 'simulated' | 'skipped' | 'failed';
export interface ActionResult { kind: ActionKind; detail: string; reason?: string; wallet?: number; action?: 'claim' | 'enroll' | 'spend'; }

/** Raises an alert; sends a macOS notification only when the alert is new (deduped by key). */
export async function alert(ctx: Ctx, kind: string, message: string, dedupeKey?: string): Promise<void> {
  const r = ctx.ledger.addAlert(kind, message, dedupeKey, ctx.env.now().toISOString());
  if (r.created) await ctx.env.notify('FLOP Pilot', message);
}
