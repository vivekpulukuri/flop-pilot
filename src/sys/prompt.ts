import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { PromptIO } from '../commands/init.js';

export function terminalIO(): PromptIO & { close(): void } {
  const rl = createInterface({ input: stdin, output: stdout });
  return {
    print: (s) => stdout.write(s + '\n'),
    ask: (q) => rl.question(q),
    clear: () => stdout.write('\x1b[2J\x1b[3J\x1b[H'),
    close: () => rl.close(),
  };
}
