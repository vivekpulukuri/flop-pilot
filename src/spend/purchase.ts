import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChainPort, InferenceIntent, MinerDirectory, MinerInfo } from '../core/types.js';
import { alert, type ActionResult, type Ctx } from '../core/ctx.js';
import { paths } from '../core/paths.js';
import { fromPlanck, toPlanck } from '../core/units.js';
import type { SpendRow } from '../ledger/ledger.js';
import type { Wallet } from '../keys/derive.js';
import { eligibleMiners } from './independence.js';
import { planSessions } from './budget.js';
import { completeTask, nextTask, scoreOutput, type Task } from './tasks.js';

const DAY = 86400_000;
interface IntentFile { intent: InferenceIntent; wallet: number; miner: string; minerUrl: string; escrow: string; task: Task; }

const isUnconfirmed = (e: unknown) => {
  const err = e as { code?: string; message?: string };
  return err?.code === 'INFERENCE_PURCHASE_UNCONFIRMED' || /INFERENCE_PURCHASE_UNCONFIRMED/.test(err?.message ?? '');
};

function intentPath(ctx: Ctx, id: string) { return join(paths(ctx.home).intents, `${id}.json`); }

function ceilingLeft(ctx: Ctx): bigint {
  const since = new Date(ctx.env.now().getTime() - DAY);
  const used = ctx.ledger.spendsSince(ctx.network, since).filter((s) => s.status !== 'failed').reduce((a, s) => a + BigInt(s.escrow), 0n);
  const left = toPlanck(ctx.config.dailySpendCeilingFlop) - used;
  return left > 0n ? left : 0n;
}

async function finishBuy(ctx: Ctx, row: SpendRow, f: IntentFile, w: Wallet, chain: ChainPort): Promise<ActionResult> {
  const base = { wallet: w.index, action: 'spend' as const };
  try {
    const r = await chain.buyInference(w.pair, { intent: f.intent, prompt: f.task.prompt });
    const outPath = join(paths(ctx.home).outputs, `${ctx.env.now().toISOString().replace(/[:.]/g, '-')}-${f.intent.id}.md`);
    writeFileSync(outPath, `# ${f.task.id}\n\nMiner: ${f.miner}\nChannel: ${r.channelId}\n\n## Prompt\n\n${f.task.prompt}\n\n## Output\n\n${r.output}\n`, { mode: 0o600 });
    const score = scoreOutput(f.task, r.output);
    ctx.ledger.updateSpend(row.id, { status: 'settlement_posted', channel_id: r.channelId, gn_used: r.gnUsed.toString(), score, output_path: outPath, error: null });
    completeTask(ctx.home, f.task);
    return { ...base, kind: 'done', detail: `bought inference for ${fromPlanck(BigInt(f.escrow))} FLOP from miner ${f.miner} (channel ${r.channelId})` };
  } catch (e) {
    if (isUnconfirmed(e)) {
      ctx.ledger.updateSpend(row.id, { status: 'unconfirmed', error: (e as Error).message });
      await alert(ctx, 'purchase_unconfirmed', `A purchase from wallet #${w.index} could not be confirmed. It will not be repeated; check the Spending page.`, `unconfirmed:${row.intent_id}`);
      return { ...base, kind: 'failed', reason: 'unconfirmed', detail: `wallet #${w.index}: purchase unconfirmed; not retried` };
    }
    ctx.ledger.updateSpend(row.id, { error: (e as Error).message });
    return { ...base, kind: 'failed', reason: 'buy_failed', detail: `wallet #${w.index}: purchase interrupted (${(e as Error).message}); resumes next run with the same intent` };
  }
}

export async function purchaseOne(ctx: Ctx, w: Wallet, miner: MinerInfo & { url: string }, escrow: bigint, task: Task, chain: ChainPort): Promise<ActionResult> {
  let intent: InferenceIntent;
  try {
    intent = await chain.prepareInference(w.pair, { minerUrl: miner.url, escrowFlop: Number(fromPlanck(escrow, 6)) });
  } catch (e) {
    return { wallet: w.index, action: 'spend', kind: 'failed', reason: 'prepare_failed', detail: `wallet #${w.index}: could not prepare a session with ${miner.address} (${(e as Error).message})` };
  }
  const f: IntentFile = { intent, wallet: w.index, miner: miner.address, minerUrl: miner.url, escrow: escrow.toString(), task };
  // Persist the secret intent before buying; never prepare twice for one purchase.
  writeFileSync(intentPath(ctx, intent.id), JSON.stringify(f), { mode: 0o600, flag: 'wx' });
  const id = ctx.ledger.insertSpend({
    network: ctx.network, wallet_idx: w.index, intent_id: intent.id, miner: miner.address, miner_url: miner.url,
    independence: 'independent', escrow: escrow.toString(), status: 'prepared', task_id: task.id,
    public_ip: await ctx.env.publicIp(), mode: ctx.mode ?? 'standby', ts: ctx.env.now().toISOString(),
  });
  const row = ctx.ledger.spendsByStatus(ctx.network, ['prepared']).find((s) => s.id === id)!;
  return finishBuy(ctx, row, f, w, chain);
}

