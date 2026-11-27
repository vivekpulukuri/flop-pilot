import { renameSync, writeFileSync } from 'node:fs';
import { loadConfig, updateConfig } from '../core/config.js';
import { paths } from '../core/paths.js';
import type { Config, SecretStore } from '../core/types.js';
import { existsSync } from 'node:fs';
import { encryptSeed, newVaultPassword, readVault, unlockSeed, VaultLockedError } from '../keys/vault.js';
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
/** The unlock mode recorded in the vault itself (falls back to config for older vaults). */
export function vaultUnlockMode(home: string): 'auto' | 'passphrase' {
  try { if (existsSync(paths(home).vault)) { const m = readVault(paths(home).vault).unlock; if (m) return m; } } catch { /* unreadable: use config */ }
  return loadConfig(home).unlock ?? 'auto';
}

export function storeFor(home: string, o: { ask: (() => Promise<string>) | null }): KindedStore {
  if (vaultUnlockMode(home) === 'passphrase') return passphraseStore(o.ask);
  return secretStoreFor(home, { plat: currentPlat(), exec: realExec, env: process.env, kind: loadConfig(home).store });
}

/** Re-encrypts the vault for the new unlock mode. `current` unlocks the vault today; `auto` is the OS store. */
export async function setUnlockMode(home: string, mode: 'auto' | 'passphrase', o: { current: SecretStore; auto: SecretStore & { kind?: string }; io: PromptIO }): Promise<void> {
  if (vaultUnlockMode(home) === mode) throw new Error(`Already using ${mode === 'auto' ? 'automatic unlock' : 'a passphrase'}.`);
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
  // One atomic rename switches both the password and the recorded mode, so an interruption can't lock you out.
  writeFileSync(`${file}.new`, JSON.stringify(encryptSeed(seed, pw, mode)) + '\n', { mode: 0o600 });
  renameSync(`${file}.new`, file);
  updateConfig(home, { unlock: mode, store: mode === 'auto' ? ((o.auto.kind as Config['store']) ?? loadConfig(home).store) : loadConfig(home).store });
  if (mode === 'passphrase') {
    try { await o.auto.remove(); } catch { o.io.print('Note: the old stored password could not be deleted; it no longer opens anything.'); }
    o.io.print('Write this passphrase on paper, next to your 24 words. It is not saved on this computer.');
  }
}
