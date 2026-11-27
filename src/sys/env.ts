import type { Env } from '../core/types.js';
import { realExec, type ExecFn } from './exec.js';
import { currentPlat, type Plat } from '../platform/secrets.js';

const defaultExec: ExecFn = realExec;

// The script reads title/body from argv, so untrusted text is never parsed as AppleScript.
const NOTIFY_SCRIPT = ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run'];
// Windows tray balloon; title/body come from env vars so untrusted text is never parsed as PowerShell.
const WIN_BALLOON = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(8000, $env:FP_TITLE, $env:FP_BODY, 'Info'); Start-Sleep -Seconds 9; $n.Dispose()";

/** How to open a URL in the default browser, or null on a Linux machine without a desktop. */
export function openUrlCommand(url: string, plat: Plat, env: NodeJS.ProcessEnv): { file: string; args: string[] } | null {
  if (plat === 'darwin') return { file: '/usr/bin/open', args: [url] };
  if (plat === 'win32') return { file: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  return env.DISPLAY || env.WAYLAND_DISPLAY ? { file: 'xdg-open', args: [url] } : null;
}

export function tunnelHint(port: number): string {
  return `This computer has no desktop. To view the dashboard from your own computer, run there:\n  ssh -L ${port}:127.0.0.1:${port} you@this-server\nthen open the link above in your browser.`;
}

export function realEnv(o: { version: string; execFile?: ExecFn; fetchImpl?: typeof fetch; ipTimeoutMs?: number; plat?: Plat }): Env {
  const exec = o.execFile ?? defaultExec;
  const plat = o.plat ?? currentPlat();
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
        if (plat === 'darwin') await exec('/usr/bin/osascript', [...NOTIFY_SCRIPT.flatMap((l) => ['-e', l]), title, body]);
        else if (plat === 'win32') await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_BALLOON], { env: { FP_TITLE: title, FP_BODY: body } });
        else await exec('notify-send', [title, body]);
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
