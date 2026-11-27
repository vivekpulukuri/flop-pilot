import { Hono, type Context } from 'hono';
import type { ChainPort, Env, FaucetLimits, FaucetPort, Network } from '../../core/types.js';
import type { Ledger } from '../../ledger/ledger.js';
import type { DashboardDeps } from '../server.js';
import type { gather } from '../data.js';
import { layout } from '../views.js';
import { html, raw } from '../html.js';
import { loadConfig, updateConfig } from '../../core/config.js';
import { openCtx, loadWallets } from '../../runtime.js';
import { claimGuard, claimWallet, SKIP_TEXT } from '../../faucet/claim.js';
import { createFaucet } from '../../faucet/sdk-faucet.js';
import { spendWallet } from '../../spend/purchase.js';
import { createMinerDirectory } from '../../spend/miners.js';
import { setActivationBlock } from '../../watchers/mode.js';
import { stopAll } from '../../commands/autopilot.js';
import { addMinerEndpoint, isSs58, removeMinerEndpoint } from '../../commands/settings.js';
import { runExport } from '../../commands/export.js';

type Data = Awaited<ReturnType<typeof gather>>;
const ok = (c: Context, message: string, extra: object = {}) => c.json({ ok: true, message, ...extra });
const bad = (c: Context, message: string) => c.json({ ok: false, message }, 400);
async function body(c: Context): Promise<Record<string, string>> {
  const ct = c.req.header('content-type') ?? '';
  if (ct.includes('application/json')) return (await c.req.json().catch(() => ({}))) as Record<string, string>;
  const b = await c.req.parseBody().catch(() => ({}));
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, String(v)]));
}

const NUM_SETTINGS = ['perTxLimitFlop', 'dailyCapFlop', 'dailySpendCeilingFlop', 'feeReserveFlop'] as const;

