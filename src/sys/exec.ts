import { spawn } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { existsSync } from 'node:fs';

export interface ExecOpts { input?: string; env?: Record<string, string>; timeoutMs?: number; cwd?: string }
/** Runs a program without a shell. Secrets go in `input` (stdin) or `env`, never in `args`. */
export type ExecFn = (file: string, args: string[], o?: ExecOpts) => Promise<{ stdout: string }>;

export const realExec: ExecFn = (file, args, o = {}) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { env: { ...process.env, ...(o.env ?? {}) }, cwd: o.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const timer = setTimeout(() => child.kill(), o.timeoutMs ?? 20000);
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('error', (e) => { clearTimeout(timer); reject(e); });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve({ stdout });
    else reject(Object.assign(new Error(stderr.trim() || `${file} exited with ${code}`), { code }));
  });
  if (o.input !== undefined) child.stdin.end(o.input); else child.stdin.end();
});

/** True if `cmd` is an executable on PATH (no shell involved). */
export function hasCommand(cmd: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  return (env.PATH ?? '').split(delimiter).some((d) => d && exts.some((x) => existsSync(join(d, cmd + x))));
}
