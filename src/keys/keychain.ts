import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { SecretStore } from '../core/types.js';
import { VaultLockedError } from './vault.js';

export type ExecFileFn = (file: string, args: string[]) => Promise<{ stdout: string }>;

const run = promisify(execFile);
const realExec: ExecFileFn = async (file, args) => {
  const { stdout } = await run(file, args, { encoding: 'utf8', timeout: 15000 });
  return { stdout };
};

const SECURITY = '/usr/bin/security';
const SERVICE = 'flop-pilot';
const DEFAULT_ACCOUNT = 'vault';

/** One Keychain item per data folder, so a test or second install never overwrites the real one. */
export function keychainAccount(home: string): string {
  if (resolve(home) === resolve(join(homedir(), '.flop-pilot'))) return DEFAULT_ACCOUNT;
  return `vault:${createHash('sha256').update(resolve(home)).digest('hex').slice(0, 12)}`;
}
const ITEM_NOT_FOUND = 44;

/**
 * macOS Keychain store for the vault password. Arguments go to execFile as an array, never through a shell.
 * Note: `-w <pw>` is briefly visible to local `ps`; acceptable for a single-user Mac and a random password.
 */
export function macKeychain(exec: ExecFileFn = realExec, account: string = DEFAULT_ACCOUNT): SecretStore {
  return {
    async get() {
      try {
        const { stdout } = await exec(SECURITY, ['find-generic-password', '-s', SERVICE, '-a', account, '-w']);
        return stdout.replace(/\n$/, '');
      } catch (e) {
        if ((e as { code?: number }).code === ITEM_NOT_FOUND) return null;
        throw new VaultLockedError();
      }
    },
    async set(pw) {
      try {
        await exec(SECURITY, ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', pw]);
      } catch {
        throw new VaultLockedError('Could not save the vault password to the macOS Keychain.');
      }
    },
    async remove() {
      try {
        await exec(SECURITY, ['delete-generic-password', '-s', SERVICE, '-a', account]);
      } catch (e) {
        if ((e as { code?: number }).code !== ITEM_NOT_FOUND) throw new VaultLockedError('Could not remove the Keychain item.');
      }
    },
  };
}
