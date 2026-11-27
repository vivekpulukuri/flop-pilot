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

test('linux notify uses notify-send with title and body as separate args', async () => {
  const calls: { file: string; args: string[] }[] = [];
  const env = realEnv({ version: '0.1.0', plat: 'linux', execFile: async (file, args) => { calls.push({ file, args }); return { stdout: '' }; } });
  await env.notify('FLOP Pilot', 'Run: npm run update');
  expect(calls[0]).toEqual({ file: 'notify-send', args: ['FLOP Pilot', 'Run: npm run update'] });
});

test('windows notify passes title and body via env vars, never inside the PowerShell script', async () => {
  const calls: { file: string; args: string[]; env?: Record<string, string> }[] = [];
  const env = realEnv({ version: '0.1.0', plat: 'win32', execFile: async (file, args, o) => { calls.push({ file, args, env: o?.env }); return { stdout: '' }; } });
  await env.notify('T"x', "B'; Remove-Item C:\\ -Recurse");
  expect(calls[0].file).toBe('powershell.exe');
  expect(calls[0].args.join(' ')).not.toContain('Remove-Item');
  expect(calls[0].env).toEqual({ FP_TITLE: 'T"x', FP_BODY: "B'; Remove-Item C:\\ -Recurse" });
});

test('openUrlCommand per OS; headless Linux returns null', async () => {
  const { openUrlCommand } = await import('../../src/sys/env.js');
  const u = 'http://127.0.0.1:4747/?t=abc';
  expect(openUrlCommand(u, 'darwin', {})).toEqual({ file: '/usr/bin/open', args: [u] });
  expect(openUrlCommand(u, 'win32', {})).toEqual({ file: 'rundll32', args: ['url.dll,FileProtocolHandler', u] });
  expect(openUrlCommand(u, 'linux', { DISPLAY: ':0' })).toEqual({ file: 'xdg-open', args: [u] });
  expect(openUrlCommand(u, 'linux', {})).toBeNull();
});

test('ssh tunnel hint names the port', async () => {
  const { tunnelHint } = await import('../../src/sys/env.js');
  expect(tunnelHint(4747)).toContain('ssh -L 4747:127.0.0.1:4747');
});
