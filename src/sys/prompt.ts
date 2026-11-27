import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { PromptIO } from '../commands/init.js';

/** Interactive prompts on a TTY; with piped input, answers are read line by line from stdin. */
export async function terminalIO(): Promise<PromptIO & { close(): void }> {
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(c as Buffer);
    const lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
    return {
      print: (s) => stdout.write(s + '\n'),
      ask: async (q) => { stdout.write(q + '\n'); return lines.shift() ?? ''; },
      clear: () => {},
      close: () => {},
    };
  }
  const rl = createInterface({ input: stdin, output: stdout });
  return {
    print: (s) => stdout.write(s + '\n'),
    ask: (q) => rl.question(q),
    clear: () => stdout.write('\x1b[2J\x1b[3J\x1b[H'),
    close: () => rl.close(),
  };
}
