import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SecretStore } from '../core/types.js';
import { paths } from '../core/paths.js';
import { VaultLockedError } from '../keys/vault.js';
import { keychainAccount, macKeychain } from '../keys/keychain.js';
import { hasCommand as realHasCommand, type ExecFn } from '../sys/exec.js';

export type Plat = 'darwin' | 'win32' | 'linux';
export type StoreKind = 'keychain' | 'dpapi' | 'secret-service' | 'key-file' | 'passphrase';
export type KindedStore = SecretStore & { kind: StoreKind; weak: boolean };

export const currentPlat = (): Plat => (process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux');

const PS = ['-NoProfile', '-NonInteractive', '-Command'];
const PROTECT = "Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($env:FP_SECRET), $null, 'CurrentUser'))";
const UNPROTECT = "Add-Type -AssemblyName System.Security; [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:FP_BLOB), $null, 'CurrentUser'))";

/** Windows: DPAPI (per-user encryption built into Windows) via PowerShell; the secret travels in env vars only. */
export function dpapiStore(home: string, exec: ExecFn): KindedStore {
  const file = join(paths(home).root, 'vault.key.dpapi');
  return {
    kind: 'dpapi', weak: false,
    async get() {
      if (!existsSync(file)) return null;
      try { return (await exec('powershell.exe', [...PS, UNPROTECT], { env: { FP_BLOB: readFileSync(file, 'utf8').trim() } })).stdout.replace(/\r?\n$/, ''); }
      catch { throw new VaultLockedError('Windows could not decrypt the vault password (DPAPI). Are you logged in as the same Windows user?'); }
    },
    async set(pw) {
      let blob: string;
      try { blob = (await exec('powershell.exe', [...PS, PROTECT], { env: { FP_SECRET: pw } })).stdout.trim(); }
      catch { throw new VaultLockedError('Windows could not protect the vault password (DPAPI).'); }
      writeFileSync(file, blob + '\n', { mode: 0o600 });
    },
    async remove() { rmSync(file, { force: true }); },
  };
}

/** Linux desktop: Secret Service keyring via `secret-tool`; the secret goes through stdin. */
export function secretToolStore(account: string, exec: ExecFn): KindedStore {
  const attrs = ['service', 'flop-pilot', 'account', account];
  return {
    kind: 'secret-service', weak: false,
    async get() {
      try { return (await exec('secret-tool', ['lookup', ...attrs])).stdout.replace(/\n$/, '') || null; }
      catch (e) { if ((e as { code?: number }).code === 1) return null; throw new VaultLockedError('The desktop keyring is locked or unavailable.'); }
    },
    async set(pw) {
      try { await exec('secret-tool', ['store', '--label=FLOP Pilot vault', ...attrs], { input: pw }); }
      catch { throw new VaultLockedError('Could not save the vault password to the desktop keyring.'); }
    },
    async remove() { try { await exec('secret-tool', ['clear', ...attrs]); } catch { /* already gone */ } },
  };
}

/** Linux server fallback (owner-approved): a key file only this user can read. Weaker: anyone with the account can read it. */
export function keyFileStore(home: string): KindedStore {
  const file = join(paths(home).root, 'vault.key');
  return {
    kind: 'key-file', weak: true,
    async get() { return existsSync(file) ? readFileSync(file, 'utf8').trim() || null : null; },
    async set(pw) { writeFileSync(file, pw + '\n', { mode: 0o600 }); },
    async remove() { rmSync(file, { force: true }); },
  };
}

export function secretStoreFor(home: string, o: { plat: Plat; exec: ExecFn; env: NodeJS.ProcessEnv; hasCommand?: (c: string) => boolean }): KindedStore {
  if (o.plat === 'darwin') return Object.assign(macKeychain(o.exec, keychainAccount(home)), { kind: 'keychain' as const, weak: false });
  if (o.plat === 'win32') return dpapiStore(home, o.exec);
  const has = o.hasCommand ?? ((c: string) => realHasCommand(c, o.env));
  if (o.env.DBUS_SESSION_BUS_ADDRESS && has('secret-tool')) return secretToolStore(keychainAccount(home), o.exec);
  return keyFileStore(home);
}
