import type { Network, SecretStore } from '../core/types.js';
import { NETWORKS } from '../core/types.js';
import { loadConfig, updateConfig } from '../core/config.js';
import { paths } from '../core/paths.js';
import { openLedger } from '../ledger/ledger.js';
import { unlockSeed } from '../keys/vault.js';
import { deriveWallets } from '../keys/derive.js';
import { WALLET_COUNT } from './init.js';

export function setPractice(home: string, on: boolean): void {
  updateConfig(home, { practice: on });
}

export function setClaimers(home: string, k: number): void {
  if (!Number.isInteger(k) || k < 1 || k > 3) {
    throw new Error('The faucet allows 3 claims per internet connection per day, so choose 1, 2 or 3 claiming wallets.');
  }
  const c = updateConfig(home, { claimers: k as 1 | 2 | 3 });
  const l = openLedger(paths(home).ledger);
  try {
    for (const w of l.listWallets(c.network)) l.setWalletFlags(c.network, w.idx, { claimer: w.idx < k });
  } finally {
    l.close();
  }
}

export async function setNetwork(home: string, n: Network, store: SecretStore): Promise<void> {
  if (!NETWORKS.includes(n)) throw new Error(`Unknown network "${n}". Use devnet or testnet.`);
  const c = loadConfig(home);
  const l = openLedger(paths(home).ledger);
  try {
    if (l.listWallets(n).length < WALLET_COUNT) {
      const seed = await unlockSeed(home, store);
      for (const w of await deriveWallets(seed, n, WALLET_COUNT)) {
        l.upsertWallet({ network: n, index: w.index, address: w.address, claimer: w.index < c.claimers });
      }
    }
  } finally {
    l.close();
  }
  updateConfig(home, { network: n });
}
