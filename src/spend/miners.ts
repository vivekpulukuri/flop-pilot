import type { ChainPort, MinerDirectory, MinerEndpoint, MinerInfo } from '../core/types.js';

/**
 * Chain-registered miners joined with owner-supplied endpoints (no public directory publishes miner URLs,
 * devnet findings Q1). Linked accounts (delegators, sponsors) come from chain; null when unknown.
 */
export function createMinerDirectory(chain: ChainPort, endpoints: MinerEndpoint[]): MinerDirectory {
  return {
    async list(): Promise<MinerInfo[]> {
      let registered: { address: string; models: string[] }[] = [];
      try { registered = await chain.registeredMiners(); } catch { registered = []; }
      const urlOf = new Map(endpoints.map((e) => [e.address, e.url]));
      const seen = new Set<string>();
      const out: MinerInfo[] = [];
      const add = async (address: string, models: string[]) => {
        if (seen.has(address)) return;
        seen.add(address);
        out.push({ address, url: urlOf.get(address) ?? null, models, linkedAccounts: await chain.minerLinkedAccounts(address) });
      };
      for (const r of registered) await add(r.address, r.models);
      for (const e of endpoints) await add(e.address, []);
      return out;
    },
  };
}
