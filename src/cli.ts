#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import type { Network } from './core/types.js';
import { pilotHome } from './core/paths.js';
import { loadConfig } from './core/config.js';
import { macKeychain, keychainAccount } from './keys/keychain.js';
import { existsSync } from 'node:fs';
import { paths } from './core/paths.js';
import { runInit } from './commands/init.js';
import { setClaimers, setNetwork, setPractice } from './commands/settings.js';
import { listWalletsCmd } from './commands/wallets.js';
import { terminalIO } from './sys/prompt.js';
import { realEnv } from './sys/env.js';
import { createSdkChain, isSupportedSpec } from './chain/sdk-chain.js';
import { NETWORK_PROFILES } from './core/networks.js';
import { runDoctor, formatChecks } from './commands/doctor.js';
import { isLoaded, launchdLabel } from './autopilot/launchd.js';
import { fileURLToPath } from 'node:url';
import { createFaucet } from './faucet/sdk-faucet.js';
import { runFund, formatResults } from './commands/fund.js';
import { runEnroll } from './commands/enroll.js';
import { runSpend } from './commands/spend.js';
import { setActivationBlock } from './watchers/mode.js';
import { runTick } from './autopilot/tick.js';
import { autopilotOn, autopilotOff, autopilotStatus, stopAll } from './commands/autopilot.js';
import { updateConfig } from './core/config.js';
import { serveDashboard } from './commands/dashboard.js';
import { runUpdate } from './commands/update.js';
import { runExport } from './commands/export.js';
import { writeFileSync } from 'node:fs';
import { dirname, join as pjoin } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { addMinerEndpoint, removeMinerEndpoint } from './commands/settings.js';
import type { RuntimeDeps } from './runtime.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
export const VERSION = pkg.version;

const keychain = (home: string) => macKeychain(undefined, keychainAccount(home));
function requireSetup(home: string): void {
  if (!existsSync(paths(home).vault)) throw new Error('flop-pilot is not set up yet. Run: flop-pilot init');
}

const deps = (): RuntimeDeps => ({
  home: pilotHome(), env: realEnv({ version: VERSION }), store: keychain(pilotHome()),
  makeChain: (n) => createSdkChain(n), makeFaucet: (n, env) => createFaucet(n, env),
});
const walletOpt = (v: string) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 2) throw new Error('--wallet must be 0, 1 or 2'); return n; };

const program = new Command();
program.name('flop-pilot').description('Autopilot for FLOP Testnet agents').version(VERSION);

program.command('init')
  .description('Create your 24-word seed phrase, the encrypted vault and 3 wallets')
  .option('--restore', 'restore from an existing 24-word seed phrase')
  .option('--network <network>', 'devnet or testnet', 'devnet')
  .action(async (o: { restore?: boolean; network: Network }) => {
    const io = await terminalIO();
    try { await runInit({ home: pilotHome(), network: o.network, restore: !!o.restore, io, store: keychain(pilotHome()) }); }
    finally { io.close(); }
  });

program.command('wallets')
  .description('List your wallets')
  .action(async () => {
    requireSetup(pilotHome());
    const rows = await listWalletsCmd(pilotHome());
    console.log(`Network: ${loadConfig(pilotHome()).network}`);
    for (const r of rows) console.log(`#${r.index}  ${r.address}  claimer:${r.claimer ? 'yes' : 'no'}  enrolled:${r.enrolled ? 'yes' : 'no'}${r.stopped ? '  STOPPED' : ''}`);
  });

program.command('practice <onoff>')
  .description('Practice mode on|off (on = nothing is signed or sent)')
  .action((v: string) => {
    if (v !== 'on' && v !== 'off') throw new Error('Use: flop-pilot practice on   or   flop-pilot practice off');
    requireSetup(pilotHome());
    setPractice(pilotHome(), v === 'on');
    console.log(`Practice mode is now ${v.toUpperCase()}.`);
  });

program.command('network <name>')
  .description('Switch the active network (devnet or testnet)')
  .action(async (n: Network) => {
    requireSetup(pilotHome());
    await setNetwork(pilotHome(), n, keychain(pilotHome()));
    console.log(`Active network is now ${n}.`);
  });

program.command('claimers <count>')
  .description('How many wallets claim from the faucet (1-3)')
  .action((k: string) => {
    requireSetup(pilotHome());
    setClaimers(pilotHome(), Number(k));
    console.log(`Claiming wallets: ${k}.`);
  });

program.command('doctor')
  .description('Check that everything is set up and reachable')
  .action(async () => {
    const home = pilotHome();
    const c = loadConfig(home);
    const env = realEnv({ version: VERSION });
    const checks = await runDoctor({
      home, store: keychain(home), nodeVersion: process.version, platform: process.platform,
      chain: () => createSdkChain(c.network),
      faucetChain: async () => (await (await env.fetch(`${NETWORK_PROFILES[c.network].faucet}/chain`, { signal: AbortSignal.timeout(15000) })).json()) as { network: string; genesisHash: string },
      launchdLoaded: () => isLoaded(launchdLabel(home)), isSupportedSpec, cliPath: fileURLToPath(import.meta.url),
    });
    console.log(formatChecks(checks));
    if (checks.some((x) => !x.ok)) process.exitCode = 1;
  });

program.command('fund')
  .description('Claim the faucet grant for each claiming wallet (guarded)')
  .option('--wallet <n>', 'only this wallet (0-2)', walletOpt)
  .option('--dry-run', 'show what would happen without sending anything')
  .action(async (o: { wallet?: number; dryRun?: boolean }) => {
    console.log(formatResults(await runFund(deps(), o)));
  });

