import { test, expect } from 'vitest';
import { toPlanck, fromPlanck } from '../../src/core/units.js';

test('toPlanck converts whole and fractional FLOP exactly', () => {
  expect(toPlanck('10')).toBe(10n * 10n ** 18n);
  expect(toPlanck(0.01)).toBe(10n ** 16n);
  expect(toPlanck('4.7')).toBe(47n * 10n ** 17n);
});

test('toPlanck rejects negative and non-numeric input', () => {
  expect(() => toPlanck(-1)).toThrow();
  expect(() => toPlanck('abc')).toThrow();
});

test('fromPlanck formats with 4 decimals by default', () => {
  expect(fromPlanck(5n * 10n ** 17n)).toBe('0.5000');
  expect(fromPlanck(25n * 10n ** 18n)).toBe('25.0000');
  expect(fromPlanck(24996509964135000000n, 6)).toBe('24.996509');
});