const REASONS: [string, string, string][] = [
  ['no_endpoint', 'has no endpoint added yet', 'have no endpoint added yet'],
  ['unverified', 'could not be checked for independence', 'could not be checked for independence'],
  ['own_address', 'is one of your own wallets', 'are your own wallets'],
  ['declared_own', 'is on your own-miners list', 'are on your own-miners list'],
  ['linked', 'is linked to your wallets', 'are linked to your wallets'],
];

function noMinerText(found: number, ranked: { miner: MinerInfo; result: string }[]): string {
  if (!found) return 'no miner to buy from yet. No miners found on this network. Add a miner endpoint on the Controls page.';
  const counts = new Map<string, number>();
  for (const r of ranked) { const k = r.result === 'independent' && !r.miner.url ? 'no_endpoint' : r.result; counts.set(k, (counts.get(k) ?? 0) + 1); }
  const parts = REASONS.filter(([k]) => counts.get(k)).map(([k, one, many]) => `${counts.get(k)} ${counts.get(k) === 1 ? one : many}`);
  return `no miner to buy from yet. ${found} miner${found === 1 ? '' : 's'} found: ${parts.join(', ')}. Add a miner endpoint on the Controls page.`;
}

export async function spendWallet(ctx: Ctx, w: Wallet, ports: { chain: ChainPort; miners: MinerDirectory }): Promise<ActionResult[]> {
  const base = { wallet: w.index, action: 'spend' as const };
  const row = ctx.ledger.listWallets(ctx.network).find((r) => r.idx === w.index);
  if (!row?.enrolled) return [{ ...base, kind: 'skipped', reason: 'not_enrolled', detail: `wallet #${w.index} is not enrolled yet` }];
  if (ctx.ledger.claimsForWallet(ctx.network, w.index).some((c) => c.status === 'accepted' || c.status === 'pending' || c.status === 'unknown')) {
    return [{ ...base, kind: 'skipped', reason: 'claim_not_final', detail: `wallet #${w.index}: waiting for its faucet grant to finalize` }];
  }
  const sessions = planSessions(
    await ports.chain.finalizedFreeBalance(w.address), toPlanck(ctx.config.feeReserveFlop), toPlanck(ctx.config.perTxLimitFlop),
    toPlanck(ctx.config.minEscrowFlop), ceilingLeft(ctx),
  );
  if (!sessions.length) return [{ ...base, kind: 'skipped', reason: 'nothing_to_spend', detail: `wallet #${w.index}: nothing to spend (balance at reserve or daily ceiling reached)` }];

  const own = new Set(ctx.ledger.listWallets(ctx.network).map((r) => r.address));
  const listed = await ports.miners.list();
  const ranked = eligibleMiners(listed, own, new Set(ctx.config.myMiners));
  const usable = ranked.filter((r) => r.result === 'independent' && r.miner.url).map((r) => r.miner as MinerInfo & { url: string });
  if (!usable.length) {
    return [{ ...base, kind: 'skipped', reason: 'no_independent_miner', detail: `wallet #${w.index}: ${noMinerText(listed.length, ranked)}` }];
  }
  const out: ActionResult[] = [];
  for (const [i, escrow] of sessions.entries()) {
    const miner = usable[i % usable.length];
    if (ctx.config.practice) { out.push({ ...base, kind: 'simulated', detail: `would spend ${fromPlanck(escrow)} FLOP to miner ${miner.address} from wallet #${w.index}` }); continue; }
    const r = await purchaseOne(ctx, w, miner, escrow, nextTask(ctx.home, ctx.ledger), ports.chain);
    out.push(r);
    if (r.kind === 'failed') break;
  }
  return out;
}

export async function resumeSpends(ctx: Ctx, wallets: Wallet[], chain: ChainPort): Promise<ActionResult[]> {
  const out: ActionResult[] = [];
  const byIdx = new Map(wallets.map((w) => [w.index, w]));
  for (const row of ctx.ledger.spendsByStatus(ctx.network, ['prepared'])) {
    const w = byIdx.get(row.wallet_idx);
    const file = intentPath(ctx, row.intent_id);
    if (!w) continue;
    if (!existsSync(file)) { ctx.ledger.updateSpend(row.id, { status: 'failed', error: 'intent file missing' }); continue; }
    out.push(await finishBuy(ctx, row, JSON.parse(readFileSync(file, 'utf8')) as IntentFile, w, chain));
  }
  for (const row of ctx.ledger.spendsByStatus(ctx.network, ['settlement_posted', 'unconfirmed'])) {
    if (!row.channel_id) continue;
    const s = await chain.channelStatus(row.channel_id);
    if (s === 'settled' || s === 'refunded') {
      ctx.ledger.updateSpend(row.id, { status: s });
      rmSync(intentPath(ctx, row.intent_id), { force: true });
    }
  }
  return out;
}
