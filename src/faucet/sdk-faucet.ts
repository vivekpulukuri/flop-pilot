import { claimTestnetAgentFunds, requestFaucetFunding } from '@flop-labs/sdk';
import type { ClaimResult, Env, FaucetLimits, FaucetPort, Network, RefusalAction } from '../core/types.js';
import { NETWORK_PROFILES } from '../core/networks.js';

interface SdkResult {
  success?: boolean; outcome?: string; txHash?: string; reason?: string; error?: string; action?: string;
  retryAfterSeconds?: number; transferStatus?: 'included' | 'finalized'; amount?: number;
}
export interface FaucetSdk {
  claimTestnetAgentFunds: (address: string, c: { nonce?: string; sign: (m: Uint8Array) => Promise<string> }) => Promise<SdkResult>;
  requestFaucetFunding: (address: string, c: { network: 'devnet'; client: string }) => Promise<SdkResult>;
}

const realSdk: FaucetSdk = {
  claimTestnetAgentFunds: (a, c) => claimTestnetAgentFunds(a, c) as Promise<SdkResult>,
  requestFaucetFunding: (a, c) => requestFaucetFunding(a, c) as Promise<SdkResult>,
};

const num = (v: unknown) => (v === undefined || v === null ? 0 : Number(v));

/** Parses the faucet's live `/limits` JSON (shape observed 2026-11-27). */
export function parseLimits(j: unknown): FaucetLimits {
  const r = j as { faucet?: Record<string, any>; asOf?: string };
  const f = r.faucet ?? {};
  const agent = f.agent;
  return {
    status: agent ? String(f.status ?? 'closed') : 'closed',
    grantFlop: num(agent?.grantFlop),
    cooldownSeconds: num(agent?.cooldownSeconds) || 86400,
    rolloverRequiresSpend: agent?.rolloverRequiresSpend !== false,
    remainingFlop: num(f.dailyCap?.remainingFlop),
    usedFlop: num(f.dailyCap?.usedFlop),
    limitFlop: num(f.dailyCap?.limitFlop),
    ipGrantsPerDay: num(f.perClient?.ipGrantsPerDay),
    asOf: String(r.asOf ?? ''),
  };
}

function mapResult(r: SdkResult, nonce: string): ClaimResult {
  const outcome = (['accepted', 'refused', 'unavailable', 'unknown'] as const).find((o) => o === r.outcome) ?? (r.success ? 'accepted' : 'unknown');
  const action = (['retry_later', 'fix_request', 'report_to_operator'] as const).find((a) => a === r.action) as RefusalAction | undefined;
  return {
    outcome, nonce, txHash: r.txHash, reason: r.reason, error: r.error, action,
    retryAfterSeconds: r.retryAfterSeconds, transferStatus: r.transferStatus, amountFlop: r.amount,
  };
}

export function createFaucet(n: Network, env: Env, sdk: FaucetSdk = realSdk): FaucetPort {
  const base = NETWORK_PROFILES[n].faucet;
  const getJson = async (path: string) => {
    const res = await env.fetch(`${base}${path}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Faucet ${path} returned HTTP ${res.status}`);
    return res.json();
  };
  return {
    async chain() { return (await getJson('/chain')) as { network: string; genesisHash: string }; },
    async limits() { return parseLimits(await getJson('/limits')); },
    async claim(address, o) {
      if (n === 'testnet') return mapResult(await sdk.claimTestnetAgentFunds(address, { nonce: o.nonce, sign: o.sign }), o.nonce);
      // Devnet has no signed agent-claim route (devnet findings Q8).
      return mapResult(await sdk.requestFaucetFunding(address, { network: 'devnet', client: 'flop-pilot' }), o.nonce);
    },
  };
}
