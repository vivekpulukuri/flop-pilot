import { existsSync } from 'node:fs';
import { mnemonicGenerate, mnemonicValidate, cryptoWaitReady } from '@polkadot/util-crypto';
import type { Network, SecretStore } from '../core/types.js';
import { ensureDirs, paths } from '../core/paths.js';
import { loadConfig, saveConfig } from '../core/config.js';
import { encryptSeed, newVaultPassword, writeVault } from '../keys/vault.js';
import { deriveWallets } from '../keys/derive.js';
import { openLedger } from '../ledger/ledger.js';

export interface PromptIO {
  print(s: string): void;
  ask(q: string): Promise<string>;
  clear(): void;
}

export const WALLET_COUNT = 3;
const CONFIRM_WORDS = 3;
const MAX_ATTEMPTS = 3;

function pickPositions(rng: () => number, k: number): number[] {
  const pos = Array.from({ length: 24 }, (_, i) => i + 1);
  for (let i = pos.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pos[i], pos[j]] = [pos[j], pos[i]];
  }
  return pos.slice(0, k).sort((a, b) => a - b);
}

function grid(words: string[]): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    rows.push([0, 8, 16].map((c) => `${String(r + c + 1).padStart(2)}. ${words[r + c].padEnd(10)}`).join('   '));
  }
  return rows.join('\n');
}

export async function runInit(o: { home: string; network: Network; restore: boolean; io: PromptIO; store: SecretStore; rng?: () => number }): Promise<void> {
  const { home, io } = o;
  const rng = o.rng ?? Math.random;
  if (existsSync(paths(home).vault)) {
    throw new Error('flop-pilot is already set up on this Mac. To restore from your 24 words, use a fresh install with `init --restore`.');
  }
  await cryptoWaitReady();

  let seed: string;
  if (o.restore) {
    seed = (await io.ask('Type your 24 words, separated by spaces: ')).trim().toLowerCase().split(/\s+/).join(' ');
    if (seed.split(' ').length !== 24 || !mnemonicValidate(seed)) throw new Error('Those words are not a valid 24-word seed phrase. Nothing was saved.');
  } else {
    seed = mnemonicGenerate(24);
    const words = seed.split(' ');
    io.print('\nYour new seed phrase (24 words):\n');
    io.print(grid(words));
    io.print('\nWrite these 24 words on paper. Anyone with them controls your wallets. Never type them into a website.\n');
    await io.ask('Press Enter once you have written all 24 words down… ');
    io.clear();
    let ok = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      ok = true;
      for (const p of pickPositions(rng, CONFIRM_WORDS)) {
        const a = (await io.ask(`Word #${p}: `)).trim().toLowerCase();
        if (a !== words[p - 1]) { ok = false; break; }
      }
      if (!ok && attempt < MAX_ATTEMPTS) io.print("That didn't match your paper copy. Let's try again.");
    }
    if (!ok) throw new Error('The words did not match after 3 tries. Setup cancelled; nothing was saved. Run `flop-pilot init` again.');
  }

  ensureDirs(home);
  const pw = newVaultPassword();
  await o.store.set(pw);
  writeVault(paths(home).vault, encryptSeed(seed, pw));

  const config = { ...loadConfig(home), network: o.network, practice: true };
  saveConfig(home, config);

  const ledger = openLedger(paths(home).ledger);
  try {
    for (const w of await deriveWallets(seed, o.network, WALLET_COUNT)) {
      ledger.upsertWallet({ network: o.network, index: w.index, address: w.address, claimer: w.index < config.claimers });
    }
  } finally {
    ledger.close();
  }
  io.print(`Set up done. Network: ${o.network}. Practice mode is ON (nothing is signed or sent). Next: flop-pilot doctor`);
}
