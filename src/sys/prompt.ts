import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import type { PromptIO } from '../commands/init.js';

/** Interactive prompts on a TTY (secrets are not echoed); with piped input, answers are read line by line. */
export async function terminalIO(): Promise<PromptIO & { close(): void }> {
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(c as Buffer);
    const lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
    const ask = async (q: string) => { stdout.write(q + '\n'); return lines.shift() ?? ''; };
    return { print: (s) => stdout.write(s + '\n'), ask, askSecret: ask, clear: () => {}, close: () => {} };
  }
  let muted = false;
  const out = new Writable({ write(chunk, enc, cb) { if (!muted) stdout.write(chunk, enc as BufferEncoding); cb(); } });
  const rl = createInterface({ input: stdin, output: out, terminal: true });
  return {
    print: (s) => stdout.write(s + '\n'),
    ask: (q) => rl.question(q),
    askSecret: async (q) => { stdout.write(q); muted = true; try { return await rl.question(''); } finally { muted = false; stdout.write('\n'); } },
    clear: () => stdout.write('\x1b[2J\x1b[3J\x1b[H'),
    close: () => rl.close(),
  };
}

export async function askHidden(q: string): Promise<string> {
  const io = await terminalIO();
  try { return await io.askSecret!(q); } finally { io.close(); }
}
