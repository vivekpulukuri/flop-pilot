import { test, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { cronLine, mergeCrontab, removeFromCrontab, vbsLauncher, schedulerFor, jobName } from '../../src/autopilot/scheduler.js';
import { protectedFolder } from '../../src/autopilot/launchd.js';
import { ensureDirs } from '../../src/core/paths.js';
import type { ExecFn } from '../../src/sys/exec.js';

test('jobName is plain for the default home and suffixed otherwise', () => {
  expect(jobName(join(homedir(), '.flop-pilot'))).toBe('flop-pilot');
  expect(jobName('/tmp/x/h')).toMatch(/^flop-pilot-[0-9a-f]{12}$/);
});

test('REVIEW-FOCUS-2: cron line single-quotes paths with spaces and quotes, escapes %, tags the line', () => {
  const l = cronLine({ home: "/home/o'neil/.flop-pilot", nodePath: '/usr/bin/node', cliPath: '/home/o neil/flop-pilot/dist/cli.js', intervalMin: 15 }, 'flop-pilot');
  expect(l).toBe(`*/15 * * * * FLOP_PILOT_HOME='/home/o'\\''neil/.flop-pilot' '/usr/bin/node' '/home/o neil/flop-pilot/dist/cli.js' tick >> '/home/o'\\''neil/.flop-pilot/logs/autopilot.log' 2>&1 # flop-pilot:flop-pilot`);
  expect(cronLine({ home: '/h/100%', nodePath: '/n', cliPath: '/c', intervalMin: 15 }, 't')).toContain("'/h/100\\%'");
});

test('cron interval over 59 minutes runs hourly', () => {
  expect(cronLine({ home: '/h', nodePath: '/n', cliPath: '/c', intervalMin: 90 }, 't').startsWith('0 * * * * ')).toBe(true);
});

test('REVIEW-FOCUS-1: merging keeps the user\'s other cron lines and replaces only our tagged line', () => {
  const existing = '# my jobs\n0 3 * * * /usr/bin/backup\n*/15 * * * * old # flop-pilot:flop-pilot\n@reboot /usr/bin/thing\n';
  const merged = mergeCrontab(existing, 'NEW # flop-pilot:flop-pilot', 'flop-pilot');
  expect(merged).toBe('# my jobs\n0 3 * * * /usr/bin/backup\n@reboot /usr/bin/thing\nNEW # flop-pilot:flop-pilot\n');
  expect(removeFromCrontab(merged, 'flop-pilot')).toBe('# my jobs\n0 3 * * * /usr/bin/backup\n@reboot /usr/bin/thing\n');
  expect(mergeCrontab('', 'X # flop-pilot:a', 'a')).toBe('X # flop-pilot:a\n');
  expect(removeFromCrontab('keep # flop-pilot:other\n', 'a')).toBe('keep # flop-pilot:other\n');
});

test('linux scheduler: no crontab yet (exit 1) is treated as empty; install writes via stdin', async () => {
  const calls: { args: string[]; input?: string }[] = [];
  let tab = '';
  const exec: ExecFn = async (_f, args, o = {}) => {
    calls.push({ args, input: o.input });
    if (args[0] === '-l') { if (!tab) throw Object.assign(new Error('no crontab for user'), { code: 1 }); return { stdout: tab }; }
    tab = o.input ?? ''; return { stdout: '' };
  };
  const s = schedulerFor('linux', exec);
  await s.install({ home: '/tmp/h', nodePath: '/n', cliPath: '/c', intervalMin: 15 });
  expect(calls[1]).toMatchObject({ args: ['-'] });
  expect(tab).toContain(`# flop-pilot:${jobName('/tmp/h')}`);
  expect(await s.isInstalled('/tmp/h')).toBe(true);
  await s.uninstall('/tmp/h');
  expect(tab).toBe('');
  expect(await s.isInstalled('/tmp/h')).toBe(false);
});

test('REVIEW-FOCUS-2: Windows .vbs runs hidden (window style 0), sets FLOP_PILOT_HOME, quotes paths with spaces', () => {
  const v = vbsLauncher({ home: 'C:\\Users\\Ann Lee\\.flop-pilot', nodePath: 'C:\\Program Files\\nodejs\\node.exe', cliPath: 'C:\\Users\\Ann Lee\\flop-pilot\\dist\\cli.js' });
  expect(v).toContain('sh.Environment("Process")("FLOP_PILOT_HOME") = "C:\\Users\\Ann Lee\\.flop-pilot"');
  expect(v).toContain('sh.Run "cmd /c """"C:\\Program Files\\nodejs\\node.exe"" ""C:\\Users\\Ann Lee\\flop-pilot\\dist\\cli.js"" tick >> ""C:\\Users\\Ann Lee\\.flop-pilot\\logs\\autopilot.log"" 2>&1""", 0, False');
});

test('windows scheduler writes the vbs and calls schtasks; uninstall deletes both', async () => {
  const home = join(mkdtempSync(join(tmpdir(), 'fpsch-')), 'h'); ensureDirs(home);
  const calls: string[][] = [];
  const exec: ExecFn = async (f, args) => { calls.push([f, ...args]); return { stdout: '' }; };
  const s = schedulerFor('win32', exec);
  await s.install({ home, nodePath: 'C:\\node.exe', cliPath: 'C:\\fp\\dist\\cli.js', intervalMin: 15 });
  expect(readFileSync(join(home, 'run-tick.vbs')).toString('utf16le')).toContain('tick');
  expect(calls[0][0]).toBe('schtasks');
  expect(await s.isInstalled(home)).toBe(true);
  await s.uninstall(home);
  expect(calls.at(-1)).toEqual(['schtasks', '/Delete', '/F', '/TN', jobName(home)]);
  expect(existsSync(join(home, 'run-tick.vbs'))).toBe(false);
});

test('protectedFolder is macOS-only', () => {
  expect(protectedFolder(`${homedir()}/Documents/flop-pilot/dist/cli.js`, 'linux')).toBeNull();
  expect(protectedFolder(`${homedir()}/Documents/flop-pilot/dist/cli.js`, 'win32')).toBeNull();
  expect(protectedFolder(join(homedir(), 'Documents', 'flop-pilot', 'dist', 'cli.js'), 'darwin')).toBe('Documents');
});
