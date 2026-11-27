import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextTask, scoreOutput, completeTask, BUILTIN_TASKS } from '../../src/spend/tasks.js';
import { ensureDirs, paths } from '../../src/core/paths.js';
import { openLedger, type Ledger } from '../../src/ledger/ledger.js';

let home: string;
let l: Ledger;
beforeEach(() => { home = join(mkdtempSync(join(tmpdir(), 'fpt-')), 'h'); ensureDirs(home); l = openLedger(paths(home).ledger); });

test('builtin set has 20 tasks with keywords', () => {
  expect(BUILTIN_TASKS).toHaveLength(20);
  for (const t of BUILTIN_TASKS) expect(t.expectKeywords!.length).toBeGreaterThan(0);
});

test('prefers the oldest user .txt/.md file and ignores other files', () => {
  const a = join(paths(home).tasks, 'b-newer.md'); writeFileSync(a, 'Summarize B');
  const b = join(paths(home).tasks, 'a-older.txt'); writeFileSync(b, 'Summarize A');
  writeFileSync(join(paths(home).tasks, 'ignore.pdf'), 'x');
  utimesSync(b, new Date('2026-01-01'), new Date('2026-01-01'));
  expect(nextTask(home, l)).toMatchObject({ id: 'a-older.txt', prompt: 'Summarize A', source: 'user' });
});

test('falls back to builtin round-robin', () => {
  const t1 = nextTask(home, l); const t2 = nextTask(home, l);
  expect(t1.source).toBe('builtin');
  expect(t2.id).not.toBe(t1.id);
  for (let i = 0; i < 18; i++) nextTask(home, l);
  expect(nextTask(home, l).id).toBe(t1.id);
});

test('completeTask moves a user file to tasks/done', () => {
  writeFileSync(join(paths(home).tasks, 'q.txt'), 'Q');
  const t = nextTask(home, l);
  completeTask(home, t);
  expect(existsSync(join(paths(home).tasks, 'q.txt'))).toBe(false);
  expect(existsSync(join(paths(home).tasksDone, 'q.txt'))).toBe(true);
});

test('scoreOutput is the fraction of keywords present, case-insensitive', () => {
  const t = { id: 'x', prompt: 'p', source: 'builtin' as const, expectKeywords: ['Paris', 'France'] };
  expect(scoreOutput(t, 'the capital is paris')).toBe(0.5);
  expect(scoreOutput({ ...t, expectKeywords: undefined }, 'x')).toBeNull();
});
