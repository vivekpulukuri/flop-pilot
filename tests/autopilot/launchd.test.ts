import { test, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { renderPlist, launchdLabel } from '../../src/autopilot/launchd.js';

test('renderPlist has label, StartInterval, absolute node path, tick args, home env and log path', () => {
  const p = renderPlist({ label: 'io.floppilot.autopilot', nodePath: '/usr/local/bin/node', cliPath: '/Users/a/flop-pilot/dist/cli.js', home: '/Users/a/.flop-pilot', intervalSec: 900 });
  expect(p).toContain('<key>Label</key>\n  <string>io.floppilot.autopilot</string>');
  expect(p).toContain('<key>StartInterval</key>\n  <integer>900</integer>');
  expect(p).toContain('<string>/usr/local/bin/node</string>\n    <string>/Users/a/flop-pilot/dist/cli.js</string>\n    <string>tick</string>');
  expect(p).toContain('<key>FLOP_PILOT_HOME</key>\n    <string>/Users/a/.flop-pilot</string>');
  expect(p).toContain('<string>/Users/a/.flop-pilot/logs/autopilot.log</string>');
  expect(p).toContain('<key>RunAtLoad</key>\n  <true/>');
});

test('renderPlist escapes XML special characters in paths', () => {
  const p = renderPlist({ label: 'l', nodePath: '/a&b/node', cliPath: '/c<d>/cli.js', home: '/h', intervalSec: 900 });
  expect(p).toContain('/a&amp;b/node');
  expect(p).toContain('/c&lt;d&gt;/cli.js');
});

test('launchdLabel is the plain label for the default home and suffixed for others', () => {
  expect(launchdLabel(join(homedir(), '.flop-pilot'))).toBe('io.floppilot.autopilot');
  expect(launchdLabel('/tmp/x/h')).toMatch(/^io\.floppilot\.autopilot\.[0-9a-f]{12}$/);
});

test('protectedFolder flags macOS privacy-protected folders that block background jobs', async () => {
  const { protectedFolder } = await import('../../src/autopilot/launchd.js');
  const h = homedir();
  const P = (p: string) => protectedFolder(join(h, p), 'darwin');
  expect(P('Documents/flop-pilot/dist/cli.js')).toBe('Documents');
  expect(P('Desktop/flop-pilot/dist/cli.js')).toBe('Desktop');
  expect(P('Downloads/x/dist/cli.js')).toBe('Downloads');
  expect(P('Library/Mobile Documents/com~apple~CloudDocs/x/cli.js')).toBe('iCloud Drive');
  expect(P('flop-pilot/dist/cli.js')).toBeNull();
  expect(P('Documentsx/cli.js')).toBeNull();
});

test('installAgent refuses a project inside a protected folder with a move hint, before touching launchd', async () => {
  const { installAgent } = await import('../../src/autopilot/launchd.js');
  const calls: string[][] = [];
  await expect(installAgent({ home: '/tmp/h', nodePath: '/n', cliPath: join(homedir(), 'Documents', 'flop-pilot', 'dist', 'cli.js'), intervalSec: 900, exec: async (_f, a) => { calls.push(a); }, agentsDir: '/tmp/agents-x' }))
    .rejects.toThrow(/Documents.*move the flop-pilot folder/i);
  expect(calls).toEqual([]);
});

test('uninstallAgent boots the job out AND deletes the plist so it does not come back at login', async () => {
  const { installAgent, uninstallAgent, plistPath, launchdLabel: lbl } = await import('../../src/autopilot/launchd.js');
  const { mkdtempSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const agents = mkdtempSync(join(tmpdir(), 'agents-'));
  const calls: string[][] = [];
  const exec = async (_f: string, a: string[]) => { calls.push(a); };
  await installAgent({ home: '/tmp/hh', nodePath: '/n', cliPath: '/opt/fp/dist/cli.js', intervalSec: 900, exec, agentsDir: agents });
  const file = plistPath(lbl('/tmp/hh'), agents);
  expect(existsSync(file)).toBe(true);
  await uninstallAgent('/tmp/hh', exec, agents);
  expect(existsSync(file)).toBe(false);
  expect(calls.at(-1)![0]).toBe('bootout');
});

test('protectedFolderHint names the real project folder, not $PWD', async () => {
  const { protectedFolderHint } = await import('../../src/autopilot/launchd.js');
  const h = protectedFolderHint('Documents', '/Users/a/Documents/flop-pilot');
  expect(h).toContain('mv "/Users/a/Documents/flop-pilot" ~/flop-pilot');
  expect(h).not.toContain('$PWD');
  expect(h).not.toContain('npm link');
  expect(h).toContain('npm run autopilot:on');
});
