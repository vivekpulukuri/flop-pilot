import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const LAUNCHD_LABEL = 'io.floppilot.autopilot';
const run = promisify(execFile);

export async function isLoaded(): Promise<boolean> {
  try {
    await run('/bin/launchctl', ['print', `gui/${process.getuid?.() ?? 501}/${LAUNCHD_LABEL}`], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
