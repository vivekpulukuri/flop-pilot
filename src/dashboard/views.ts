import { readFileSync } from 'node:fs';
import { html, raw, accountLink, txLink, type Safe } from './html.js';
import type { gather } from './data.js';
import { relTime, hhmmUtc } from './data.js';
import { fromPlanck } from '../core/units.js';
import type { ActivityRow, SpendRow } from '../ledger/ledger.js';
import type { Network } from '../core/types.js';
import { ACTIVATION_PAGES, RULES_PAGES } from '../watchers/pagewatch.js';

type Data = Awaited<ReturnType<typeof gather>>;
const TABS: [string, string][] = [['/', 'Overview'], ['/wallets', 'Wallets'], ['/activity', 'Activity'], ['/spending', 'Spending'], ['/rules', 'Rules and alerts'], ['/controls', 'Controls']];
const fmt = (p: bigint) => fromPlanck(p, 2);
const when = (iso: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : 'never');

export function layout(d: Data, active: string, title: string, body: Safe, autopilotOn: boolean | null): string {
  const c = d.config;
  const lamps = html`
    <span class="lamp ${autopilotOn ? 'on' : ''}">${autopilotOn === null ? 'Autopilot status unknown' : autopilotOn ? 'Autopilot on' : 'Autopilot off'}</span>
    <span class="lamp ${c.practice ? 'warn' : 'on'}">${c.practice ? 'Practice mode: nothing is sent' : 'Live: claims and spends are real'}</span>
    ${c.killed ? html`<span class="lamp bad">Stopped by kill switch</span>` : c.paused ? html`<span class="lamp warn">Paused</span>` : ''}
    ${d.runtimeBlocked ? html`<span class="lamp bad">Chain upgraded: run npm run update</span>` : ''}
    <span class="lamp">${d.network === 'testnet' ? 'FLOP Testnet' : 'FLOP Devnet'}</span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · FLOP Pilot</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/static/style.css"><script src="/static/app.js" defer></script></head>
<body><div class="wrap">${html`<header class="top"><h1>FLOP Pilot</h1><div class="lamps">${lamps}</div></header>
<nav class="tabs" aria-label="Sections">${TABS.map(([href, label]) => html`<a href="${href}" ${raw(href === active ? 'aria-current="page"' : '')}>${label}</a>`)}</nav>
<main>${body}</main>`}</div></body></html>`;
}

function strip(d: Data, w: Data['wallets'][number]): Safe {
  const cls = w.nextClaim.ready ? 'claim' : w.row.enrolled ? 'spend' : '';
  return html`<div class="strip ${cls}">
    <div aria-label="Wallet #${w.row.idx}">#${w.row.idx}</div>
    <div><span class="k">Address</span><a class="v addr" href="${accountLink(d.network, w.row.address)}" target="_blank" rel="noreferrer">${w.row.address}</a></div>
    <div><span class="k">Balance</span><span class="v">${w.balance === null ? 'unavailable' : `${w.balance} FLOP`}</span></div>
    <div><span class="k">Next claim</span><span class="v">${w.row.claimer ? w.nextClaim.text : 'not a claiming wallet'}</span></div>
    <div><span class="k">Agent</span><span class="v">${w.row.stopped ? 'stopped' : w.row.enrolled ? 'enrolled' : 'not enrolled yet'}</span></div>
  </div>`;
}

function headline(d: Data): { title: string; sub: string } {
  if (d.config.killed) return { title: 'The autopilot is stopped.', sub: 'Turn it back on with: npm run autopilot:on' };
  if (d.runtimeBlocked) return { title: 'FLOP upgraded the chain. Run npm run update.', sub: 'Claims and spends wait until flop-pilot supports the new chain version.' };
  const ready = d.wallets.filter((w) => w.row.claimer && w.nextClaim.ready);
  if (ready.length) return { title: `Wallet #${ready[0].row.idx} can claim now.`, sub: 'The autopilot claims on its next run, about every 15 minutes.' };
  const next = d.wallets.filter((w) => w.row.claimer && w.nextClaim.at).sort((a, b) => a.nextClaim.at!.getTime() - b.nextClaim.at!.getTime())[0];
  if (next) return { title: `Next claim ${relTime(next.nextClaim.at!, d.now)}, wallet #${next.row.idx}.`, sub: `Mode: ${d.mode === 'earning' ? 'earning vouchers' : 'standby (earning has not started yet)'}.` };
  return { title: d.mode === 'earning' ? 'Earning is on.' : 'Standing by.', sub: `Mode: ${d.mode === 'earning' ? 'earning vouchers' : 'standby (earning has not started yet)'}.` };
}

function alertsBlock(d: Data): Safe {
  if (!d.alerts.length) return html`<p class="empty">No open alerts.</p>`;
  return html`${d.alerts.slice(0, 8).map((a) => html`<div class="alert ${/unsupported|report|locked|shared/.test(a.kind) ? 'bad' : ''}" role="status"><strong>${when(a.ts)}</strong><br>${a.message}
    <form class="inline" method="post" action="/api/alerts/${a.id}/ack" data-post><button class="quiet" type="submit">Dismiss</button></form></div>`)}`;
}

