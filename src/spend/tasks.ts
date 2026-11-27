import { existsSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../core/paths.js';
import type { Ledger } from '../ledger/ledger.js';
import { BUILTIN_TASKS } from './builtin-tasks.js';

export { BUILTIN_TASKS };
export interface Task { id: string; prompt: string; expectKeywords?: string[]; source: 'user' | 'builtin'; }

const MAX_PROMPT_CHARS = 20000;

/** Oldest .txt/.md in tasks/, else the next built-in task (round-robin via state `builtinCursor`). */
export function nextTask(home: string, ledger: Ledger): Task {
  const dir = paths(home).tasks;
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => /\.(txt|md)$/i.test(f)).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => a.t - b.t || a.f.localeCompare(b.f))
    : [];
  if (files.length) {
    const f = files[0].f;
    return { id: f, prompt: readFileSync(join(dir, f), 'utf8').slice(0, MAX_PROMPT_CHARS), source: 'user' };
  }
  const cursor = ledger.getState<number>('builtinCursor') ?? 0;
  ledger.setState('builtinCursor', (cursor + 1) % BUILTIN_TASKS.length);
  return BUILTIN_TASKS[cursor % BUILTIN_TASKS.length];
}

export function completeTask(home: string, t: Task): void {
  if (t.source !== 'user') return;
  const from = join(paths(home).tasks, t.id);
  if (existsSync(from)) renameSync(from, join(paths(home).tasksDone, t.id));
}

export function scoreOutput(t: Task, output: string): number | null {
  if (!t.expectKeywords?.length) return null;
  const o = output.toLowerCase();
  return t.expectKeywords.filter((k) => o.includes(k.toLowerCase())).length / t.expectKeywords.length;
}
