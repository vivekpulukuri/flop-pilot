import { randomBytes } from 'node:crypto';
import { serve } from '@hono/node-server';
import type { ChainPort, Env, Network, SecretStore } from '../core/types.js';
import { loadConfig } from '../core/config.js';
import { paths } from '../core/paths.js';
import { openLedger } from '../ledger/ledger.js';
import { createApp } from '../dashboard/server.js';
import { schedulerFor } from '../autopilot/scheduler.js';
import { currentPlat } from '../platform/secrets.js';
import { realExec } from '../sys/exec.js';
import { openUrlCommand, tunnelHint } from '../sys/env.js';

export async function serveDashboard(o: { home: string; env: Env; store: SecretStore | undefined; makeChain: (n: Network) => Promise<ChainPort>; open: boolean }): Promise<void> {
  const c = loadConfig(o.home);
  const token = randomBytes(24).toString('base64url');
  const app = createApp({
    home: o.home, env: o.env, token, port: c.dashboardPort, store: o.store,
    ledgerOf: () => openLedger(paths(o.home).ledger),
    chainOf: () => o.makeChain(loadConfig(o.home).network),
    autopilotLoaded: () => schedulerFor(currentPlat(), realExec).isInstalled(o.home),
  });
  await new Promise<void>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: c.dashboardPort }, () => resolve());
    server.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'EADDRINUSE' ? new Error(`Port ${c.dashboardPort} is busy. Is the dashboard already open in another window?`) : e));
  });
  const url = `http://127.0.0.1:${c.dashboardPort}/?t=${token}`;
  console.log(`Dashboard running at ${url}\nKeep this window open while you use it. Press Ctrl+C to close it.`);
  const cmd = openUrlCommand(url, currentPlat(), process.env);
  if (!cmd) console.log(tunnelHint(c.dashboardPort));
  else if (o.open) realExec(cmd.file, cmd.args).catch(() => console.log('Could not open a browser; paste the link above into one.'));
}
