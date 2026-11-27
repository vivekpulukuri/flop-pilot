import { test, expect } from 'vitest';
import { mapChannelState, isSupportedSpec } from '../../src/chain/sdk-chain.js';

test('mapChannelState maps on-chain state variants (devnet findings Q11)', () => {
  expect(mapChannelState({ closed: null })).toBe('settled');
  expect(mapChannelState({ open: null })).toBe('open');
  expect(mapChannelState({ settlementPosted: { challengeEnd: 5 } })).toBe('settlement_posted');
  expect(mapChannelState({ refunded: null })).toBe('refunded');
  expect(mapChannelState({ timedOut: null })).toBe('refunded');
  expect(mapChannelState(null)).toBe('unknown');
  expect(mapChannelState({ somethingNew: null })).toBe('unknown');
});

test('isSupportedSpec follows the pinned SDK list', () => {
  expect(isSupportedSpec(1014039)).toBe(true);
  expect(isSupportedSpec(1014006)).toBe(false);
});
