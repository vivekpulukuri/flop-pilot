import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const LAUNCHD_LABEL = 'io.floppilot.autopilot';
const run = promisify(execFile);
type Exec = (file: string, args: string[]) => Promise<unknown>;
const realExec: Exec = (file, args) => run(file, args, { timeout: 10000 });
const uid = () => process.getuid?.() ?? 501;

/** One LaunchAgent per data folder, so a test install never replaces the real autopilot. */
export function launchdLabel(home: string): string {
  if (resolve(home) === resolve(join(homedir(), '.flop-pilot'))) return LAUNCHD_LABEL;
  return `${LAUNCHD_LABEL}.${createHash('sha256').update(resolve(home)).digest('hex').slice(0, 12)}`;
}

const PROTECTED: [string, string][] = [
  ['Documents', 'Documents'], ['Desktop', 'Desktop'], ['Downloads', 'Downloads'], ['Library/Mobile Documents', 'iCloud Drive'],
];

/**
 * macOS privacy protection (TCC) silently blocks background jobs from reading these folders, so an autopilot
 * installed from there hangs at startup. Returns the folder's friendly name, or null.
 */
export function protectedFolder(path: string): string | null {
  const p = resolve(path);
  for (const [rel, name] of PROTECTED) {
    const base = join(homedir(), rel);
    if (p === base || p.startsWith(base + '/')) return name;
  }
  return null;
}

export function protectedFolderHint(name: string): string {
  return `The flop-pilot folder is inside your ${name} folder. macOS blocks background jobs from reading ${name}, so the autopilot would hang. `
    + 'Please move the flop-pilot folder to your home folder, then turn the autopilot on again:\n'
    + '  mv "$PWD" ~/flop-pilot && cd ~/flop-pilot && npm ci && npm link && flop-pilot autopilot on';
}

export function plistPath(label: string, agentsDir = join(homedir(), 'Library', 'LaunchAgents')): string {
  return join(agentsDir, `${label}.plist`);
}

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderPlist(o: { label: string; nodePath: string; cliPath: string; home: string; intervalSec: number }): string {
  const log = join(o.home, 'logs', 'autopilot.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${x(o.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${x(o.nodePath)}</string>
    <string>${x(o.cliPath)}</string>
    <string>tick</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FLOP_PILOT_HOME</key>
    <string>${x(o.home)}</string>
  </dict>
  <key>StartInterval</key>
  <integer>${Math.round(o.intervalSec)}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${x(log)}</string>
  <key>StandardErrorPath</key>
  <string>${x(log)}</string>
</dict>
</plist>
`;
}

export async function isLoaded(label = LAUNCHD_LABEL, exec: Exec = realExec): Promise<boolean> {
  try { await exec('/bin/launchctl', ['print', `gui/${uid()}/${label}`]); return true; } catch { return false; }
}

export async function installAgent(o: { home: string; nodePath: string; cliPath: string; intervalSec: number; exec?: Exec; agentsDir?: string }): Promise<string> {
  const blocked = protectedFolder(o.cliPath);
  if (blocked) throw new Error(protectedFolderHint(blocked));
  const exec = o.exec ?? realExec;
  const label = launchdLabel(o.home);
  const file = plistPath(label, o.agentsDir);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, renderPlist({ label, nodePath: o.nodePath, cliPath: o.cliPath, home: o.home, intervalSec: o.intervalSec }), { mode: 0o644 });
  try { await exec('/bin/launchctl', ['bootout', `gui/${uid()}/${label}`]); } catch { /* not loaded */ }
  await exec('/bin/launchctl', ['bootstrap', `gui/${uid()}`, file]);
  return file;
}

export async function uninstallAgent(home: string, exec: Exec = realExec, agentsDir?: string): Promise<void> {
  const label = launchdLabel(home);
  try { await exec('/bin/launchctl', ['bootout', `gui/${uid()}/${label}`]); } catch { /* not loaded */ }
  rmSync(plistPath(label, agentsDir), { force: true });
}
