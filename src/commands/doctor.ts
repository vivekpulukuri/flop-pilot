import { existsSync, accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import type { ChainPort, SecretStore } from '../core/types.js';
import { loadConfig } from '../core/config.js';
import { paths } from '../core/paths.js';
import { NETWORK_PROFILES } from '../core/networks.js';
import { unlockSeed } from '../keys/vault.js';
import { protectedFolder, protectedFolderHint } from '../autopilot/launchd.js';

export interface Check { name: string; ok: boolean; warn?: boolean; detail?: string; fix?: string; }

export interface DoctorDeps {
  home: string;
  store: SecretStore;
  nodeVersion: string;
  platform: string;
  chain: () => Promise<ChainPort>;
  faucetChain: () => Promise<{ network: string; genesisHash: string }>;
  launchdLoaded: () => Promise<boolean>;
  isSupportedSpec: (v: number) => boolean;
  cliPath?: string;
  storeKind?: { kind: string; weak: boolean };
}

const STORE_NAMES: Record<string, string> = { keychain: 'macOS Keychain', dpapi: 'Windows DPAPI', 'secret-service': 'desktop keyring', 'key-file': 'key file', passphrase: 'your passphrase (typed at start)' };

export async function runDoctor(d: DoctorDeps): Promise<Check[]> {
  const out: Check[] = [];
  const c = loadConfig(d.home);
  const profile = NETWORK_PROFILES[c.network];
  const [, maj, min] = /^v?(\d+)\.(\d+)/.exec(d.nodeVersion) ?? []; const major = Number(maj ?? 0), minor = Number(min ?? 0);
  out.push({ name: 'Node.js 22.13 or newer', ok: major > 22 || (major === 22 && minor >= 13), detail: d.nodeVersion, fix: 'Install Node.js 22 LTS from https://nodejs.org' });
  out.push({ name: 'macOS', ok: d.platform === 'darwin', detail: d.platform, fix: 'flop-pilot v1 runs on macOS only' });

  const hasVault = existsSync(paths(d.home).vault);
  out.push({ name: 'Set up (init done)', ok: hasVault, fix: 'Run: npm run init' });
  if (d.storeKind) {
    out.push({ name: 'Password store', ok: true, warn: d.storeKind.weak, detail: STORE_NAMES[d.storeKind.kind] ?? d.storeKind.kind,
      fix: d.storeKind.weak ? 'This computer has no keyring, so the vault password is in ~/.flop-pilot/vault.key. Anyone who can log in as you can read it. Prefer a passphrase written on paper? Run: npm run unlock:passphrase' : undefined });
  }
  if (hasVault && c.unlock === 'passphrase') {
    out.push({ name: 'Vault unlocks', ok: true, detail: 'passphrase mode: you type it when you start' });
  } else if (hasVault) {
    try { await unlockSeed(d.home, d.store); out.push({ name: 'Vault unlocks', ok: true }); }
    catch (e) { out.push({ name: 'Vault unlocks', ok: false, detail: (e as Error).message, fix: 'Unlock your Mac Keychain, or restore with: npm run init:restore' }); }
  }

  try { accessSync(paths(d.home).root, constants.W_OK); out.push({ name: 'Data folder writable', ok: true, detail: paths(d.home).root }); }
  catch { out.push({ name: 'Data folder writable', ok: false, fix: `Check permissions on ${paths(d.home).root}` }); }

  let chain: ChainPort | null = null;
  try {
    chain = await d.chain();
    out.push({ name: 'Chain RPC reachable', ok: true, detail: profile.rpc });
    const g = await chain.genesisHash();
    out.push({ name: `Chain is FLOP ${c.network}`, ok: g === profile.genesis, detail: g, fix: 'Wrong chain — stop and check your network setting' });
    const spec = await chain.specVersion();
    out.push({ name: 'Chain version supported', ok: d.isSupportedSpec(spec), detail: String(spec), fix: 'Run: npm run update' });
  } catch (e) {
    out.push({ name: 'Chain RPC reachable', ok: false, detail: (e as Error).message, fix: 'Check your internet connection and try again' });
  } finally {
    if (chain) await chain.disconnect().catch(() => {});
  }

  try {
    const f = await d.faucetChain();
    const ok = f.network === c.network && f.genesisHash.toLowerCase() === profile.genesis;
    out.push({ name: `Faucet is FLOP ${c.network === 'testnet' ? 'Testnet' : 'Devnet'}`, ok, detail: f.genesisHash, fix: `Faucet is not FLOP ${c.network === 'testnet' ? 'Testnet' : 'Devnet'} — stop` });
  } catch (e) {
    out.push({ name: `Faucet is FLOP ${c.network === 'testnet' ? 'Testnet' : 'Devnet'}`, ok: false, detail: (e as Error).message, fix: 'Faucet unreachable; try again later' });
  }

  if (d.cliPath) {
    const blocked = protectedFolder(d.cliPath);
    out.push({ name: 'Install location works with the autopilot', ok: !blocked, detail: d.cliPath, fix: blocked ? protectedFolderHint(blocked, dirname(dirname(d.cliPath))) : undefined });
  }

  const loaded = await d.launchdLoaded().catch(() => false);
  out.push({ name: 'Autopilot installed', ok: true, warn: !loaded, detail: loaded ? 'loaded' : 'not installed', fix: loaded ? undefined : 'When ready: npm run autopilot:on' });
  return out;
}

export function formatChecks(cs: Check[]): string {
  return cs.map((c) => `${c.ok ? (c.warn ? '!' : '✓') : '✗'} ${c.name}${c.detail ? `  (${c.detail})` : ''}${(!c.ok || c.warn) && c.fix ? `\n    → ${c.fix}` : ''}`).join('\n');
}
