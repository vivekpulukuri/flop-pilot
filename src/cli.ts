#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import type { Network } from './core/types.js';
import { pilotHome } from './core/paths.js';
import { loadConfig } from './core/config.js';
import { macKeychain } from './keys/keychain.js';
import { runInit } from './commands/init.js';
import { setClaimers, setNetwork, setPractice } from './commands/settings.js';
import { listWalletsCmd } from './commands/wallets.js';
import { terminalIO } from './sys/prompt.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
export const VERSION = pkg.version;

const program = new Command();
program.name('flop-pilot').description('Autopilot for FLOP Testnet agents').version(VERSION);

program.command('init')
  .description('Create your 24-word seed phrase, the encrypted vault and 3 wallets')
  .option('--restore', 'restore from an existing 24-word seed phrase')
  .option('--network <network>', 'devnet or testnet', 'devnet')
  .action(async (o: { restore?: boolean; network: Network }) => {
    const io = terminalIO();
    try { await runInit({ home: pilotHome(), network: o.network, restore: !!o.restore, io, store: macKeychain() }); }
    finally { io.close(); }
  });

program.command('wallets')
  .description('List your wallets')
  .action(async () => {
    const rows = await listWalletsCmd(pilotHome());
    console.log(`Network: ${loadConfig(pilotHome()).network}`);
    for (const r of rows) console.log(`#${r.index}  ${r.address}  claimer:${r.claimer ? 'yes' : 'no'}  enrolled:${r.enrolled ? 'yes' : 'no'}${r.stopped ? '  STOPPED' : ''}`);
  });

program.command('practice <onoff>')
  .description('Practice mode on|off (on = nothing is signed or sent)')
  .action((v: string) => {
    if (v !== 'on' && v !== 'off') throw new Error('Use: flop-pilot practice on   or   flop-pilot practice off');
    setPractice(pilotHome(), v === 'on');
    console.log(`Practice mode is now ${v.toUpperCase()}.`);
  });

program.command('network <name>')
  .description('Switch the active network (devnet or testnet)')
  .action(async (n: Network) => {
    await setNetwork(pilotHome(), n, macKeychain());
    console.log(`Active network is now ${n}.`);
  });

program.command('claimers <count>')
  .description('How many wallets claim from the faucet (1-3)')
  .action((k: string) => {
    setClaimers(pilotHome(), Number(k));
    console.log(`Claiming wallets: ${k}.`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
