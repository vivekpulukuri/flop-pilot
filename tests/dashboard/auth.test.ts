import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/dashboard/server.js';
import { runInit } from '../../src/commands/init.js';
import { paths } from '../../src/core/paths.js';
import { openLedger } from '../../src/ledger/ledger.js';
import { fakeChain, fakeEnv, memSecretStore } from '../fakes.js';
import { TEST_SEED } from '../fixtures/seed.js';

const PORT = 4747;
const TOKEN = 'tok_abcdefghijklmnopqrstuvwx';
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  const home = join(mkdtempSync(join(tmpdir(), 'fpda-')), 'h');
  await runInit({ home, network: 'testnet', restore: true, store: memSecretStore(), io: { print() {}, clear() {}, async ask() { return TEST_SEED; } } });
  app = createApp({ home, env: fakeEnv(), ledgerOf: () => openLedger(paths(home).ledger), chainOf: async () => fakeChain(), token: TOKEN, port: PORT });
});

const H = { host: `127.0.0.1:${PORT}` };

test('no cookie → 401 with how-to-open text', async () => {
  const r = await app.request('/', { headers: H });
  expect(r.status).toBe(401);
  expect(await r.text()).toContain('npm run dashboard');
});

test('?t=wrong → 401; ?t=right → 302 with an HttpOnly SameSite=Strict cookie', async () => {
  expect((await app.request('/?t=nope', { headers: H })).status).toBe(401);
  const r = await app.request(`/?t=${TOKEN}`, { headers: H });
  expect(r.status).toBe(302);
  expect(r.headers.get('location')).toBe('/');
  const c = r.headers.get('set-cookie')!;
  expect(c).toMatch(/fp_session=/);
  expect(c).toMatch(/HttpOnly/i);
  expect(c).toMatch(/SameSite=Strict/i);
});

test('valid cookie → 200', async () => {
  const r = await app.request('/', { headers: { ...H, cookie: `fp_session=${TOKEN}` } });
  expect(r.status).toBe(200);
});

test('foreign Host header → 403 (DNS rebinding)', async () => {
  const r = await app.request(`/?t=${TOKEN}`, { headers: { host: 'evil.com' } });
  expect(r.status).toBe(403);
});

test('POST with a foreign Origin → 403 even with the cookie', async () => {
  const r = await app.request('/api/pause', { method: 'POST', headers: { ...H, cookie: `fp_session=${TOKEN}`, origin: 'http://evil.com' } });
  expect(r.status).toBe(403);
});
