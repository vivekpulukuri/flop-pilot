import { test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });
const sources = ['README.md', 'docs/SETUP.md', 'docs/TROUBLESHOOTING.md', ...files('src').filter((f) => f.endsWith('.ts'))];

test('every `npm run X` mentioned in docs and app messages is a real script', () => {
  const missing = new Set<string>();
  for (const f of sources) for (const m of readFileSync(f, 'utf8').matchAll(/npm run ([a-z][a-z0-9:-]*)/g)) if (!pkg.scripts[m[1]]) missing.add(`${m[1]} (${f})`);
  expect([...missing]).toEqual([]);
});

test('user-facing text no longer tells people to type the flop-pilot command', () => {
  const offenders: string[] = [];
  const re = /flop-pilot (init|doctor|wallets|fund|enroll|spend|tick|dashboard|autopilot|pause|resume|stop|practice|network|claimers|miners|activation|update|export)\b/;
  for (const f of sources.filter((x) => !x.endsWith('src/cli.ts'))) readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (re.test(l)) offenders.push(`${f}:${i + 1}`); });
  expect(offenders).toEqual([]);
});

test('core scripts call the CLI with the right command', () => {
  expect(pkg.scripts.doctor).toBe('node dist/cli.js doctor');
  expect(pkg.scripts['autopilot:on']).toBe('node dist/cli.js autopilot on');
  expect(pkg.scripts['init:restore']).toBe('node dist/cli.js init --restore');
  expect(pkg.scripts['claimers:2']).toBe('node dist/cli.js claimers 2');
});
