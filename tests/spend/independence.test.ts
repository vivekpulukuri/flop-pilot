import { test, expect } from 'vitest';
import { checkIndependence, eligibleMiners } from '../../src/spend/independence.js';
import { createMinerDirectory } from '../../src/spend/miners.js';
import { fakeChain } from '../fakes.js';
import type { MinerInfo } from '../../src/core/types.js';

const own = new Set(['5Own0', '5Own1']);
const declared = new Set(['5MyMiner']);
const m = (over: Partial<MinerInfo> = {}): MinerInfo => ({ address: '5Clean', url: 'https://m.example', models: [], linkedAccounts: [], ...over });

test('miner address equals an own wallet → own_address', () => expect(checkIndependence(m({ address: '5Own1' }), own, declared)).toBe('own_address'));
test('miner on the my-miners list → declared_own', () => expect(checkIndependence(m({ address: '5MyMiner' }), own, declared)).toBe('declared_own'));
test('linkedAccounts null → unverified (never independent)', () => expect(checkIndependence(m({ linkedAccounts: null }), own, declared)).toBe('unverified'));
test('a delegator/sponsor is an own wallet → linked', () => expect(checkIndependence(m({ linkedAccounts: ['5X', '5Own0'] }), own, declared)).toBe('linked'));
test('a delegator is a declared own miner → linked', () => expect(checkIndependence(m({ linkedAccounts: ['5MyMiner'] }), own, declared)).toBe('linked'));
test('clean miner → independent', () => expect(checkIndependence(m({ linkedAccounts: ['5Stranger'] }), own, declared)).toBe('independent'));

test('eligibleMiners sorts independent first and keeps the result', () => {
  const r = eligibleMiners([m({ address: '5Own0' }), m({ address: '5A' }), m({ address: '5B', linkedAccounts: null })], own, declared);
  expect(r.map((x) => [x.miner.address, x.result])).toEqual([['5A', 'independent'], ['5Own0', 'own_address'], ['5B', 'unverified']]);
});

test('directory joins chain-registered miners with owner-supplied endpoints', async () => {
  const chain = fakeChain({
    registered: [{ address: '5Reg', models: ['0xm1'] }, { address: '5NoUrl', models: [] }],
    linked: { '5Reg': ['5D1'], '5Extra': null },
  });
  const dir = createMinerDirectory(chain, [{ address: '5Reg', url: 'https://reg.example' }, { address: '5Extra', url: 'https://extra.example' }]);
  const list = await dir.list();
  expect(list).toEqual([
    { address: '5Reg', url: 'https://reg.example', models: ['0xm1'], linkedAccounts: ['5D1'] },
    { address: '5NoUrl', url: null, models: [], linkedAccounts: [] },
    { address: '5Extra', url: 'https://extra.example', models: [], linkedAccounts: null },
  ]);
});

test('directory survives a registry failure and still lists endpoint miners', async () => {
  const chain = fakeChain();
  chain.registeredMiners = async () => { throw new Error('rpc down'); };
  const list = await createMinerDirectory(chain, [{ address: '5E', url: 'https://e' }]).list();
  expect(list.map((x) => x.address)).toEqual(['5E']);
});
