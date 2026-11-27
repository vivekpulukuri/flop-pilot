import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExecFn } from '../sys/exec.js';
import type { Plat } from '../platform/secrets.js';
import { installAgent, isLoaded, launchdLabel, uninstallAgent } from './launchd.js';

export interface InstallOpts { home: string; nodePath: string; cliPath: string; intervalMin: number }
export interface Scheduler {
  install(o: InstallOpts): Promise<string>;
  uninstall(home: string): Promise<void>;
  isInstalled(home: string): Promise<boolean>;
}

/** One background job per data folder: "flop-pilot" for the default home, suffixed otherwise. */
export function jobName(home: string): string {
  if (resolve(home) === resolve(join(homedir(), '.flop-pilot'))) return 'flop-pilot';
  return `flop-pilot-${createHash('sha256').update(resolve(home)).digest('hex').slice(0, 12)}`;
}

const logOf = (home: string, sep = '/') => [home, 'logs', 'autopilot.log'].join(sep);

// ---- Linux: cron ----
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`).replace(/%/g, '\\%')}'`;
const TAG = (name: string) => `# flop-pilot:${name}`;

export function cronLine(o: InstallOpts, name: string): string {
  const when = o.intervalMin >= 1 && o.intervalMin <= 59 ? `*/${Math.round(o.intervalMin)} * * * *` : '0 * * * *';
  return `${when} FLOP_PILOT_HOME=${shq(o.home)} ${shq(o.nodePath)} ${shq(o.cliPath)} tick >> ${shq(logOf(o.home))} 2>&1 ${TAG(name)}`;
}

function tidy(lines: string[]): string {
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.length ? lines.join('\n') + '\n' : '';
}

/** Replaces only our tagged line; every other line of the user's crontab is kept as is. */
export function mergeCrontab(existing: string, line: string, name: string): string {
  const kept = existing.split('\n').filter((l) => !l.endsWith(TAG(name)));
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  return tidy([...kept, line]);
}

export function removeFromCrontab(existing: string, name: string): string {
  return tidy(existing.split('\n').filter((l) => !l.endsWith(TAG(name))));
}

function cronScheduler(exec: ExecFn): Scheduler {
  const read = async () => {
    try { return (await exec('crontab', ['-l'])).stdout; }
    catch (e) {
      const err = e as NodeJS.ErrnoException & { code?: number | string };
      if (err.code === 'ENOENT') throw new Error('cron is not installed. Install it (for example: sudo apt install cron), then try again.');
      return ''; // "no crontab for user"
    }
  };
  const write = (tab: string) => exec('crontab', ['-'], { input: tab });
  return {
    async install(o) { await write(mergeCrontab(await read(), cronLine(o, jobName(o.home)), jobName(o.home))); return `crontab entry ${TAG(jobName(o.home))}`; },
    async uninstall(home) { const tab = await read(); if (tab.includes(TAG(jobName(home)))) await write(removeFromCrontab(tab, jobName(home))); },
    async isInstalled(home) { try { return (await read()).includes(TAG(jobName(home))); } catch { return false; } },
  };
}

// ---- Windows: Task Scheduler + hidden VBScript launcher ----
const vbsStr = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function vbsLauncher(o: { home: string; nodePath: string; cliPath: string }): string {
  const cmd = `cmd /c ""${o.nodePath}" "${o.cliPath}" tick >> "${logOf(o.home, '\\')}" 2>&1"`;
  return [
    "' FLOP Pilot autopilot launcher: runs one tick without opening a window.",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Environment("Process")("FLOP_PILOT_HOME") = ${vbsStr(o.home)}`,
    `sh.Run ${vbsStr(cmd)}, 0, False`,
    '',
  ].join('\r\n');
}

export function schtasksCreateArgs(name: string, vbsPath: string, intervalMin: number): string[] {
  return ['/Create', '/F', '/SC', 'MINUTE', '/MO', String(Math.max(1, Math.round(intervalMin))), '/TN', name, '/TR', `wscript.exe "${vbsPath}"`];
}

function windowsScheduler(exec: ExecFn): Scheduler {
  const vbsPath = (home: string) => join(home, 'run-tick.vbs');
  return {
    async install(o) {
      writeFileSync(vbsPath(o.home), vbsLauncher(o));
      await exec('schtasks', schtasksCreateArgs(jobName(o.home), vbsPath(o.home), o.intervalMin));
      return `Task Scheduler task "${jobName(o.home)}"`;
    },
    async uninstall(home) {
      try { await exec('schtasks', ['/Delete', '/F', '/TN', jobName(home)]); } catch { /* not installed */ }
      rmSync(vbsPath(home), { force: true });
    },
    async isInstalled(home) { try { await exec('schtasks', ['/Query', '/TN', jobName(home)]); return true; } catch { return false; } },
  };
}

// ---- macOS: launchd (existing) ----
function launchdScheduler(exec: ExecFn, agentsDir?: string): Scheduler {
  return {
    install: (o) => installAgent({ home: o.home, nodePath: o.nodePath, cliPath: o.cliPath, intervalSec: o.intervalMin * 60, exec, agentsDir }),
    uninstall: (home) => uninstallAgent(home, exec, agentsDir),
    isInstalled: (home) => isLoaded(launchdLabel(home), exec),
  };
}

export function schedulerFor(plat: Plat, exec: ExecFn, o: { agentsDir?: string } = {}): Scheduler {
  if (plat === 'darwin') return launchdScheduler(exec, o.agentsDir);
  if (plat === 'win32') return windowsScheduler(exec);
  return cronScheduler(exec);
}
