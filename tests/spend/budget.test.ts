import { test, expect } from 'vitest';
import { planSessions } from '../../src/spend/budget.js';

const E = 10n ** 18n;
const f = (x: number) => BigInt(Math.round(x * 100)) * E / 100n;

test('splits balance minus reserve into perTx chunks', () => {
  expect(planSessions(f(10.2), f(0.5), f(5), f(0.01), f(30))).toEqual([f(5), f(4.7)]);
});

test('capped by the remaining daily ceiling', () => {
  expect(planSessions(f(10.2), f(0.5), f(5), f(0.01), f(3))).toEqual([f(3)]);
});

test('drops a remainder below minEscrow', () => {
  const balance = 5n * E + (105n * E) / 1000n; // 5.105 FLOP → 5.005 after reserve → remainder 0.005 < 0.01
  expect(planSessions(balance, f(0.1), f(5), f(0.01), f(30))).toEqual([f(5)]);
});

test('nothing to spend when balance <= reserve or ceiling used up', () => {
  expect(planSessions(f(0.1), f(0.1), f(5), f(0.01), f(30))).toEqual([]);
  expect(planSessions(f(10), f(0.1), f(5), f(0.01), 0n)).toEqual([]);
  expect(planSessions(0n, f(0.1), f(5), f(0.01), f(30))).toEqual([]);
});
