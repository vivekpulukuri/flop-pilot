import { test, expect } from 'vitest';
import { mkdtempSync, statSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secretStoreFor, keyFileStore } from '../../src/platform/secrets.js';
import type { ExecFn } from '../../src/sys/exec.js';
import { ensureDirs } from '../../src/core/paths.js';

const home = () => { const h = join(mkdtempSync(join(tmpdir(), 'fpsec-')), 'h'); ensureDirs(h); return h; };
function rec(respond: (file: string, args: string[], o: { input?: string; env?: Record<string, string> }) => string | Error) {
  const calls: { file: string; args: string[]; input?: string; env?: Record<string, string> }[] = [];
  const exec: ExecFn = async (file, args, o = {}) => {
    calls.push({ file, args, input: o.input, env: o.env });
    const r = respond(file, args, o);
    if (r instanceof Error) throw r;
    return { stdout: r };
  };
  return { calls, exec };
}

test('macOS uses the Keychain store', () => {
  const s = secretStoreFor(home(), { plat: 'darwin', exec: rec(() => '').exec, env: {} });
  expect(s).toMatchObject({ kind: 'keychain', weak: false });
});

test('Windows DPAPI: secret goes in env FP_SECRET (never argv) and the blob is saved to vault.key.dpapi', async () => {
  const h = home();
  const r = rec((_f, _a, o) => (o.env?.FP_SECRET ? 'QkxPQg==\r\n' : o.env?.FP_BLOB === 'QkxPQg==' ? 'the-password\r\n' : ''));
  const s = secretStoreFor(h, { plat: 'win32', exec: r.exec, env: {} });
  expect(s.kind).toBe('dpapi');
  await s.set('the-password');
  expect(r.calls[0].file).toBe('powershell.exe');
  expect(r.calls[0].args.join(' ')).not.toContain('the-password');
  expect(r.calls[0].env?.FP_SECRET).toBe('the-password');
  expect(readFileSync(join(h, 'vault.key.dpapi'), 'utf8').trim()).toBe('QkxPQg==');
  expect(await s.get()).toBe('the-password');
  expect(r.calls[1].env?.FP_BLOB).toBe('QkxPQg==');
});

test('Windows DPAPI get with no blob file → null', async () => {
  expect(await secretStoreFor(home(), { plat: 'win32', exec: rec(() => '').exec, env: {} }).get()).toBeNull();
});

test('Linux desktop with a session bus and secret-tool → Secret Service, secret via stdin', async () => {
  const r = rec((_f, args) => (args[0] === 'lookup' ? 'pw-from-keyring\n' : ''));
  const s = secretStoreFor(home(), { plat: 'linux', exec: r.exec, env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', DISPLAY: ':0' }, hasCommand: () => true });
  expect(s.kind).toBe('secret-service');
  await s.set('s3');
  expect(r.calls[0]).toMatchObject({ file: 'secret-tool', input: 's3' });
  expect(r.calls[0].args).not.toContain('s3');
  expect(await s.get()).toBe('pw-from-keyring');
});

test('Secret Service lookup failure (no item) → null', async () => {
  const r = rec(() => Object.assign(new Error('no item'), { code: 1 }));
  const s = secretStoreFor(home(), { plat: 'linux', exec: r.exec, env: { DBUS_SESSION_BUS_ADDRESS: 'x' }, hasCommand: () => true });
  expect(await s.get()).toBeNull();
});

test('REVIEW-FOCUS-3: headless Linux (no D-Bus) → key file, marked weak, never calls secret-tool', async () => {
  const r = rec(() => '');
  const h = home();
  const s = secretStoreFor(h, { plat: 'linux', exec: r.exec, env: {}, hasCommand: () => true });
  expect(s).toMatchObject({ kind: 'key-file', weak: true });
  await s.set('pw');
  expect(r.calls).toHaveLength(0);
  expect(await s.get()).toBe('pw');
});

test('Linux desktop without secret-tool installed → key file', () => {
  const s = secretStoreFor(home(), { plat: 'linux', exec: rec(() => '').exec, env: { DBUS_SESSION_BUS_ADDRESS: 'x' }, hasCommand: () => false });
  expect(s.kind).toBe('key-file');
});

test.skipIf(process.platform === 'win32')('key file is written with mode 0600 and remove deletes it', async () => {
  const h = home();
  const s = keyFileStore(h);
  await s.set('pw');
  expect(statSync(join(h, 'vault.key')).mode & 0o777).toBe(0o600);
  await s.remove();
  expect(existsSync(join(h, 'vault.key'))).toBe(false);
  expect(await s.get()).toBeNull();
});