export function controlRoutes(deps: DashboardDeps, chain: () => Promise<ChainPort | null>) {
  const api = new Hono();
  const faucetOf = (n: Network): FaucetPort => (deps.makeFaucet ?? createFaucet)(n, deps.env);

  /** Runs a wallet action with the same guards the autopilot uses. */
  async function walletAction(c: Context, kind: 'claim' | 'spend') {
    const idx = Number(c.req.param('index'));
    if (!deps.store) return bad(c, 'This dashboard cannot sign (no Keychain access).');
    const ch = await chain();
    if (!ch) return bad(c, 'Could not reach the FLOP chain. Check your internet connection.');
    const ctx = openCtx(deps.home, deps.env);
    try {
      const w = (await loadWallets(ctx, deps.store)).find((x) => x.index === idx);
      if (!w) return bad(c, `There is no wallet #${idx}.`);
      if (kind === 'claim') {
        const result = await claimWallet(ctx, w, { faucet: faucetOf(ctx.network), chain: ch });
        return ok(c, result.detail, { result });
      }
      const results = await spendWallet(ctx, w, { chain: ch, miners: createMinerDirectory(ch, ctx.config.minerEndpoints) });
      return ok(c, results.map((r) => r.detail).join(' · '), { result: results });
    } finally {
      ctx.ledger.close();
    }
  }

  api.post('/claim/:index', (c) => walletAction(c, 'claim'));
  api.post('/spend/:index', (c) => walletAction(c, 'spend'));
  api.post('/pause', (c) => { updateConfig(deps.home, { paused: true }); return ok(c, 'Paused. Claims and purchases wait until you resume.'); });
  api.post('/resume', (c) => { updateConfig(deps.home, { paused: false }); return ok(c, 'Resumed.'); });
  api.post('/practice', async (c) => {
    const on = (await body(c)).on === 'true';
    updateConfig(deps.home, { practice: on });
    return ok(c, on ? 'Practice mode on: nothing is signed or sent.' : 'Practice mode off: claims and purchases are real.');
  });
  api.post('/stop', async (c) => {
    if ((await body(c)).confirm?.trim() !== 'STOP') return bad(c, 'Type STOP in the box to confirm.');
    await stopAll(deps.home);
    return ok(c, 'The autopilot is stopped. Turn it back on with: flop-pilot autopilot on');
  });
  api.post('/settings', async (c) => {
    const b = await body(c);
    const patch: Record<string, number> = {};
    if (b.claimers !== undefined && b.claimers !== '') {
      const k = Number(b.claimers);
      if (![1, 2, 3].includes(k)) return bad(c, 'The faucet allows 3 claims per internet connection per day, so choose 1, 2 or 3 claiming wallets.');
      patch.claimers = k;
    }
    for (const key of NUM_SETTINGS) {
      if (b[key] === undefined || b[key] === '') continue;
      const v = Number(b[key]);
      if (!Number.isFinite(v) || v <= 0) return bad(c, `${key} must be a positive number.`);
      patch[key] = v;
    }
    if (b.tickMinutes !== undefined && b.tickMinutes !== '') {
      const v = Number(b.tickMinutes);
      if (!Number.isInteger(v) || v < 5) return bad(c, 'Run interval must be at least 5 minutes.');
      patch.tickMinutes = v;
    }
    updateConfig(deps.home, patch);
    if (patch.claimers) {
      const l = deps.ledgerOf();
      try { const n = loadConfig(deps.home).network; for (const w of l.listWallets(n)) l.setWalletFlags(n, w.idx, { claimer: w.idx < patch.claimers }); } finally { l.close(); }
    }
    return ok(c, 'Settings saved.' + (patch.tickMinutes ? ' Turn the autopilot off and on again to apply the new interval.' : ''));
  });
  api.post('/my-miners', async (c) => {
    const list = ((await body(c)).addresses ?? '').split(/[\s,]+/).filter(Boolean);
    const badOne = list.find((a) => !isSs58(a));
    if (badOne) return bad(c, `"${badOne}" is not a valid FLOP address.`);
    updateConfig(deps.home, { myMiners: [...new Set(list)] });
    return ok(c, `Saved ${list.length} miner address${list.length === 1 ? '' : 'es'} as yours. The autopilot never pays them.`);
  });
  api.post('/miner-endpoints', async (c) => {
    const b = await body(c);
    try { addMinerEndpoint(deps.home, (b.address ?? '').trim(), (b.url ?? '').trim()); } catch (e) { return bad(c, (e as Error).message); }
    return ok(c, 'Miner endpoint added.');
  });
  api.post('/miner-endpoints/remove', async (c) => { removeMinerEndpoint(deps.home, ((await body(c)).address ?? '').trim()); return ok(c, 'Miner endpoint removed.'); });
  api.post('/activation', async (c) => {
    const raw = ((await body(c)).block ?? '').trim();
    try { setActivationBlock(deps.home, loadConfig(deps.home).network, raw === '' ? null : Number(raw)); } catch (e) { return bad(c, (e as Error).message); }
    return ok(c, raw === '' ? 'Start block cleared.' : `Saved: earning starts at block ${raw}.`);
  });
  api.post('/alerts/:id/ack', (c) => {
    const l = deps.ledgerOf();
    try { l.ackAlert(Number(c.req.param('id'))); } finally { l.close(); }
    return ok(c, 'Dismissed.');
  });
  api.get('/claim-status', (c) => {
    const ctx = openCtx(deps.home, deps.env);
    try {
      const limits = ctx.ledger.getState<FaucetLimits>(`lastLimits:${ctx.network}`);
      const wallets = ctx.ledger.listWallets(ctx.network).map((w) => {
        if (!limits) return { index: w.idx, ok: false, reason: 'limits_unknown', text: 'faucet limits not checked yet' };
        const d = claimGuard(ctx, w.idx, limits);
        return d.ok ? { index: w.idx, ok: true, reason: null, text: 'ready to claim' } : { index: w.idx, ok: false, reason: d.reason, text: SKIP_TEXT[d.reason] };
      });
      return c.json({ wallets });
    } finally {
      ctx.ledger.close();
    }
  });
  api.get('/export', (c) => {
    const format = c.req.query('format') === 'json' ? 'json' : 'csv';
    const out = runExport(deps.home, { format, withIp: c.req.query('withIp') === '1', network: loadConfig(deps.home).network });
    return c.body(out, 200, { 'content-type': format === 'json' ? 'application/json' : 'text/csv', 'content-disposition': `attachment; filename="flop-pilot-${deps.env.now().toISOString().slice(0, 10)}.${format}"` });
  });
  return api;
}

