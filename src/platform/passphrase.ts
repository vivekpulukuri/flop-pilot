import { renameSync, writeFileSync } from 'node:fs';
import { loadConfig, updateConfig } from '../core/config.js';
import { paths } from '../core/paths.js';
import type { SecretStore } from '../core/types.js';
import { encryptSeed, newVaultPassword, unlockSeed, VaultLockedError } from '../keys/vault.js';
import { MIN_PASSPHRASE, type PromptIO } from '../commands/init.js';
import { realExec } from '../sys/exec.js';
import { currentPlat, secretStoreFor, type KindedStore } from './secrets.js';

/**
 * Passphrase mode: nothing is stored; the owner types the passphrase they wrote on paper.
 * Asked once per run and kept in memory only. Without a terminal (background job) it refuses.
 */
export function passphraseStore(ask: (() => Promise<string>) | null): KindedStore {
  let cached: string | null = null;
  return {
    kind: 'passphrase', weak: false,
    async get() {
      if (cached) return cached;
      if (!ask) throw new VaultLockedError('Passphrase mode: there is no window to type the passphrase in. Start the autopilot with: npm run autopilot:run');
      cached = await ask();
      return cached;
    },
    async set() { /* never stored */ },
    async remove() { cached = null; },
  };
}

/** The store for this install: the passphrase prompt in passphrase mode, else the OS secret store. */
export function storeFor(home: string, o: { ask: (() => Promise<string>) | null }): KindedStore {
  if (loadConfig(home).unlock === 'passphrase') return passphraseStore(o.ask);
  return secretStoreFor(home, { plat: currentPlat(), exec: realExec, env: process.env });
}

/** Re-encrypts the vault for the new unlock mode. `current` unlocks the vault today; `auto` is the OS store. */
export async function setUnlockMode(home: string, mode: 'auto' | 'passphrase', o: { current: SecretStore; auto: SecretStore; io: PromptIO }): Promise<void> {
  if (loadConfig(home).unlock === mode) throw new Error(`Already using ${mode === 'auto' ? 'automatic unlock' : 'a passphrase'}.`);
  const seed = await unlockSeed(home, o.current);
  let pw: string;
  if (mode === 'passphrase') {
    const ask = o.io.askSecret ?? o.io.ask;
    const p1 = await ask(`Choose a passphrase (at least ${MIN_PASSPHRASE} characters): `);
    if (p1.length < MIN_PASSPHRASE) throw new Error(`Too short: use at least ${MIN_PASSPHRASE} characters. Nothing changed.`);
    if (p1 !== (await ask('Type the same passphrase again: '))) throw new Error("The two didn't match. Nothing changed.");
    pw = p1;
  } else {
    pw = newVaultPassword();
    await o.auto.set(pw);
  }
  const file = paths(home).vault;
  writeFileSync(`${file}.new`, JSON.stringify(encryptSeed(seed, pw)) + '\n', { mode: 0o600 });
  renameSync(`${file}.new`, file);
  if (mode === 'passphrase') {
    await o.auto.remove();
    o.io.print('Write this passphrase on paper, next to your 24 words. It is not saved on this computer.');
  }
  updateConfig(home, { unlock: mode });
}
