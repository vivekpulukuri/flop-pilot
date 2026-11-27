import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Exclusive pid lock; a lock left by a dead process is replaced. */
export function acquireLock(path: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(process.pid), { flag: 'wx', mode: 0o600 });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let pid = NaN;
      try { pid = Number(readFileSync(path, 'utf8').trim()); } catch { /* vanished */ }
      if (alive(pid)) return false;
      try { unlinkSync(path); } catch { /* raced */ }
    }
  }
  return false;
}

export function releaseLock(path: string): void {
  try {
    if (readFileSync(path, 'utf8').trim() === String(process.pid)) unlinkSync(path);
  } catch { /* already gone */ }
}
