import { test, expect } from 'vitest';
import { createFaucet, parseLimits } from '../../src/faucet/sdk-faucet.js';
import { fakeEnv } from '../fakes.js';

const LIVE_LIMITS = {
  network: 'testnet',
  faucet: {
    status: 'open', balanceFlop: '91465297', dailyCap: { limitFlop: '11000000', usedFlop: '10435850', remainingFlop: '564150' },
    agent: { grantFlop: 10, claimPath: '/v1/testnet/agent-claims', rolling24HourCapFlop: 10, cooldownSeconds: 86400, rolloverRequiresSpend: true },
    perClient: { ipGrantsPerDay: 3, ipRangeGrantsPerDay: 20, ipCooldownSeconds: 86400 },
  },
  asOf: '2026-11-27T00:30:42.194Z',
};

test('parseLimits reads the live /limits shape', () => {
  expect(parseLimits(LIVE_LIMITS)).toEqual({
    status: 'open', grantFlop: 10, cooldownSeconds: 86400, rolloverRequiresSpend: true,
    remainingFlop: 564150, usedFlop: 10435850, limitFlop: 11000000, ipGrantsPerDay: 3, asOf: '2026-11-27T00:30:42.194Z',
  });
});

test('parseLimits treats a missing agent block as closed', () => {
  expect(parseLimits({ faucet: { status: 'open' }, asOf: 'x' }).status).toBe('closed');
});

test('limits() fetches <faucet>/limits', async () => {
  const env = fakeEnv();
  const urls: string[] = [];
  env.fetch = (async (u: string) => { urls.push(String(u)); return new Response(JSON.stringify(LIVE_LIMITS)); }) as typeof fetch;
  const f = createFaucet('testnet', env);
  expect((await f.limits()).remainingFlop).toBe(564150);
  expect(urls).toEqual(['https://faucet.flop.network/limits']);
});

test('testnet claim maps a refused SDK result', async () => {
  const sdk = {
    claimTestnetAgentFunds: async (_a: string, c: { nonce?: string; sign: (m: Uint8Array) => Promise<string> }) => {
      await c.sign(new Uint8Array([1]));
      return { success: false, outcome: 'refused' as const, action: 'retry_later', retryAfterSeconds: 3600, reason: 'cooldown', timestamp: 't', nonce: c.nonce! };
    },
    requestFaucetFunding: async () => { throw new Error('should not be called'); },
  };
  let signed = 0;
  const r = await createFaucet('testnet', fakeEnv(), sdk).claim('5A', { nonce: '123', sign: async () => { signed++; return '0x' + 'ab'.repeat(64); } });
  expect(r).toMatchObject({ outcome: 'refused', action: 'retry_later', retryAfterSeconds: 3600, reason: 'cooldown', nonce: '123' });
  expect(signed).toBe(1);
});

test('accepted result without outcome field maps to accepted; failure without outcome → unknown', async () => {
  const mk = (res: object) => ({ claimTestnetAgentFunds: async () => ({ timestamp: 't', nonce: '1', ...res }), requestFaucetFunding: async () => ({}) as never });
  expect((await createFaucet('testnet', fakeEnv(), mk({ success: true, txHash: '0xt', amount: 10 })).claim('5A', { nonce: '1', sign: async () => '0x' })).outcome).toBe('accepted');
  expect((await createFaucet('testnet', fakeEnv(), mk({ success: false })).claim('5A', { nonce: '1', sign: async () => '0x' })).outcome).toBe('unknown');
});

test('devnet claim uses requestFaucetFunding and never signs', async () => {
  const calls: unknown[] = [];
  const sdk = {
    claimTestnetAgentFunds: async () => { throw new Error('no'); },
    requestFaucetFunding: async (a: string, c: object) => { calls.push([a, c]); return { success: true, outcome: 'accepted' as const, amount: 25, txHash: '0xd', transferStatus: 'included' as const, timestamp: 't' }; },
  };
  let signed = 0;
  const r = await createFaucet('devnet', fakeEnv(), sdk).claim('5A', { nonce: '9', sign: async () => { signed++; return '0x'; } });
  expect(r).toMatchObject({ outcome: 'accepted', amountFlop: 25, txHash: '0xd', nonce: '9' });
  expect(signed).toBe(0);
  expect(calls[0]).toEqual(['5A', { network: 'devnet', client: 'flop-pilot' }]);
});
