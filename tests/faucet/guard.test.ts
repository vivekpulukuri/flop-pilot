import { test, expect } from 'vitest';
import { decideClaim, nextBackoff, detectPoolReset, HARD_CLAIM_CAP, type ClaimGuardInput } from '../../src/faucet/guard.js';
import { OPEN_LIMITS } from '../fakes.js';

const now = new Date('2026-11-27T12:00:00Z');
const base = (over: Partial<ClaimGuardInput> = {}): ClaimGuardInput => ({
  now, wallet: { claimer: true, stopped: false }, claims24h: 0, lastAcceptedAt: null, lastGrantSpent: false,
  hasUnresolved: false, backoffUntil: null, sharedIpPauseUntil: null, claimsStopped: false, limits: OPEN_LIMITS, ...over,
});
const reason = (i: ClaimGuardInput) => { const d = decideClaim(i); return d.ok ? 'ok' : d.reason; };

test('HARD_CLAIM_CAP is 3', () => expect(HARD_CLAIM_CAP).toBe(3));
test('first-ever claim on an open faucet is ok', () => expect(reason(base())).toBe('ok'));
test('claims24h=3 → global_cap', () => expect(reason(base({ claims24h: 3 }))).toBe('global_cap'));
test('claims24h=2 → ok', () => expect(reason(base({ claims24h: 2 }))).toBe('ok'));

test('cooldown boundary: 86399s ago → cooldown with until; 86400s ago → ok', () => {
  const d = decideClaim(base({ lastAcceptedAt: new Date(now.getTime() - 86399_000), lastGrantSpent: true }));
  expect(d).toEqual({ ok: false, reason: 'cooldown', until: new Date(now.getTime() + 1000) });
  expect(reason(base({ lastAcceptedAt: new Date(now.getTime() - 86400_000), lastGrantSpent: true }))).toBe('ok');
});

test('pool: remaining 9 < grant 10 → pool_empty; 10 → ok', () => {
  expect(reason(base({ limits: { ...OPEN_LIMITS, remainingFlop: 9 } }))).toBe('pool_empty');
  expect(reason(base({ limits: { ...OPEN_LIMITS, remainingFlop: 10 } }))).toBe('ok');
});

test('faucet status not open → faucet_closed', () => expect(reason(base({ limits: { ...OPEN_LIMITS, status: 'paused' } }))).toBe('faucet_closed'));

test('rollover: previous grant unspent → rollover_unspent; not required → ok', () => {
  const prev = new Date(now.getTime() - 90000_000);
  expect(reason(base({ lastAcceptedAt: prev, lastGrantSpent: false }))).toBe('rollover_unspent');
  expect(reason(base({ lastAcceptedAt: prev, lastGrantSpent: false, limits: { ...OPEN_LIMITS, rolloverRequiresSpend: false } }))).toBe('ok');
});

test('unresolved claim beats cooldown', () => {
  expect(reason(base({ hasUnresolved: true, lastAcceptedAt: new Date(now.getTime() - 1000) }))).toBe('unresolved_pending');
});

test('order: not_claimer, wallet_stopped, claims_stopped, shared_ip_pause, backoff come before global_cap', () => {
  const later = new Date(now.getTime() + 3600_000);
  expect(reason(base({ wallet: { claimer: false, stopped: true }, claims24h: 3 }))).toBe('not_claimer');
  expect(reason(base({ wallet: { claimer: true, stopped: true }, claims24h: 3 }))).toBe('wallet_stopped');
  expect(reason(base({ claimsStopped: true, claims24h: 3 }))).toBe('claims_stopped');
  expect(decideClaim(base({ sharedIpPauseUntil: later, claims24h: 3 }))).toEqual({ ok: false, reason: 'shared_ip_pause', until: later });
  expect(decideClaim(base({ backoffUntil: later, claims24h: 3 }))).toEqual({ ok: false, reason: 'backoff', until: later });
});

test('expired backoff and shared-IP pause no longer block', () => {
  const past = new Date(now.getTime() - 1);
  expect(reason(base({ backoffUntil: past, sharedIpPauseUntil: past }))).toBe('ok');
});

test('nextBackoff: 1, 2, 4, 6, 6 hours', () => {
  expect([1, 2, 3, 4, 5].map((a) => nextBackoff(a) / 3600_000)).toEqual([1, 2, 4, 6, 6]);
});

test('detectPoolReset returns curr.asOf when used drops, else null', () => {
  const prev = { ...OPEN_LIMITS, usedFlop: 10435850 };
  const curr = { ...OPEN_LIMITS, usedFlop: 1200, asOf: '2026-11-28T00:00:30.000Z' };
  expect(detectPoolReset(prev, curr)).toEqual(new Date('2026-11-28T00:00:30.000Z'));
  expect(detectPoolReset(curr, { ...curr, usedFlop: 5000 })).toBeNull();
});
