import type { Network } from '../core/types.js';
import { NETWORK_PROFILES } from '../core/networks.js';

/** Escapes text for HTML content and attribute values. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class Safe {
  constructor(readonly value: string) {}
  toString() { return this.value; }
}

/** Trusted markup only (never data). */
export const raw = (s: string) => new Safe(s);

function render(v: unknown): string {
  if (v instanceof Safe) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

/** Tagged template: every interpolation is escaped unless it is already `html`/`raw` output. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Safe {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Safe(out);
}

export const txLink = (n: Network, hash: string) => `${NETWORK_PROFILES[n].explorer}/transactions/${hash}`;
export const accountLink = (n: Network, address: string) => `${NETWORK_PROFILES[n].explorer}/account/${address}`;
