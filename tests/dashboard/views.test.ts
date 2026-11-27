import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/dashboard/server.js';
import { esc, html, txLink } from '../../src/dashboard/html.js';
import { runInit } from '../../src/commands/init.js';
import { updateConfig } from '../../src/core/config.js';
import { paths } from '../../src/core/paths.js';
import { openLedger } from '../../src/ledger/ledger.js';
import { fakeChain, fakeEnv, memSecretStore, OPEN_LIMITS } from '../fakes.js';
import { TEST_SEED } from '../fixtures/seed.js';

const PORT = 4747;
const TOKEN = 'tok_abcdefghijklmnopqrstuvwx';
const XSS = '<script>alert(1)</script>';
let home: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  home = join(mkdtempSync(join(tmpdir(), 'fpdv-')), 'h');
  await runInit({ home, network: 'testnet', restore: true, store: memSecretStore(), io: { print() {}, clear() {}, async ask() { return TEST_SEED; } } });
  updateConfig(home, { practice: false });
  const l = openLedger(paths(home).ledger);
  const w = l.listWallets('testnet');
  l.insertClaim({ network: 'testnet', wallet_idx: 0, address: w[0].address, nonce: '1', status: 'refused', reason: XSS, public_ip: '203.0.113.7', amount: '10000000000000000000', ts: '2026-11-26T23:00:00.000Z' });
  l.insertClaim({ network: 'testnet', wallet_idx: 1, address: w[1].address, nonce: '2', status: 'finalized', tx_hash: '0xabc', amount: '10000000000000000000', ts: '2026-11-26T22:00:00.000Z' });
  const out = join(paths(home).outputs, 'o1.md');
  writeFileSync(out, `# t\n\n## Output\n\n${XSS}`);
  l.insertSpend({ network: 'testnet', wallet_idx: 1, intent_id: 'i1', miner: '5Miner', miner_url: 'https://m', independence: 'independent', escrow: '5000000000000000000', status: 'settlement_posted', channel_id: '0xch', output_path: out, ts: '2026-11-26T23:30:00.000Z' });
  l.setState('lastLimits:testnet', { ...OPEN_LIMITS, remainingFlop: 301380 });
  l.setState('poolResetAt:testnet', '2026-11-27T00:00:30.000Z');
  l.setState('watch:diff:https://flop.finance/testnet/', `- old\n+ ${XSS}`);
  l.addAlert('rules_changed', `Rules changed ${XSS}`, 'k1');
  l.close();
  app = createApp({ home, env: fakeEnv(new Date('2026-11-27T00:30:00Z')), ledgerOf: () => openLedger(paths(home).ledger), chainOf: async () => fakeChain(), token: TOKEN, port: PORT });
});

const get = async (path: string) => {
  const r = await app.request(path, { headers: { host: `127.0.0.1:${PORT}`, cookie: `fp_session=${TOKEN}` } });
  expect(r.status).toBe(200);
  return r.text();
};
const PAGES = ['/', '/wallets', '/activity', '/spending', '/rules'];

test('esc and html`` escape the five HTML specials; arrays and nested html are joined', () => {
  expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  expect(String(html`<p>${'<b>'}</p>${[html`<i>${1}</i>`, html`<i>${2}</i>`]}`)).toBe('<p>&lt;b&gt;</p><i>1</i><i>2</i>');
});

test('txLink uses the explorer /transactions/ path', () => {
  expect(txLink('testnet', '0xabc')).toBe('https://testnet.flopscan.io/transactions/0xabc');
});

test('REVIEW-FOCUS-4: miner output is escaped on the Spending page', async () => {
  const t = await get('/spending');
  expect(t).not.toContain(XSS);
  expect(t).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('REVIEW-FOCUS-4: rules diff, alert text and faucet reasons are escaped everywhere', async () => {
  for (const p of PAGES) expect(await get(p)).not.toContain(XSS);
  expect(await get('/rules')).toContain('&lt;script&gt;');
  expect(await get('/activity')).toContain('&lt;script&gt;');
});

test('Overview shows mode, next claim per wallet, pool remaining, observed reset and open alerts', async () => {
  const t = await get('/');
  expect(t).toMatch(/standby/i);
  expect(t).toContain('301,380');
  expect(t).toContain('00:00');
  expect(t).toMatch(/wallet #0/i);
  expect(t).toMatch(/wallet #2/i);
  expect(t).toMatch(/Rules changed/);
});

test('Activity shows origin IP and links tx hashes to the explorer', async () => {
  const t = await get('/activity');
  expect(t).toContain('203.0.113.7');
  expect(t).toContain('https://testnet.flopscan.io/transactions/0xabc');
});

test('Activity filters by type', async () => {
  const t = await get('/activity?type=spend');
  expect(t).toContain('5Miner');
  expect(t).not.toContain('0xabc');
});

test('the seed phrase never appears on any page', async () => {
  const words = TEST_SEED.split(' ');
  for (const p of PAGES) {
    const t = await get(p);
    expect(t.includes(words.slice(0, 3).join(' '))).toBe(false);
    expect(t.includes(words.slice(-3).join(' '))).toBe(false);
  }
});

test('series endpoint returns 30 days of claimed and spent FLOP for a wallet', async () => {
  const r = await app.request('/api/series/1', { headers: { host: `127.0.0.1:${PORT}`, cookie: `fp_session=${TOKEN}` } });
  const j = (await r.json()) as { days: string[]; claimed: number[]; spent: number[] };
  expect(j.days).toHaveLength(30);
  expect(j.claimed.at(-2)).toBe(10);
  expect(j.spent.at(-2)).toBe(5);
});
