import { mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function pilotHome(): string {
  return process.env.FLOP_PILOT_HOME || join(homedir(), '.flop-pilot');
}

export function paths(home: string) {
  return {
    root: home,
    vault: join(home, 'vault.json'),
    config: join(home, 'config.json'),
    ledger: join(home, 'ledger.db'),
    intents: join(home, 'intents'),
    tasks: join(home, 'tasks'),
    tasksDone: join(home, 'tasks', 'done'),
    outputs: join(home, 'outputs'),
    logs: join(home, 'logs'),
    lock: join(home, 'tick.lock'),
  };
}

export function ensureDirs(home: string): void {
  const p = paths(home);
  for (const d of [p.root, p.intents, p.tasks, p.tasksDone, p.outputs, p.logs]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
    chmodSync(d, 0o700);
  }
}
