import type {
  ChainPort, ClaimResult, Env, FaucetLimits, FaucetPort, InferenceIntent, MinerDirectory, MinerInfo, SecretStore,
  AgentWalletInfo, ChannelStatus, BuyResult,
} from '../src/core/types.js';

export interface Call { fn: string; args: unknown[] }

export function fakeEnv(start = new Date('2026-11-27T00:00:00Z')) {
  let now = start.getTime();
  const calls: Call[] = [];
  const env: Env & { calls: Call[]; advance(ms: number): void; ip: string | null } = {
    calls,
    ip: '203.0.113.7',
    now: () => new Date(now),
    advance(ms: number) { now += ms; },
    fetch: (async (...args: unknown[]) => { calls.push({ fn: 'fetch', args }); throw new Error('fakeEnv.fetch not stubbed'); }) as typeof fetch,
    async notify(title, body) { calls.push({ fn: 'notify', args: [title, body] }); },
    async publicIp() { calls.push({ fn: 'publicIp', args: [] }); return env.ip; },
  };
  return env;
}

export const OPEN_LIMITS: FaucetLimits = {
  status: 'open', grantFlop: 10, cooldownSeconds: 86400, rolloverRequiresSpend: true,
  remainingFlop: 564150, usedFlop: 10435850, limitFlop: 11000000, ipGrantsPerDay: 3, asOf: '2026-11-27T00:00:00.000Z',
};

export function fakeFaucet(opts: { limits?: FaucetLimits; result?: Partial<ClaimResult> | ((addr: string, nonce: string, sig: string) => Partial<ClaimResult>) } = {}) {
  const calls: Call[] = [];
  const f: FaucetPort & { calls: Call[]; limitsValue: FaucetLimits; throwOnClaim?: Error } = {
    calls,
    limitsValue: { ...(opts.limits ?? OPEN_LIMITS) },
    async chain() { calls.push({ fn: 'chain', args: [] }); return { network: 'testnet', genesisHash: '0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800' }; },
    async limits() { calls.push({ fn: 'limits', args: [] }); return { ...f.limitsValue }; },
    async claim(address, o) {
      const sig = await o.sign(new TextEncoder().encode(`msg|${address}|${o.nonce}`));
      calls.push({ fn: 'claim', args: [address, o.nonce, sig] });
      if (f.throwOnClaim) throw f.throwOnClaim;
      const r = typeof opts.result === 'function' ? opts.result(address, o.nonce, sig) : (opts.result ?? {});
      return { outcome: 'accepted', txHash: '0xtx' + o.nonce, transferStatus: 'included', amountFlop: 10, ...r, nonce: o.nonce };
    },
  };
  return f;
}

export function fakeChain(init: Partial<{ spec: number; head: number; balances: Record<string, bigint>; wallets: Record<string, AgentWalletInfo>; linked: Record<string, string[] | null>; registered: { address: string; models: string[] }[] }> = {}) {
  const calls: Call[] = [];
  const balances: Record<string, bigint> = { ...(init.balances ?? {}) };
  const wallets: Record<string, AgentWalletInfo> = { ...(init.wallets ?? {}) };
  const channels: Record<string, ChannelStatus> = {};
  let n = 0;
  const c: ChainPort & {
    calls: Call[]; balances: typeof balances; wallets: typeof wallets; channels: typeof channels;
    spec: number; head: number; throwOn: Partial<Record<string, Error>>; buyOutput: string;
  } = {
    calls, balances, wallets, channels, spec: init.spec ?? 1014039, head: init.head ?? 1000, throwOn: {}, buyOutput: 'ok answer',
    async genesisHash() { calls.push({ fn: 'genesisHash', args: [] }); return '0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800'; },
    async specVersion() { calls.push({ fn: 'specVersion', args: [] }); if (c.throwOn.specVersion) throw c.throwOn.specVersion; return c.spec; },
    async finalizedHead() { calls.push({ fn: 'finalizedHead', args: [] }); return c.head; },
    async finalizedFreeBalance(a) { calls.push({ fn: 'finalizedFreeBalance', args: [a] }); return balances[a] ?? 0n; },
    async getAgentWallet(a) { calls.push({ fn: 'getAgentWallet', args: [a] }); return wallets[a] ?? null; },
    async createAgentWallet(pair, p) { calls.push({ fn: 'createAgentWallet', args: [pair.address, p] }); wallets[pair.address] = { ...p, active: true }; return '0xenroll' + (++n); },
    async deactivateWallet(pair) { calls.push({ fn: 'deactivateWallet', args: [pair.address] }); if (wallets[pair.address]) wallets[pair.address].active = false; return '0xdeact' + (++n); },
    async prepareInference(pair, p) { calls.push({ fn: 'prepareInference', args: [pair.address, p] }); if (c.throwOn.prepareInference) throw c.throwOn.prepareInference; return { id: 'intent' + (++n), secret: 's3cr3t', ...p } as InferenceIntent; },
    async buyInference(pair, p) {
      calls.push({ fn: 'buyInference', args: [pair.address, p.intent.id, p.prompt] });
      if (c.throwOn.buyInference) { const e = c.throwOn.buyInference; delete c.throwOn.buyInference; throw e; }
      const channelId = '0xch' + p.intent.id; channels[channelId] = 'settlement_posted';
      return { status: 'settlement_posted', output: c.buyOutput, channelId, gnUsed: 42n } satisfies BuyResult;
    },
    async channelStatus(id) { calls.push({ fn: 'channelStatus', args: [id] }); return channels[id] ?? 'unknown'; },
    async minerLinkedAccounts(m) { calls.push({ fn: 'minerLinkedAccounts', args: [m] }); return init.linked && m in init.linked ? init.linked[m]! : []; },
    async registeredMiners() { calls.push({ fn: 'registeredMiners', args: [] }); return init.registered ?? []; },
    async disconnect() { calls.push({ fn: 'disconnect', args: [] }); },
  };
  return c;
}

export function fakeMiners(list: MinerInfo[]): MinerDirectory & { calls: Call[] } {
  const calls: Call[] = [];
  return { calls, async list() { calls.push({ fn: 'list', args: [] }); return list; } };
}

export function memSecretStore(initial: string | null = null): SecretStore & { value: string | null; failGet?: Error } {
  const s: SecretStore & { value: string | null; failGet?: Error } = {
    value: initial,
    async get() { if (s.failGet) throw s.failGet; return s.value; },
    async set(pw) { s.value = pw; },
    async remove() { s.value = null; },
  };
  return s;
}

export const callsOf = (x: { calls: Call[] }, fn: string) => x.calls.filter((c) => c.fn === fn);
