import { ApiPromise, WsProvider } from '@polkadot/api';
import { randomUUID } from 'node:crypto';
import { FlopClient, SUPPORTED_SPEC_VERSIONS, createAgentWallet, deactivateWallet, getAgentWallet } from '@flop-labs/sdk';
import type { ChainPort, ChannelStatus, InferenceIntent, KeyringPair, Network } from '../core/types.js';
import { NETWORK_PROFILES } from '../core/networks.js';

const SS58 = /^5[1-9A-HJ-NP-Za-km-z]{47}$/;

export function isSupportedSpec(v: number): boolean {
  return (SUPPORTED_SPEC_VERSIONS as readonly number[]).includes(v);
}

/** Collects every SS58 string inside an arbitrary JSON value (struct shapes vary by runtime). */
function ss58In(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === 'string') { if (SS58.test(v)) out.add(v); }
  else if (Array.isArray(v)) v.forEach((x) => ss58In(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => ss58In(x, out));
  return out;
}

/** Maps the on-chain `state` enum variant to our status (devnet findings Q11). */
export function mapChannelState(state: unknown): ChannelStatus {
  if (!state) return 'unknown';
  const variant = (typeof state === 'string' ? state : Object.keys(state as object)[0] ?? '').toLowerCase();
  if (variant.startsWith('open') || variant === 'active' || variant === 'forceopen') return 'open';
  if (variant.includes('settlementposted') || variant.includes('pending') || variant.includes('disput') || variant.includes('challeng')) return 'settlement_posted';
  if (variant === 'closed' || variant.includes('settled') || variant.includes('final')) return 'settled';
  if (variant.includes('refund') || variant.includes('timedout') || variant.includes('timeout') || variant.includes('expired')) return 'refunded';
  return 'unknown';
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);
}

export async function createSdkChain(n: Network, o: { timeoutMs?: number } = {}): Promise<ChainPort> {
  const profile = NETWORK_PROFILES[n];
  const provider = new WsProvider(profile.rpc, false);
  await withTimeout(provider.connect(), o.timeoutMs ?? 20000, 'Connecting to the FLOP RPC');
  const api = await withTimeout(ApiPromise.create({ provider, noInitWarn: true, throwOnConnect: true }), o.timeoutMs ?? 20000, 'Loading chain metadata');
  const genesis = api.genesisHash.toHex();
  if (genesis !== profile.genesis) {
    await api.disconnect();
    throw new Error(`RPC ${profile.rpc} reports genesis ${genesis}, expected ${profile.genesis}. Refusing to continue.`);
  }

  const clients = new Map<string, Promise<FlopClient>>();
  const clientFor = (pair: KeyringPair) => {
    if (!clients.has(pair.address)) clients.set(pair.address, FlopClient.createWithKeypair(profile.rpc, pair as never) as Promise<FlopClient>);
    return clients.get(pair.address)!;
  };
  const finalizedApi = async () => api.at(await api.rpc.chain.getFinalizedHead());

  return {
    async genesisHash() { return genesis; },
    async specVersion() { return (await api.rpc.state.getRuntimeVersion()).specVersion.toNumber(); },
    async finalizedHead() { return (await api.rpc.chain.getHeader(await api.rpc.chain.getFinalizedHead())).number.toNumber(); },
    async finalizedFreeBalance(address) {
      const acct = (await (await finalizedApi()).query.system.account(address)) as unknown as { data: { free: { toString(): string } } };
      return BigInt(acct.data.free.toString());
    },
    async getAgentWallet(address) {
      const w = await getAgentWallet(api as never, address);
      return w ? { perTxLimit: BigInt(w.perTxLimit), dailyCap: BigInt(w.dailyCap), active: w.active } : null;
    },
    async createAgentWallet(pair, p) {
      return createAgentWallet(api as never, pair as never, { agent: pair.address, perTxLimit: p.perTxLimit, dailyCap: p.dailyCap });
    },
    async deactivateWallet(pair) {
      return deactivateWallet(api as never, pair as never, pair.address);
    },
    async prepareInference(pair, p) {
      const client = await clientFor(pair);
      const sdkIntent = await client.prepareInferenceSession({ minerUrl: p.minerUrl, escrowFlop: p.escrowFlop, maxTurns: 1 });
      return { id: randomUUID(), sdk: sdkIntent } as InferenceIntent;
    },
    async buyInference(pair, p) {
      const client = await clientFor(pair);
      const r = await client.buyInferenceSession({ intent: p.intent.sdk as never, prompt: p.prompt });
      return { status: 'settlement_posted', output: String(r.output ?? ''), channelId: String(r.channelId), gnUsed: BigInt(r.gnUsed ?? 0) };
    },
    async channelStatus(channelId) {
      const v = (await api.query.computeChannel.channels(channelId)).toJSON() as { state?: unknown } | null;
      return v ? mapChannelState(v.state) : 'unknown';
    },
    async minerLinkedAccounts(miner) {
      try {
        const q = api.query.minerStaking;
        const found = new Set<string>();
        const delegators = await q.delegators(miner);
        ss58In(delegators.toJSON(), found);
        const positions = (await q.sponsorPositionsByMiner(miner)).toJSON() as unknown[];
        for (const id of Array.isArray(positions) ? positions : []) ss58In((await q.sponsorPositions(id as never)).toJSON(), found);
        found.delete(miner);
        return [...found];
      } catch {
        return null;
      }
    },
    async registeredMiners() {
      const entries = await api.query.modelRegistry.modelsByMiner.entries();
      return entries.map(([k, v]) => ({ address: k.args[0].toString(), models: ((v.toJSON() as string[] | null) ?? []).map(String) }));
    },
    async disconnect() {
      for (const c of clients.values()) { try { await (await c).disconnect(); } catch { /* ignore */ } }
      await api.disconnect();
    },
  };
}
