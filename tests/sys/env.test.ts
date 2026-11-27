import { test, expect } from 'vitest';
import { realEnv } from '../../src/sys/env.js';

test('notify passes title and body as argv, never interpolated into the script', async () => {
  const calls: { file: string; args: string[] }[] = [];
  const env = realEnv({ version: '0.1.0', execFile: async (file, args) => { calls.push({ file, args }); return { stdout: '' }; } });
  await env.notify('FLOP "upgraded"', 'Run: flop-pilot update"; do shell script "rm -rf ~"');
  expect(calls[0].file).toBe('/usr/bin/osascript');
  const script = calls[0].args.filter((_, i, a) => a[i - 1] === '-e').join('\n');
  expect(script).not.toContain('rm -rf');
  expect(calls[0].args.slice(-2)).toEqual(['FLOP "upgraded"', 'Run: flop-pilot update"; do shell script "rm -rf ~"']);
});

test('notify never throws when osascript fails', async () => {
  const env = realEnv({ version: '0.1.0', execFile: async () => { throw new Error('no gui'); } });
  await expect(env.notify('a', 'b')).resolves.toBeUndefined();
});

test('publicIp returns null on timeout or error, never throws', async () => {
  const hang = (() => new Promise(() => {})) as unknown as typeof fetch;
  const env = realEnv({ version: '0.1.0', fetchImpl: hang, ipTimeoutMs: 50 });
  expect(await env.publicIp()).toBeNull();
  const bad = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  expect(await realEnv({ version: '0.1.0', fetchImpl: bad }).publicIp()).toBeNull();
});

test('publicIp parses ipify JSON and fetch adds the flop-pilot User-Agent', async () => {
  let ua: string | null = null;
  const f = (async (_u: string, init?: RequestInit) => {
    ua = new Headers(init?.headers).get('user-agent');
    return new Response(JSON.stringify({ ip: '198.51.100.4' }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const env = realEnv({ version: '0.1.0', fetchImpl: f });
  expect(await env.publicIp()).toBe('198.51.100.4');
  expect(ua).toBe('flop-pilot/0.1.0');
});
