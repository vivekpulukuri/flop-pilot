import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pageText, checkPage, runWatchers, ACTIVATION_PAGES, RULES_PAGES } from '../../src/watchers/pagewatch.js';
import { checkRuntime } from '../../src/watchers/runtime.js';
import { currentMode, setActivationBlock } from '../../src/watchers/mode.js';
import type { Ctx } from '../../src/core/ctx.js';
import { DEFAULT_CONFIG, saveConfig, loadConfig } from '../../src/core/config.js';
import { ensureDirs, paths } from '../../src/core/paths.js';
import { openLedger } from '../../src/ledger/ledger.js';
import { fakeChain, fakeEnv, callsOf } from '../fakes.js';

let ctx: Ctx & { env: ReturnType<typeof fakeEnv> };
let pages: Record<string, string>;
beforeEach(() => {
  const home = join(mkdtempSync(join(tmpdir(), 'fpw-')), 'h');
  ensureDirs(home);
  saveConfig(home, { ...DEFAULT_CONFIG, network: 'testnet' });
  ctx = { home, config: loadConfig(home), ledger: openLedger(paths(home).ledger), env: fakeEnv(new Date('2026-11-27T12:00:00Z')), network: 'testnet' };
  pages = {};
  ctx.env.fetch = (async (u: string) => {
    if (!(String(u) in pages)) throw new Error('offline');
    return new Response(pages[String(u)]);
  }) as typeof fetch;
});

const URL1 = 'https://flop.finance/testnet/';

test('pageText strips scripts, styles, tags and decodes entities, one line per block', () => {
  expect(pageText('<style>x{}</style><script>alert(1)</script><h1>Rules &amp; terms</h1><p>One&nbsp;participant</p>')).toBe('Rules & terms\nOne participant');
});

test('first fetch stores a snapshot and raises no alert', async () => {
  pages[URL1] = '<p>v1</p>';
  expect(await checkPage(ctx, URL1, 'rules')).toEqual({ changed: false });
  expect(ctx.ledger.lastSnapshot(URL1)?.text).toBe('v1');
  expect(ctx.ledger.listAlerts()).toHaveLength(0);
});

test('changed text → one alert and one notification with a stored diff; repeat → no second notify', async () => {
  pages[URL1] = '<p>v1</p>';
  await checkPage(ctx, URL1, 'rules');
  pages[URL1] = '<p>v2</p>';
  const r = await checkPage(ctx, URL1, 'rules');
  expect(r.changed).toBe(true);
  expect(r.diff).toContain('- v1');
  expect(r.diff).toContain('+ v2');
  await checkPage(ctx, URL1, 'rules');
  expect(callsOf(ctx.env, 'notify')).toHaveLength(1);
  expect(ctx.ledger.listAlerts(true)).toHaveLength(1);
  expect(ctx.ledger.getState(`watch:diff:${URL1}`)).toContain('+ v2');
});

test('markup-only change (same text) → no alert', async () => {
  pages[URL1] = '<p>same</p>';
  await checkPage(ctx, URL1, 'rules');
  pages[URL1] = '<div class="new"><span>same</span></div>';
  expect((await checkPage(ctx, URL1, 'rules')).changed).toBe(false);
});

test('fetch failure is returned as an error, never thrown', async () => {
  expect(await checkPage(ctx, 'https://flop.finance/airdrop/', 'rules')).toMatchObject({ changed: false, error: expect.stringContaining('offline') });
});

test('runWatchers checks activation pages hourly and rules pages daily', async () => {
  for (const u of [...ACTIVATION_PAGES, ...RULES_PAGES]) pages[u] = '<p>x</p>';
  await runWatchers(ctx);
  ctx.env.advance(61 * 60_000);
  await runWatchers(ctx);
  expect(ctx.ledger.getState<string>(`watch:lastChecked:${ACTIVATION_PAGES[0]}`)).toBe('2026-11-27T13:01:00.000Z');
  expect(ctx.ledger.getState<string>(`watch:lastChecked:${RULES_PAGES[0]}`)).toBe('2026-11-27T12:00:00.000Z');
});

test('unsupported spec → blocked with one alert across two calls; supported again clears the block', async () => {
  const chain = fakeChain({ spec: 1014099 });
  expect(await checkRuntime(ctx, chain)).toBe('unsupported');
  expect(await checkRuntime(ctx, chain)).toBe('unsupported');
  const alerts = ctx.ledger.listAlerts(true).filter((a) => a.kind === 'runtime_unsupported');
  expect(alerts).toHaveLength(1);
  expect(alerts[0].message).toBe('FLOP upgraded the chain. Run: npm run update');
  expect(ctx.ledger.getState('runtimeBlocked:testnet')).toBe(1014099);
  chain.spec = 1014039;
  expect(await checkRuntime(ctx, chain)).toBe('upgraded');
  expect(ctx.ledger.getState('runtimeBlocked:testnet')).toBeNull();
});

test('first runtime check is ok; a supported change is "upgraded" with an info alert', async () => {
  const chain = fakeChain({ spec: 1014038 });
  expect(await checkRuntime(ctx, chain)).toBe('ok');
  chain.spec = 1014039;
  expect(await checkRuntime(ctx, chain)).toBe('upgraded');
  expect(ctx.ledger.listAlerts(true).some((a) => a.kind === 'runtime_upgraded')).toBe(true);
});

test('mode is earning iff finalizedHead >= activationBlock; switching alerts once', async () => {
  const chain = fakeChain({ head: 999 });
  expect(await currentMode(ctx, chain)).toBe('standby');
  setActivationBlock(ctx.home, 'testnet', 1000);
  ctx.config = loadConfig(ctx.home);
  expect(await currentMode(ctx, chain)).toBe('standby');
  chain.head = 1000;
  expect(await currentMode(ctx, chain)).toBe('earning');
  expect(await currentMode(ctx, chain)).toBe('earning');
  expect(ctx.ledger.listAlerts(true).filter((a) => a.kind === 'earning_started')).toHaveLength(1);
});

test('setActivationBlock rejects non-positive numbers and accepts null to clear', () => {
  expect(() => setActivationBlock(ctx.home, 'testnet', -5)).toThrow();
  setActivationBlock(ctx.home, 'testnet', 42);
  setActivationBlock(ctx.home, 'testnet', null);
  expect(loadConfig(ctx.home).activationBlock.testnet).toBeNull();
});
