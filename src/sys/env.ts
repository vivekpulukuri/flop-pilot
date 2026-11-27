import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { Env } from '../core/types.js';
import type { ExecFileFn } from '../keys/keychain.js';

const run = promisify(execFileCb);
const defaultExec: ExecFileFn = async (file, args) => ({ stdout: (await run(file, args, { encoding: 'utf8', timeout: 10000 })).stdout });

// The script reads title/body from argv, so untrusted text is never parsed as AppleScript.
const NOTIFY_SCRIPT = ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run'];

export function realEnv(o: { version: string; execFile?: ExecFileFn; fetchImpl?: typeof fetch; ipTimeoutMs?: number }): Env {
  const exec = o.execFile ?? defaultExec;
  const baseFetch = o.fetchImpl ?? globalThis.fetch;
  const ua = `flop-pilot/${o.version}`;
  const uaFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('user-agent', ua);
    return baseFetch(input as string, { ...init, headers });
  }) as typeof fetch;

  return {
    now: () => new Date(),
    fetch: uaFetch,
    async notify(title, body) {
      try {
        await exec('/usr/bin/osascript', [...NOTIFY_SCRIPT.flatMap((l) => ['-e', l]), title, body]);
      } catch {
        // Notifications are best-effort; the dashboard banner is the durable record.
      }
    },
    async publicIp() {
      const timeout = o.ipTimeoutMs ?? 5000;
      try {
        const res = await Promise.race([
          uaFetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(timeout) }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
        ]);
        const j = (await res.json()) as { ip?: unknown };
        return typeof j.ip === 'string' ? j.ip : null;
      } catch {
        return null;
      }
    },
  };
}
