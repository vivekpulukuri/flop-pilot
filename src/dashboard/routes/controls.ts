import { Hono } from 'hono';
import type { ChainPort, Env } from '../../core/types.js';
import type { Ledger } from '../../ledger/ledger.js';
import type { DashboardDeps } from '../server.js';
import type { gather } from '../data.js';
import { layout } from '../views.js';
import { html } from '../html.js';

type Data = Awaited<ReturnType<typeof gather>>;

export function controlRoutes(_deps: DashboardDeps, _chain: () => Promise<ChainPort | null>) {
  return new Hono();
}

export function controlsPage(d: Data, _l: Ledger, _env: Env, autopilotOn: boolean | null): string {
  return layout(d, '/controls', 'Controls', html`<p class="empty">Controls are coming in the next step.</p>`, autopilotOn);
}