program.command('enroll')
  .description('Register each funded wallet as an on-chain agent wallet with spending caps')
  .option('--dry-run', 'show what would happen without sending anything')
  .action(async (o: { dryRun?: boolean }) => {
    console.log(formatResults(await runEnroll(deps(), o)));
  });

program.command('spend')
  .description('Spend each enrolled wallet\'s balance on inference from independent miners')
  .option('--wallet <n>', 'only this wallet (0-2)', walletOpt)
  .option('--dry-run', 'show what would happen without sending anything')
  .action(async (o: { wallet?: number; dryRun?: boolean }) => {
    console.log(formatResults(await runSpend(deps(), o)));
  });

const miners = program.command('miners').description('Miner endpoints you can buy inference from');
miners.command('list').action(() => {
  requireSetup(pilotHome());
  const list = loadConfig(pilotHome()).minerEndpoints;
  console.log(list.length ? list.map((e) => `${e.address}  ${e.url}`).join('\n') : 'No miner endpoints yet. Add one: flop-pilot miners add <address> <https-url>');
});
miners.command('add <address> <url>').action((a: string, u: string) => { requireSetup(pilotHome()); addMinerEndpoint(pilotHome(), a, u); console.log('Added.'); });
miners.command('remove <address>').action((a: string) => { requireSetup(pilotHome()); removeMinerEndpoint(pilotHome(), a); console.log('Removed.'); });

program.command('activation <block>')
  .description('Enter the announced block where voucher earning starts (or "clear")')
  .action((b: string) => {
    requireSetup(pilotHome());
    const c = loadConfig(pilotHome());
    setActivationBlock(pilotHome(), c.network, b === 'clear' ? null : Number(b));
    console.log(b === 'clear' ? 'Activation block cleared.' : `Earning starts at ${c.network} block ${b}.`);
  });

program.command('tick')
  .description('Run one autopilot cycle now (this is what the background job runs)')
  .action(async () => {
    const s = await runTick(deps());
    const stamp = new Date().toISOString();
    console.log(`[${stamp}] tick ${s.skippedAll ? `skipped: ${s.skippedAll}` : `mode ${s.mode ?? 'unknown'}`}`);
    if (s.actions.length) console.log(formatResults(s.actions));
    for (const e of s.errors) console.log(`! ${e}`);
  });

const ap = program.command('autopilot').description('Background autopilot (runs every 15 minutes)');
ap.command('on').action(async () => { requireSetup(pilotHome()); const f = await autopilotOn(pilotHome()); console.log(`Autopilot ON (runs every ${loadConfig(pilotHome()).tickMinutes} min). Agent file: ${f}`); });
ap.command('off').action(async () => { await autopilotOff(pilotHome()); console.log('Autopilot OFF.'); });
ap.command('status').action(async () => {
  requireSetup(pilotHome());
  const st = await autopilotStatus(pilotHome());
  console.log(`Autopilot: ${st.loaded ? 'ON' : 'OFF'}${st.killed ? ' (stopped by kill switch)' : ''}${st.paused ? ' (paused)' : ''} · practice mode ${st.practice ? 'ON' : 'OFF'}`);
});

program.command('pause').description('Pause claims and spends (watchers keep running)').action(() => { requireSetup(pilotHome()); updateConfig(pilotHome(), { paused: true }); console.log('Paused. Resume with: flop-pilot resume'); });
program.command('resume').description('Resume after pause').action(() => { requireSetup(pilotHome()); updateConfig(pilotHome(), { paused: false }); console.log('Resumed.'); });

program.command('stop')
  .description('Kill switch: stop the autopilot now')
  .option('--deactivate', 'also deactivate your agent wallets on chain (asks to confirm)')
  .action(async (o: { deactivate?: boolean }) => {
    requireSetup(pilotHome());
    const io = await terminalIO();
    try {
      const rs = await stopAll(pilotHome(), { deactivate: o.deactivate, deps: deps(), confirm: () => io.ask('Type DEACTIVATE to confirm: ') });
      console.log('Autopilot stopped. Start again with: flop-pilot autopilot on');
      if (rs.length) console.log(formatResults(rs));
    } finally { io.close(); }
  });

program.command('dashboard')
  .description('Open your local dashboard in the browser')
  .option('--no-open', 'print the link instead of opening the browser')
  .action(async (o: { open: boolean }) => {
    requireSetup(pilotHome());
    await serveDashboard({ home: pilotHome(), env: realEnv({ version: VERSION }), store: keychain(pilotHome()), makeChain: (n) => createSdkChain(n), open: o.open });
  });

program.command('update')
  .description('Update flop-pilot to the newest release (you run this when FLOP upgrades)')
  .action(async () => {
    const run = promisify(execFileCb);
    const cwd = pjoin(dirname(fileURLToPath(import.meta.url)), '..');
    const r = await runUpdate({
      cwd,
      exec: async (file, args, dir) => ({ stdout: (await run(file, args, { cwd: dir, encoding: 'utf8', timeout: 300000 })).stdout }),
      doctor: async () => { try { await run(process.execPath, [pjoin(cwd, 'dist', 'cli.js'), 'doctor'], { encoding: 'utf8' }); return true; } catch { return false; } },
    });
    console.log(r.message);
    if (!r.ok) process.exitCode = 1;
  });

program.command('export')
  .description('Save your claims and purchases to a file (IP address left out by default)')
  .option('--json', 'JSON instead of CSV')
  .option('--with-ip', 'include your origin IP address')
  .action((o: { json?: boolean; withIp?: boolean }) => {
    requireSetup(pilotHome());
    const format = o.json ? 'json' : 'csv';
    const file = `flop-pilot-export-${new Date().toISOString().slice(0, 10)}.${format}`;
    writeFileSync(file, runExport(pilotHome(), { format, withIp: !!o.withIp, network: loadConfig(pilotHome()).network }));
    console.log(`Saved ${file}`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