export function overview(d: Data, autopilotOn: boolean | null): string {
  const h = headline(d);
  const body = html`<p class="status">${h.title}</p><p class="sub">${h.sub}</p>
  <section aria-labelledby="rack"><h2 id="rack">Wallets</h2><div class="rack">${d.wallets.map((w) => strip(d, w))}</div></section>
  <div class="cols"><section><h2>Last 24 hours</h2><dl class="facts">
    <dt>Mode</dt><dd>${d.mode === 'earning' ? 'earning vouchers' : 'standby: voucher earning has not started yet'}</dd>
    <dt>Claimed</dt><dd>${fmt(d.claimed24)} FLOP</dd>
    <dt>Spent on inference</dt><dd>${fmt(d.spent24)} FLOP</dd>
    <dt>Faucet pool left today</dt><dd>${d.limits ? `${d.limits.remainingFlop.toLocaleString('en-US')} FLOP` : 'not checked yet'}</dd>
    <dt>Pool refills around</dt><dd>${d.poolResetAt ? hhmmUtc(d.poolResetAt) : 'not observed yet'}</dd>
    <dt>Last autopilot run</dt><dd>${d.lastTick ? when(d.lastTick.started) : 'never'}</dd>
  </dl></section><section><h2>Alerts</h2>${alertsBlock(d)}</section></div>`;
  return layout(d, '/', 'Overview', body, autopilotOn);
}

function bars(s: { days: string[]; claimed: number[]; spent: number[] }): Safe {
  const max = Math.max(1, ...s.claimed, ...s.spent);
  const W = 600, H = 90, bw = W / s.days.length;
  const rects = s.days.map((day, i) => {
    const ch = (s.claimed[i] / max) * (H - 10), sh = (s.spent[i] / max) * (H - 10);
    return html`<rect class="c" x="${(i * bw + 1).toFixed(1)}" y="${(H - ch).toFixed(1)}" width="${(bw / 2 - 1).toFixed(1)}" height="${ch.toFixed(1)}"><title>${day}: claimed ${s.claimed[i]} FLOP</title></rect><rect class="s" x="${(i * bw + bw / 2).toFixed(1)}" y="${(H - sh).toFixed(1)}" width="${(bw / 2 - 1).toFixed(1)}" height="${sh.toFixed(1)}"><title>${day}: spent ${s.spent[i]} FLOP</title></rect>`;
  });
  return html`<svg class="bars" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Claimed (amber) and spent (blue) FLOP per day, last 30 days">${rects}</svg>`;
}

export function walletsPage(d: Data, seriesOf: (idx: number) => { days: string[]; claimed: number[]; spent: number[] }, autopilotOn: boolean | null): string {
  const body = html`<p class="sub">Each wallet comes from your one seed phrase. Amber bars are faucet claims, blue bars are inference purchases, for the last 30 days.</p>
  ${d.wallets.map((w) => html`<section><h2>Wallet #${w.row.idx}</h2><div class="rack">${strip(d, w)}</div>
    <dl class="facts"><dt>Claimed so far</dt><dd>${fmt(w.claimed)} FLOP</dd><dt>Spent so far</dt><dd>${fmt(w.spent)} FLOP</dd>
    <dt>Last claim</dt><dd>${when(w.lastClaim)}</dd><dt>Last purchase</dt><dd>${when(w.lastSpend)}</dd>
    <dt>Claims from faucet</dt><dd>${w.row.claimer ? 'yes' : 'no'}</dd></dl>${bars(seriesOf(w.row.idx))}</section>`)}`;
  return layout(d, '/wallets', 'Wallets', body, autopilotOn);
}

const statusPill = (s: string) => html`<span class="pill ${/final|settled|accepted|settlement/.test(s) ? 'ok' : /refused|failed|unconfirmed/.test(s) ? 'bad' : 'warn'}">${s.replace(/_/g, ' ')}</span>`;

