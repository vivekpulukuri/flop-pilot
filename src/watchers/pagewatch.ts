import { createHash } from 'node:crypto';
import { diffLines } from 'diff';
import { alert, type Ctx } from '../core/ctx.js';

export const ACTIVATION_PAGES = [
  'https://docs.flop.network/networks/testnet',
  'https://docs.flop.network/docs/testnet-and-timeline?network=testnet',
];
export const RULES_PAGES = ['https://flop.finance/testnet/', 'https://flop.finance/airdrop/'];
const HOUR = 3600_000;
const INTERVAL: Record<'activation' | 'rules', number> = { activation: HOUR, rules: 24 * HOUR };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

/** Visible text of a page, one line per block element, so markup churn does not count as a change. */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|table|ul|ol)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (m, e: string) => {
      if (ENTITIES[e.toLowerCase()]) return ENTITIES[e.toLowerCase()];
      if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (/^#\d+$/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
      return m;
    })
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

function textDiff(a: string, b: string): string {
  return diffLines(a + '\n', b + '\n')
    .filter((p) => p.added || p.removed)
    .map((p) => p.value.trimEnd().split('\n').map((l) => `${p.added ? '+' : '-'} ${l}`).join('\n'))
    .join('\n');
}

export async function checkPage(ctx: Ctx, url: string, kind: 'activation' | 'rules'): Promise<{ changed: boolean; diff?: string; error?: string }> {
  let text: string;
  try {
    const res = await ctx.env.fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = pageText(await res.text());
  } catch (e) {
    return { changed: false, error: `watch ${url}: ${(e as Error).message}` };
  } finally {
    ctx.ledger.setState(`watch:lastChecked:${url}`, ctx.env.now().toISOString());
  }
  const hash = createHash('sha256').update(text).digest('hex');
  const last = ctx.ledger.lastSnapshot(url);
  if (!last) { ctx.ledger.insertSnapshot(url, hash, text, ctx.env.now().toISOString()); return { changed: false }; }
  if (last.hash === hash) return { changed: false };
  const diff = textDiff(last.text, text);
  ctx.ledger.insertSnapshot(url, hash, text, ctx.env.now().toISOString());
  ctx.ledger.setState(`watch:diff:${url}`, diff);
  const msg = kind === 'activation'
    ? `FLOP's testnet timeline page changed. The earning start block may be announced: check ${url}, then enter the block on the dashboard or run: npm run activation -- <block>`
    : `FLOP's program rules page changed (${url}). Review the changes on the Rules & alerts page.`;
  await alert(ctx, kind === 'activation' ? 'activation_page' : 'rules_changed', msg, `${url}#${hash}`);
  return { changed: true, diff };
}

/** Runs the watchers that are due; returns error strings for the tick summary. */
export async function runWatchers(ctx: Ctx): Promise<string[]> {
  const errors: string[] = [];
  const now = ctx.env.now().getTime();
  for (const [kind, urls] of [['activation', ACTIVATION_PAGES], ['rules', RULES_PAGES]] as const) {
    for (const url of urls) {
      const last = ctx.ledger.getState<string>(`watch:lastChecked:${url}`);
      if (last && now - new Date(last).getTime() < INTERVAL[kind]) continue;
      const r = await checkPage(ctx, url, kind);
      if (r.error) errors.push(r.error);
    }
  }
  return errors;
}
