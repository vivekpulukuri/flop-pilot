import { existsSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import type { ChainPort, Env, FaucetPort, Network, SecretStore } from '../core/types.js';
import { loadConfig } from '../core/config.js';
import { paths } from '../core/paths.js';
import type { Ledger } from '../ledger/ledger.js';
import { localAuth } from './auth.js';
import { STYLE } from './assets.js';
import { APP_JS } from './app-js.js';
import { gather, series } from './data.js';
import { activityPage, overview, rulesPage, spendingPage, walletsPage, WATCHED } from './views.js';
import { createMinerDirectory } from '../spend/miners.js';
import { eligibleMiners } from '../spend/independence.js';
import { controlRoutes, controlsPage } from './routes/controls.js';

export interface DashboardDeps {
  home: string;
  env: Env;
  ledgerOf: () => Ledger;
  chainOf: () => Promise<ChainPort>;
  token: string;
  port: number;
  autopilotLoaded?: () => Promise<boolean>;
  store?: SecretStore;
  makeFaucet?: (n: Network, env: Env) => FaucetPort;
}

export function createApp(deps: DashboardDeps) {
  const app = new Hono();
  let chainP: Promise<ChainPort> | null = null;
  const chain = async (): Promise<ChainPort | null> => {
    try { chainP ??= deps.chainOf(); return await chainP; } catch { chainP = null; return null; }
  };
  const withLedger = async <T>(f: (l: Ledger) => Promise<T> | T): Promise<T> => {
    const l = deps.ledgerOf();
    try { return await f(l); } finally { l.close(); }
  };
  const loaded = async () => (deps.autopilotLoaded ? deps.autopilotLoaded().catch(() => null) : null);

  app.use('*', localAuth(deps.token, deps.port));
  app.get('/static/style.css', (c) => c.body(STYLE, 200, { 'content-type': 'text/css; charset=utf-8' }));
  app.get('/static/app.js', (c) => c.body(APP_JS, 200, { 'content-type': 'text/javascript; charset=utf-8' }));

  app.get('/', async (c) => c.html(await withLedger(async (l) => overview(await gather(deps.home, deps.env, l, await chain()), await loaded()))));
  app.get('/wallets', async (c) => c.html(await withLedger(async (l) => {
    const d = await gather(deps.home, deps.env, l, await chain());
    return walletsPage(d, (i) => series(l, d.network, i, d.now), await loaded());
  })));
  app.get('/activity', async (c) => c.html(await withLedger(async (l) => {
    const d = await gather(deps.home, deps.env, l, await chain());
    const type = c.req.query('type');
    const w = c.req.query('wallet');
    const f = { type: (type === 'claim' || type === 'spend' ? type : undefined) as 'claim' | 'spend' | undefined, index: w !== undefined && w !== '' && /^\d$/.test(w) ? Number(w) : undefined };
    return activityPage(d, l.activity(d.network, { ...f, limit: 200 }), f, await loaded());
  })));
  app.get('/spending', async (c) => c.html(await withLedger(async (l) => {
    const ch = await chain();
    const d = await gather(deps.home, deps.env, l, ch);
    const own = new Set(d.wallets.map((w) => w.row.address));
    const list = ch ? await createMinerDirectory(ch, d.config.minerEndpoints).list().catch(() => []) : d.config.minerEndpoints.map((e) => ({ ...e, models: [], linkedAccounts: null }));
    const miners = eligibleMiners(list, own, new Set(d.config.myMiners)).map((r) => ({ address: r.miner.address, url: r.miner.url, result: r.result }));
    const spends = l.spendsSince(d.network, new Date(0)).reverse().slice(0, 50);
    const dir = paths(deps.home).tasks;
    const queued = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(txt|md)$/i.test(f)) : [];
    return spendingPage(d, spends, miners, queued, await loaded());
  })));
  app.get('/rules', async (c) => c.html(await withLedger(async (l) => {
    const d = await gather(deps.home, deps.env, l, await chain());
    const diffs = WATCHED.map((url) => ({ url, diff: l.getState<string>(`watch:diff:${url}`), checked: l.getState<string>(`watch:lastChecked:${url}`) }));
    return rulesPage(d, diffs, await loaded());
  })));
  app.get('/controls', async (c) => c.html(await withLedger(async (l) => controlsPage(await gather(deps.home, deps.env, l, await chain()), l, deps.env, await loaded()))));
  app.get('/api/series/:index', async (c) => withLedger((l) => {
    const n = loadConfig(deps.home).network;
    return c.json(series(l, n, Number(c.req.param('index')), deps.env.now()));
  }));
  app.route('/api', controlRoutes(deps, chain));
  return app;
}
