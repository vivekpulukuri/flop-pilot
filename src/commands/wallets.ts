import type { ChainPort } from '../core/types.js';
import { loadConfig } from '../core/config.js';
import { paths } from '../core/paths.js';
import { fromPlanck } from '../core/units.js';
import { openLedger } from '../ledger/ledger.js';

export interface WalletLine { index: number; address: string; claimer: boolean; enrolled: boolean; stopped: boolean; balance: string | null; }

export async function listWalletsCmd(home: string, chain?: ChainPort): Promise<WalletLine[]> {
  const c = loadConfig(home);
  const l = openLedger(paths(home).ledger);
  try {
    const out: WalletLine[] = [];
    for (const w of l.listWallets(c.network)) {
      let balance: string | null = null;
      if (chain) { try { balance = fromPlanck(await chain.finalizedFreeBalance(w.address)); } catch { balance = null; } }
      out.push({ index: w.idx, address: w.address, claimer: w.claimer, enrolled: w.enrolled, stopped: w.stopped, balance });
    }
    return out;
  } finally {
    l.close();
  }
}
