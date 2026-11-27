import { existsSync } from 'node:fs';
import { join } from 'node:path';

type Exec = (file: string, args: string[], cwd: string) => Promise<{ stdout: string }>;

/** Highest stable vX.Y.Z tag; pre-releases and other tags are ignored. */
export function pickLatestTag(tags: string[]): string | null {
  const parsed = tags.map((t) => t.trim()).map((t) => ({ t, m: /^v(\d+)\.(\d+)\.(\d+)$/.exec(t) })).filter((x) => x.m);
  parsed.sort((a, b) => { for (let i = 1; i <= 3; i++) { const d = Number(b.m![i]) - Number(a.m![i]); if (d) return d; } return 0; });
  return parsed[0]?.t ?? null;
}

/** Manual update to the newest release tag (owner's choice: no self-update). Never pushes. */
export async function runUpdate(d: { cwd: string; exec: Exec; doctor: () => Promise<boolean> }): Promise<{ ok: boolean; message: string }> {
  if (!existsSync(join(d.cwd, '.git'))) {
    return { ok: false, message: 'This copy was installed from a ZIP, so it cannot update itself. Download the newest ZIP from the GitHub page, unzip it in place of this folder, then run: npm ci' };
  }
  const git = (...args: string[]) => d.exec('git', args, d.cwd);
  if ((await git('status', '--porcelain')).stdout.trim()) return { ok: false, message: 'This folder has local changes, so it is not updating. Undo your edits (or ask for help), then try again.' };
  await git('fetch', '--tags', '--force');
  const tag = pickLatestTag((await git('tag', '--list', 'v*')).stdout.split('\n'));
  if (!tag) return { ok: false, message: 'No release found yet. Nothing to update.' };
  await git('checkout', '--quiet', tag);
  await d.exec('npm', ['ci', '--no-fund', '--no-audit'], d.cwd);
  const healthy = await d.doctor();
  return { ok: healthy, message: healthy ? `Updated to ${tag}. All checks pass.` : `Updated to ${tag}, but some checks failed. Run: npm run doctor` };
}
