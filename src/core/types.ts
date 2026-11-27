import type { KeyringPair } from '@polkadot/keyring/types';

export type Network = 'devnet' | 'testnet';
export const NETWORKS: readonly Network[] = ['devnet', 'testnet'];

export interface MinerEndpoint { address: string; url: string; }

export interface Config {
  version: 1;
  network: Network;
  claimers: 1 | 2 | 3;
  practice: boolean;
  paused: boolean;
  killed: boolean;
  tickMinutes: number;
  perTxLimitFlop: number;
  dailyCapFlop: number;
  dailySpendCeilingFlop: number;
  feeReserveFlop: number;
  minEscrowFlop: number;
  enrollFeeFlop: number;
  myMiners: string[];
  /** Owner-supplied miner endpoints (no public directory publishes them; see devnet findings Q1). */
  minerEndpoints: MinerEndpoint[];
  activationBlock: Record<Network, number | null>;
  dashboardPort: number;
}

export interface FaucetLimits {
  status: string;
  grantFlop: number;
  cooldownSeconds: number;
  rolloverRequiresSpend: boolean;
  remainingFlop: number;
  usedFlop: number;
  limitFlop: number;
  ipGrantsPerDay: number;
  asOf: string;
}

export type ClaimOutcome = 'accepted' | 'refused' | 'unavailable' | 'unknown';
export type RefusalAction = 'retry_later' | 'fix_request' | 'report_to_operator';

export interface ClaimResult {
  outcome: ClaimOutcome;
  nonce: string;
  txHash?: string;
  reason?: string;
  error?: string;
  action?: RefusalAction;
  retryAfterSeconds?: number;
  transferStatus?: 'included' | 'finalized';
  amountFlop?: number;
  /** HTTP status when the faucet answered; absent when the SDK refused before sending anything. */
  httpStatus?: number;
}

export interface FaucetPort {
  chain(): Promise<{ network: string; genesisHash: string }>;
  limits(): Promise<FaucetLimits>;
  claim(address: string, o: { nonce: string; sign: (msg: Uint8Array) => Promise<string> }): Promise<ClaimResult>;
}

export interface AgentWalletInfo { perTxLimit: bigint; dailyCap: bigint; active: boolean; }
export type ChannelStatus = 'open' | 'settlement_posted' | 'settled' | 'refunded' | 'unknown';
/** Opaque SDK purchase intent. Contains a session secret: persist with mode 0600, never log. */
export interface InferenceIntent { id: string; /** Miner the endpoint proved it is (the one that gets paid). */ miner?: string; channelId?: string; [k: string]: unknown }
export interface BuyResult { status: 'settlement_posted'; output: string; channelId: string; gnUsed: bigint; }

export interface ChainPort {
  genesisHash(): Promise<string>;
  specVersion(): Promise<number>;
  finalizedHead(): Promise<number>;
  finalizedFreeBalance(address: string): Promise<bigint>;
  getAgentWallet(address: string): Promise<AgentWalletInfo | null>;
  createAgentWallet(pair: KeyringPair, p: { perTxLimit: bigint; dailyCap: bigint }): Promise<string>;
  deactivateWallet(pair: KeyringPair): Promise<string>;
  prepareInference(pair: KeyringPair, p: { minerUrl: string; escrowFlop: number }): Promise<InferenceIntent>;
  buyInference(pair: KeyringPair, p: { intent: InferenceIntent; prompt: string }): Promise<BuyResult>;
  channelStatus(channelId: string): Promise<ChannelStatus>;
  /** Permissionless recovery: finalize a posted settlement or time out a stale open channel. Null if not possible yet. */
  recoverChannel(pair: KeyringPair, channelId: string): Promise<string | null>;
  /** Accounts that delegate or sponsor stake to a miner; null when it cannot be determined. */
  minerLinkedAccounts(miner: string): Promise<string[] | null>;
  /** Registered miner addresses with their model hashes. */
  registeredMiners(): Promise<{ address: string; models: string[] }[]>;
  disconnect(): Promise<void>;
}

export interface MinerInfo { address: string; url: string | null; models: string[]; linkedAccounts: string[] | null; }
export interface MinerDirectory { list(): Promise<MinerInfo[]>; }

export interface SecretStore {
  get(): Promise<string | null>;
  set(pw: string): Promise<void>;
  remove(): Promise<void>;
}

export interface Env {
  now(): Date;
  fetch: typeof fetch;
  notify(title: string, body: string): Promise<void>;
  publicIp(): Promise<string | null>;
}

export type { KeyringPair };