export function controlsPage(d: Data, l: Ledger, env: Env, autopilotOn: boolean | null): string {
  const c = d.config;
  const ctx = { home: '', config: c, ledger: l, env, network: d.network };
  const why = (idx: number) => {
    if (!d.limits) return { ok: false, text: 'faucet limits not checked yet' };
    const g = claimGuard(ctx, idx, d.limits);
    return g.ok ? { ok: true, text: 'ready' } : { ok: false, text: SKIP_TEXT[g.reason] };
  };
  const body = html`
  <section><h2>Autopilot</h2>
    <p>${c.paused ? 'Claims and purchases are paused.' : 'Claims and purchases run on schedule.'} ${c.practice ? 'Practice mode is on, so nothing is signed or sent.' : 'Practice mode is off, so actions are real.'}</p>
    <form class="inline" method="post" action="/api/${c.paused ? 'resume' : 'pause'}" data-post data-reload><button type="submit">${c.paused ? 'Resume' : 'Pause'}</button></form>
    <form class="inline" method="post" action="/api/practice" data-post data-reload><input type="hidden" name="on" value="${c.practice ? 'false' : 'true'}"><button class="quiet" type="submit">${c.practice ? 'Turn practice mode off' : 'Turn practice mode on'}</button></form>
    <form class="stopform" method="post" action="/api/stop" data-post data-reload><label>Type STOP to use the kill switch <input name="confirm" autocomplete="off" size="6"></label> <button class="danger" type="submit">Stop the autopilot</button></form>
  </section>
  <section><h2>Act now</h2><p class="sub">These use the same safety checks as the autopilot. A disabled button says why.</p>
    <div class="scroll"><table><thead><tr><th>Wallet</th><th>Claim</th><th>Spend</th></tr></thead><tbody>
    ${d.wallets.map((w) => { const y = why(w.row.idx); return html`<tr><td>#${w.row.idx}</td>
      <td><form class="inline" method="post" action="/api/claim/${w.row.idx}" data-post><button type="submit" ${raw(y.ok && w.row.claimer ? '' : 'disabled')}>Claim now</button></form> <span class="why">${w.row.claimer ? y.text : 'not a claiming wallet'}</span></td>
      <td><form class="inline" method="post" action="/api/spend/${w.row.idx}" data-post><button class="quiet" type="submit" ${raw(w.row.enrolled ? '' : 'disabled')}>Spend now</button></form> <span class="why">${w.row.enrolled ? '' : 'enrolls after its first claim'}</span></td></tr>`; })}
    </tbody></table></div></section>
  <section><h2>Settings</h2><form method="post" action="/api/settings" data-post data-reload><dl class="facts">
    <dt><label for="claimers">Claiming wallets (1 to 3)</label></dt><dd><input id="claimers" name="claimers" value="${c.claimers}" inputmode="numeric" size="3"></dd>
    <dt><label for="ceil">Daily spend ceiling (FLOP)</label></dt><dd><input id="ceil" name="dailySpendCeilingFlop" value="${c.dailySpendCeilingFlop}" size="6"></dd>
    <dt><label for="ptx">Per purchase limit (FLOP)</label></dt><dd><input id="ptx" name="perTxLimitFlop" value="${c.perTxLimitFlop}" size="6"></dd>
    <dt><label for="cap">Agent daily cap (FLOP)</label></dt><dd><input id="cap" name="dailyCapFlop" value="${c.dailyCapFlop}" size="6"></dd>
    <dt><label for="res">Kept for fees (FLOP)</label></dt><dd><input id="res" name="feeReserveFlop" value="${c.feeReserveFlop}" size="6"></dd>
    <dt><label for="tick">Run every (minutes)</label></dt><dd><input id="tick" name="tickMinutes" value="${c.tickMinutes}" size="4"></dd>
  </dl><p><button type="submit">Save settings</button></p></form></section>
  <section><h2>Miner endpoints</h2><p class="sub">Miners share their endpoint address. Add one here so the autopilot can buy inference from it.</p>
    ${c.minerEndpoints.length ? html`<ul>${c.minerEndpoints.map((e) => html`<li>${e.address} at ${e.url} <form class="inline" method="post" action="/api/miner-endpoints/remove" data-post data-reload><input type="hidden" name="address" value="${e.address}"><button class="quiet" type="submit">Remove</button></form></li>`)}</ul>` : html`<p class="empty">No miner endpoints yet.</p>`}
    <form method="post" action="/api/miner-endpoints" data-post data-reload><label>Miner address <input name="address" size="50" autocomplete="off"></label> <label>Endpoint <input name="url" placeholder="https://" size="30"></label> <button type="submit">Add miner</button></form></section>
  <section><h2>Miners you run yourself</h2><p class="sub">If you or anyone sharing your setup runs a miner, list its address so the autopilot never pays it. Paying your own miner does not count and can get you flagged.</p>
    <form method="post" action="/api/my-miners" data-post data-reload><textarea name="addresses" rows="3" cols="56" aria-label="Your miner addresses, one per line">${c.myMiners.join('\n')}</textarea><br><button type="submit">Save my miners</button></form></section>
  <section><h2>Export</h2><p><a href="/api/export?format=csv">Download CSV</a> or <a href="/api/export?format=json">JSON</a>. Your IP address is left out unless you <a href="/api/export?format=csv&amp;withIp=1">include it</a>.</p></section>`;
  return layout(d, '/controls', 'Controls', body, autopilotOn);
}