export function activityPage(d: Data, rows: ActivityRow[], f: { type?: string; index?: number }, autopilotOn: boolean | null): string {
  const n: Network = d.network;
  const sel = (v: string | undefined, x: string) => raw(v === x ? 'selected' : '');
  const body = html`<form method="get" action="/activity" class="filters" data-autosubmit>
    <label>Show <select name="type"><option value="">claims and purchases</option><option value="claim" ${sel(f.type, 'claim')}>claims</option><option value="spend" ${sel(f.type, 'spend')}>purchases</option></select></label>
    <label>Wallet <select name="wallet"><option value="">all</option>${d.wallets.map((w) => html`<option value="${w.row.idx}" ${sel(String(f.index), String(w.row.idx))}>#${w.row.idx}</option>`)}</select></label>
    <button class="quiet" type="submit">Apply</button></form>
  ${rows.length ? html`<div class="scroll"><table><thead><tr><th>Time</th><th>Wallet</th><th>What</th><th>Amount</th><th>Status</th><th>Miner</th><th>Transaction</th><th>Origin IP</th><th>Reason</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td>${when(r.ts)}</td><td>#${r.wallet_idx}</td><td>${r.type === 'claim' ? 'Faucet claim' : 'Inference purchase'}</td>
      <td>${r.amount ? `${fmt(BigInt(r.amount))} FLOP` : ''}</td><td>${statusPill(r.status)}</td><td>${r.miner ?? ''}</td>
      <td>${r.ref ? (r.type === 'claim' ? html`<a href="${txLink(n, r.ref)}" target="_blank" rel="noreferrer">${r.ref.slice(0, 12)}…</a>` : r.ref.slice(0, 14) + '…') : ''}</td>
      <td>${r.public_ip ?? 'unknown'}</td><td>${r.reason ?? ''}</td></tr>`)}</tbody></table></div>`
    : html`<p class="empty">Nothing here yet. Claims and purchases appear after the autopilot's first run.</p>`}`;
  return layout(d, '/activity', 'Activity', body, autopilotOn);
}

function outputSnippet(path: string | null): string {
  if (!path) return '';
  try { const t = readFileSync(path, 'utf8'); const i = t.indexOf('## Output'); return (i >= 0 ? t.slice(i + 9) : t).trim().slice(0, 400); } catch { return 'output file not found'; }
}

export function spendingPage(d: Data, spends: SpendRow[], miners: { address: string; url: string | null; result: string }[], queued: string[], autopilotOn: boolean | null): string {
  const body = html`<p class="sub">The autopilot only buys inference from miners that are not linked to your wallets, and only from miners whose endpoint you added.</p>
  <h2>Miners</h2>${miners.length ? html`<div class="scroll"><table><thead><tr><th>Miner</th><th>Endpoint</th><th>Independent?</th></tr></thead><tbody>
    ${miners.map((m) => html`<tr><td>${m.address}</td><td>${m.url ?? 'none: add it on the Controls page'}</td><td>${statusPill(m.result === 'independent' ? 'independent' : m.result.replace('_', ' '))}</td></tr>`)}</tbody></table></div>`
    : html`<p class="empty">No miners found yet. Miners publish their endpoint address; add one on the Controls page.</p>`}
  <h2>Recent purchases</h2>${spends.length ? html`<div class="scroll"><table><thead><tr><th>Time</th><th>Wallet</th><th>Amount</th><th>Status</th><th>Score</th><th>Answer</th></tr></thead><tbody>
    ${spends.map((s) => html`<tr><td>${when(s.ts)}</td><td>#${s.wallet_idx}</td><td>${fmt(BigInt(s.escrow))} FLOP</td><td>${statusPill(s.status)}</td><td>${s.score === null ? '' : `${Math.round(s.score * 100)}%`}</td><td><pre>${outputSnippet(s.output_path)}</pre></td></tr>`)}</tbody></table></div>`
    : html`<p class="empty">No purchases yet.</p>`}
  <h2>Your task queue</h2><p class="sub">Put .txt or .md files in ~/.flop-pilot/tasks and the autopilot sends them to miners instead of the built-in practice questions.</p>
  ${queued.length ? html`<ul>${queued.map((q) => html`<li>${q}</li>`)}</ul>` : html`<p class="empty">Queue is empty, so the built-in questions are used.</p>`}`;
  return layout(d, '/spending', 'Spending', body, autopilotOn);
}

export function rulesPage(d: Data, diffs: { url: string; diff: string | null; checked: string | null }[], autopilotOn: boolean | null): string {
  const ab = d.config.activationBlock[d.network];
  const body = html`<p class="sub">FLOP's rules are marked provisional. flop-pilot checks the rules pages daily and the timeline pages hourly, and alerts you when they change.</p>
  <h2>Alerts</h2>${alertsBlock(d)}
  <h2>When earning starts</h2><p>${ab ? `Earning starts at block ${ab} on ${d.network}.` : 'No start block entered yet. When FLOP announces it, enter it here.'}</p>
  <form method="post" action="/api/activation" data-post><label>Start block <input name="block" inputmode="numeric" pattern="[0-9]*" value="${ab ?? ''}"></label> <button type="submit">Save start block</button></form>
  <h2>Watched pages</h2>${diffs.map((x) => html`<section><p><a href="${x.url}" target="_blank" rel="noreferrer">${x.url}</a><br><span class="why">Last checked ${when(x.checked)}</span></p>${x.diff ? html`<pre>${x.diff}</pre>` : html`<p class="why">No changes seen yet.</p>`}</section>`)}`;
  return layout(d, '/rules', 'Rules and alerts', body, autopilotOn);
}

export const WATCHED = [...RULES_PAGES, ...ACTIVATION_PAGES];
