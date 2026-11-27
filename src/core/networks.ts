import type { Network } from './types.js';

export interface NetworkProfile { rpc: string; faucet: string; genesis: string; explorer: string; }

export const NETWORK_PROFILES: Record<Network, NetworkProfile> = {
  testnet: {
    rpc: 'wss://testnet.flop.network',
    faucet: 'https://faucet.flop.network',
    genesis: '0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800',
    explorer: 'https://testnet.flopscan.io',
  },
  devnet: {
    rpc: 'wss://rpc.devnet.flop.network',
    faucet: 'https://faucet.devnet.flop.network',
    genesis: '0x99c172c095340ace980631f9123544c6bebd4839f3437e463533422d8be2d631',
    explorer: 'https://explorer.devnet.flop.network',
  },
};
