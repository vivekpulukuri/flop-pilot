import { test, expect } from 'vitest';
import { macKeychain, type ExecFileFn } from '../../src/keys/keychain.js';
import { VaultLockedError } from '../../src/keys/vault.js';

function recorder(result: { code: number; stdout?: string } = { code: 0, stdout: '' }) {
  const calls: { file: string; args: string[] }[] = [];
  const exec: ExecFileFn = async (file, args) => {
    calls.push({ file, args });
    if (result.code !== 0) throw Object.assign(new Error('security failed'), { code: result.code });
    return { stdout: result.stdout ?? '' };
  };
  return { calls, exec };
}

test('set passes args as an array to the security binary (no shell)', async () => {
  const r = recorder();
  await macKeychain(r.exec).set('p$w;rm -rf /');
  expect(r.calls[0].file).toBe('/usr/bin/security');
  expect(r.calls[0].args).toEqual(['add-generic-password', '-U', '-s', 'flop-pilot', '-a', 'vault', '-w', 'p$w;rm -rf /']);
});

test('get trims the trailing newline from find-generic-password -w', async () => {
  const r = recorder({ code: 0, stdout: 'secretpw\n' });
  expect(await macKeychain(r.exec).get()).toBe('secretpw');
  expect(r.calls[0].args).toEqual(['find-generic-password', '-s', 'flop-pilot', '-a', 'vault', '-w']);
});

test('get maps item-not-found (exit 44) to null', async () => {
  const r = recorder({ code: 44 });
  expect(await macKeychain(r.exec).get()).toBeNull();
});

test('other failures map to VaultLockedError', async () => {
  const r = recorder({ code: 51 });
  await expect(macKeychain(r.exec).get()).rejects.toBeInstanceOf(VaultLockedError);
  await expect(macKeychain(r.exec).set('x')).rejects.toBeInstanceOf(VaultLockedError);
});
