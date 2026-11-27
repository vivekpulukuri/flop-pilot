import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { KeyringPair, Network } from '../core/types.js';

export interface Wallet { network: Network; index: number; address: string; pair: KeyringPair; }

export function derivationPath(network: Network, index: number): string {
  return `//flop-agent//${network}//${index}`;
}

/** sr25519 hard derivations `<seed>//flop-agent//<network>//<i>`, SS58 prefix 42. */
export async function deriveWallets(seed: string, network: Network, count: number): Promise<Wallet[]> {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });
  return Array.from({ length: count }, (_, index) => {
    const pair = keyring.addFromUri(`${seed}${derivationPath(network, index)}`);
    return { network, index, address: pair.address, pair };
  });
}
