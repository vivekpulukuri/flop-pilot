#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
export const VERSION = pkg.version;

const program = new Command();
program.name('flop-pilot').description('Autopilot for FLOP Testnet agents').version(VERSION);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
