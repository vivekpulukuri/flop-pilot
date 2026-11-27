# FLOP Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS CLI, an autopilot and a local dashboard. Together they derive up to 3 FLOP agent
wallets from one seed, claim the testnet faucet grant within its rules, enroll the wallets as agents, spend every
grant on inference from independent miners, and show and control everything at `127.0.0.1`. Ship a novice
setup guide alongside.

**Architecture:** A single Node 22+ TypeScript (ESM) package, `flop-pilot`.
- Pure decision functions (claim guard, budget, independence, backoff) sit behind thin adapters ("ports") for
  the FLOP SDK, the faucet, the Keychain, the OS and HTTP, so the decision logic is tested with fakes.
- A SQLite ledger in `~/.flop-pilot/` records every action. A launchd job runs `flop-pilot tick` every 15 min.
- A Hono server renders the dashboard from the same ledger and the same action functions.

**Tech stack:**
- `@flop-labs/sdk@0.13.1` (exact pin), `@polkadot/keyring` and `@polkadot/util-crypto` (versions as resolved by
  the SDK);
- `commander`, `better-sqlite3`, `hono` + `@hono/node-server`, `diff`, `uplot`;
- `vitest`, `typescript`;
- macOS `security`, `launchctl`, `osascript`.

**Spec:** `docs/superpowers/specs/2026-11-27-flop-pilot-design.md`. Read it before any task; section numbers
below (§x.y) refer to it.

## Global Constraints

- Node `>=22` (`"engines": {"node": ">=22"}`), macOS only, TypeScript `"module": "NodeNext"`, ESM.
- `@flop-labs/sdk` is pinned to exactly `0.13.1` (no `^`). `npm ci` against the committed lockfile.
- Testnet: genesis `0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800`, RPC `wss://testnet.flop.network`, faucet `https://faucet.flop.network`, SS58 prefix `42`, 18 decimals.
- Devnet: RPC `wss://rpc.devnet.flop.network`, faucet `https://faucet.devnet.flop.network`.
- Derivation path `<seed>//flop-agent//<network>//<index>`, sr25519. Seed is 24 words.
- `HARD_CLAIM_CAP = 3` accepted-or-pending claims per rolling 24 h per network, whatever the IP. Claiming wallets can be set from 1 to 3.
- Data dir `~/.flop-pilot/` (override with env `FLOP_PILOT_HOME`). Dirs `0700`, secret files (`vault.json`, `intents/*.json`) `0600`.
- The seed and private keys never appear in logs, the ledger, the dashboard, exports or error messages.
- Faucet: never retry a refusal in a loop. An `unknown` outcome is resent with the **same nonce and the same stored signature**.
- Practice mode is ON after `init`. In practice mode, nothing makes a faucet POST or submits an extrinsic.
- No spend goes to a miner whose independence result isn't `independent`. The gateway/API-key route is never used to spend.
- The dashboard binds `127.0.0.1` only and needs the per-run token. All HTML output is escaped.
- Outbound HTTP uses `User-Agent: flop-pilot/<version>` and sends no user data.
- Amounts are stored as planck `TEXT` (bigint strings). Timestamps are stored as ISO-8601 UTC.
- No self-update. `flop-pilot update` runs only when the user invokes it, and checks out release tags only.
- **Git:** commit after each task as the owner's git identity with **no Claude co-author trailer**. Push to `github.com/vivekpulukuri/flop-pilot` (public) once, after the final review. No tags until the owner asks.

## Review Focus

1. **Mac sleeps or the process is killed between signing and recording** (mid-claim or mid-purchase). The next tick must resend the identical claim (same nonce and signature) and resume the saved intent without re-preparing. Tests are in Task 8 and Task 11.
2. **The chain upgrades to a runtime the SDK doesn't support, during autopilot.** The tick pauses, sends one alert (not one per tick), and makes no claims or spends until the SDK is updated. Test is in Task 13.
3. **Offline or timeouts** (RPC, faucet or IP lookup failing mid-tick). The tick ends cleanly with the error recorded, no half-written state, and the lock released. Test is in Task 13.
4. **Untrusted text in the dashboard.** Miner inference output, watched page diffs and faucet reason strings can contain `<script>`, and must render escaped. Test is in Task 14.
5. **Keychain unavailable** (locked, denied, or launchd running before login). The tick records a `vault_locked` alert and exits without a crash or repeat prompts. Test is in Task 13.

---

### Task 1: Devnet discovery spike (throwaway, research only)

Answers the spec's §7 unknowns before product code depends on them. No TDD: spike code goes in `spikes/`
(gitignored) and is deleted afterwards.

**Files:**
- Create: `docs/research/2026-11-27-devnet-findings.md`
- Create (untracked, throwaway): `spikes/*.ts`

**Interfaces:**
- Produces: a findings doc. For each question below it gives the answer, the evidence (command and output, or
  SDK file:line), and **the default or code path it sets in later tasks**. Tasks 6–12 read it.

- [ ] **Step 1:** Make a throwaway devnet key: `npx --yes --package @flop-labs/cli@0.9.0 flop keys generate --out spikes/key.json --password-env FLOP_KEY_PASSWORD`. Fund it through whatever devnet faucet route works.
- [ ] **Step 2:** Answer each question in the findings doc:
  1. **Miner discovery:** how to list session-serving miners and their `minerUrl` on devnet and testnet (chain storage, indexer, or gateway). → `MinerDirectory` (Task 10)
  2. **Miner links:** which on-chain accounts link to a miner (controller, stash, payout), for the independence check. → `linkedAccounts` (Task 10)
  3. **Rollover spend:** what the faucet counts as the "spend" that satisfies `rolloverRequiresSpend` (does a settled session count? does any outgoing transfer?). → `lastGrantSpent` (Task 8)
  4. **Claim before enroll:** does the faucet agent claim require an enrolled agent wallet or a DID? → claim-first order (Tasks 8–9)
  5. **DID:** is one required for the agent role on testnet, and how is it created (`flop agent credential`?)? → Task 9
  6. **Fees:** the cost of `createAgentWallet` and of a prepare+buy session. → `feeReserveFlop`, `enrollFeeFlop` defaults
  7. **Caps:** do `createAgentWallet` caps constrain `buyInferenceSession`? → whether the local ceiling is the only rail
  8. **Devnet claims:** does devnet have an agent-claim route (`/v1/testnet/agent-claims` equivalent)? If not, which call funds devnet? → `DevnetFaucet` (Task 7)
  9. **Refusal codes:** the faucet's reason codes for the per-IP and IP-range limits, and whether a reset time for `dailyCap` is published. → shared-IP guard (Task 8)
  10. **Grant finality:** how to confirm a grant is finalized (`transferStatus`, or balance at the finalized head). → `reconcileClaim` (Task 8)
  11. **Settlement:** how to read a compute channel's settlement status by `channelId`. → `channelStatus` (Task 11)
  12. **Explorer links:** the URL format for a tx or extrinsic on `testnet.flopscan.io`. → `txLink()` (Task 14)
- [ ] **Step 3:** Run one full devnet purchase end to end (claim → prepare → save intent → buy → settled) and paste the outputs into the doc.
- [ ] **Step 4:** If any answer contradicts the spec, stop and report to the owner before Task 2.
- [ ] **Step 5:** `rm -rf spikes/`. Commit the findings doc.

---

### Task 2: Project scaffold, shared types, config and units

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.nvmrc` (`22`)
- Create: `src/core/types.ts`, `src/core/config.ts`, `src/core/units.ts`, `src/core/paths.ts`, `src/cli.ts`
- Create: `tests/fakes.ts`
- Test: `tests/core/config.test.ts`, `tests/core/units.test.ts`

**Interfaces:**
- Produces (in `src/core/types.ts`):
```ts
export type Network = 'devnet' | 'testnet';
export interface Config {
  version: 1; network: Network; claimers: 1 | 2 | 3; practice: boolean; paused: boolean; killed: boolean;
  tickMinutes: number; perTxLimitFlop: number; dailyCapFlop: number; dailySpendCeilingFlop: number;
  feeReserveFlop: number; minEscrowFlop: number; enrollFeeFlop: number; myMiners: string[];
  activationBlock: Record<Network, number | null>; dashboardPort: number;
}
export interface FaucetLimits { status: string; grantFlop: number; cooldownSeconds: number; rolloverRequiresSpend: boolean;
  remainingFlop: number; usedFlop: number; limitFlop: number; ipGrantsPerDay: number; asOf: string; }
export type ClaimOutcome = 'accepted' | 'refused' | 'unavailable' | 'unknown';
export interface ClaimResult { outcome: ClaimOutcome; nonce: string; txHash?: string; reason?: string;
  action?: 'retry_later' | 'fix_request' | 'report_to_operator'; retryAfterSeconds?: number;
  transferStatus?: 'included' | 'finalized'; amountFlop?: number; }
export interface FaucetPort { chain(): Promise<{ network: string; genesisHash: string }>; limits(): Promise<FaucetLimits>;
  claim(address: string, o: { nonce: string; sign: (msg: Uint8Array) => Promise<string> }): Promise<ClaimResult>; }
export interface AgentWalletInfo { perTxLimit: bigint; dailyCap: bigint; active: boolean; }
export type ChannelStatus = 'open' | 'settlement_posted' | 'settled' | 'refunded' | 'unknown';
export interface InferenceIntent { id: string; [k: string]: unknown }   // opaque SDK intent; contains a secret
export interface BuyResult { status: 'settlement_posted'; output: string; channelId: string; gnUsed: bigint; }
export interface ChainPort {
  genesisHash(): Promise<string>; specVersion(): Promise<number>; finalizedHead(): Promise<number>;
  finalizedFreeBalance(address: string): Promise<bigint>;
  getAgentWallet(address: string): Promise<AgentWalletInfo | null>;
  createAgentWallet(pair: KeyringPair, p: { perTxLimit: bigint; dailyCap: bigint }): Promise<string>;
  deactivateWallet(pair: KeyringPair): Promise<string>;
  prepareInference(pair: KeyringPair, p: { minerUrl: string; escrowFlop: number }): Promise<InferenceIntent>;
  buyInference(pair: KeyringPair, p: { intent: InferenceIntent; prompt: string }): Promise<BuyResult>;
  channelStatus(channelId: string): Promise<ChannelStatus>; disconnect(): Promise<void>;
}
export interface MinerInfo { address: string; url: string; models: string[]; linkedAccounts: string[] | null; }
export interface MinerDirectory { list(): Promise<MinerInfo[]>; }
export interface SecretStore { get(): Promise<string | null>; set(pw: string): Promise<void>; remove(): Promise<void>; }
export interface Env { now(): Date; fetch: typeof fetch; notify(title: string, body: string): Promise<void>;
  publicIp(): Promise<string | null>; }
```
- Produces: `DEFAULT_CONFIG: Config`, with defaults `network:'devnet'`, `claimers:3`, `practice:true`, `tickMinutes:15`, `perTxLimitFlop:5`, `dailyCapFlop:11`, `dailySpendCeilingFlop:30`, `feeReserveFlop:0.5`, `minEscrowFlop:0.01`, `enrollFeeFlop:0.1`, `dashboardPort:4747` (apply the Task 1 findings to the fee defaults).
- Produces: `loadConfig(home): Config`, `saveConfig(home, c): void` (atomic write via temp file + rename), `paths(home)` returning `{ root, vault, config, ledger, intents, tasks, outputs, logs, lock }`, `pilotHome(): string` (env `FLOP_PILOT_HOME`, else `~/.flop-pilot`), `ensureDirs(home)` (mode 0700).
- Produces: `toPlanck(flop: number | string): bigint`, `fromPlanck(p: bigint, dp = 4): string`.
- Produces: `tests/fakes.ts` with `fakeEnv()`, `fakeFaucet()`, `fakeChain()`, `fakeMiners()`, `memSecretStore()`. Each records its calls in a `calls` array; later tasks extend them.

- [ ] **Step 1:** `git init` (local only, no remote). `npm init`, then add deps with exact `@flop-labs/sdk@0.13.1`. Scripts: `"build": "tsc"`, `"prepare": "tsc"`, `"test": "vitest run"`, `"bin": {"flop-pilot": "dist/cli.js"}`. `.gitignore`: `node_modules/ dist/ spikes/ .DS_Store`.
- [ ] **Step 2:** Write the failing tests:
```ts
test('toPlanck/fromPlanck', () => { expect(toPlanck('10')).toBe(10n * 10n ** 18n); expect(toPlanck(0.01)).toBe(10n ** 16n);
  expect(fromPlanck(5n * 10n ** 17n)).toBe('0.5000'); });
test('loadConfig returns DEFAULT_CONFIG when missing; save→load roundtrips', ...);
test('saveConfig never leaves a partial file (temp+rename)', ...);
test('ensureDirs creates root with mode 0700', () => expect(statSync(root).mode & 0o777).toBe(0o700));
```
- [ ] **Step 3:** Run `npx vitest run tests/core`. Expected: FAIL (modules missing).
- [ ] **Step 4:** Implement the modules. `src/cli.ts` wires `commander` with only `--version` for now (version read from `package.json`).
- [ ] **Step 5:** Run `npx vitest run tests/core && npm run build && node dist/cli.js --version`. Expected: PASS, then prints `0.1.0`.
- [ ] **Step 6:** Commit: `chore: scaffold flop-pilot with shared types and config`.

---

### Task 3: Keys: vault, Keychain, derivation

**Files:**
- Create: `src/keys/vault.ts`, `src/keys/keychain.ts`, `src/keys/derive.ts`
- Test: `tests/keys/vault.test.ts`, `tests/keys/derive.test.ts`, `tests/keys/keychain.test.ts`

**Interfaces:**
- Consumes: `paths()`, `SecretStore`, `Network`.
- Produces:
  - `encryptSeed(seed: string, password: string): VaultFile`, `decryptSeed(v: VaultFile, password: string): string`,
    `writeVault(path, v)` (0600, `wx` flag), `readVault(path): VaultFile`.
  - `VaultFile = { v: 1; kdf: 'scrypt'; N: 131072; r: 8; p: 1; salt: string; iv: string; tag: string; ct: string }`
    (base64, AES-256-GCM, scrypt `maxmem` 256 MiB).
  - `macKeychain(): SecretStore`: service `flop-pilot`, account `vault`, via `execFile('security', …)`. Never use
    a shell. `add-generic-password -U -s flop-pilot -a vault -w <pw>`, `find-generic-password -w`,
    `delete-generic-password`. On any failure it throws `VaultLockedError`.
  - `newVaultPassword(): string` = `randomBytes(32).toString('base64url')`. The user never sees it; the seed is the backup.
  - `Wallet = { network: Network; index: number; address: string; pair: KeyringPair }`
  - `deriveWallets(seed, network, count): Promise<Wallet[]>` (awaits `cryptoWaitReady()`, uses
    `Keyring({ type: 'sr25519', ss58Format: 42 })`, URI `${seed}//flop-agent//${network}//${i}`).
  - `unlockSeed(home, store): Promise<string>`.

- [ ] **Step 1:** Write the failing tests:
```ts
test('decrypt(encrypt(seed)) === seed; wrong password throws', ...);
test('vault JSON never contains any seed word', () => { for (const w of seed.split(' ')) expect(json).not.toContain(w); });
test('writeVault mode 0600 and refuses to overwrite', ...);
test('deriveWallets deterministic; testnet≠devnet addresses; 3 distinct; all start with "5"', ...);
test('macKeychain passes args via execFile array (no shell); maps nonzero exit to VaultLockedError', ...); // execFile injected
```
Fixture: one fixed 24-word mnemonic, generated once with `mnemonicGenerate(24)` and committed in
`tests/fixtures/seed.ts`. It is test-only and never funded.
- [ ] **Step 2:** Run `npx vitest run tests/keys`. Expected: FAIL.
- [ ] **Step 3:** Implement the three modules (`node:crypto` `scryptSync`, `createCipheriv('aes-256-gcm')`).
- [ ] **Step 4:** Run `npx vitest run tests/keys`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(keys): encrypted seed vault, keychain store, wallet derivation`.

---

### Task 4: Ledger (SQLite)

**Files:**
- Create: `src/ledger/db.ts` (open + migrations), `src/ledger/ledger.ts` (typed repo)
- Test: `tests/ledger/ledger.test.ts`

**Interfaces:**
- Produces `openLedger(path): Ledger`, using `better-sqlite3` with WAL, `user_version` migrations, and the tables
  from §4.9 plus `state(key TEXT PRIMARY KEY, value TEXT)`. Column names as in §4.9, plus:
  - `claims.status` (`pending` | `accepted` | `refused` | `unavailable` | `unknown` | `finalized`),
    `claims.balance_before`, `claims.mode`;
  - `spends.status` (`prepared` | `settlement_posted` | `settled` | `refunded` | `unconfirmed` | `failed`),
    `spends.mode`, `spends.task_id`, `spends.score`;
  - `alerts.dedupe_key`.
- `Ledger` methods:
```ts
upsertWallet(w: { network; index; address; claimer: boolean }): void; listWallets(n): WalletRow[];
setWalletFlags(n, index, p: Partial<{ enrolled: boolean; stopped: boolean; claimer: boolean }>): void;
insertClaim(r: NewClaim): number; updateClaim(id, p: Partial<ClaimRow>): void;
claimsSince(n, since: Date): ClaimRow[]; lastClaim(n, index): ClaimRow | null; claimsByStatus(n, s: string[]): ClaimRow[];
insertSpend(r: NewSpend): number; updateSpend(id, p: Partial<SpendRow>): void;
spendsByStatus(n, s: string[]): SpendRow[]; spendsSince(n, since: Date, index?: number): SpendRow[];
startTick(mode): number; finishTick(id, summary: object, errors: string[]): void; lastTick(): TickRow | null;
addAlert(kind, message, dedupeKey?): { created: boolean; id: number }; listAlerts(onlyOpen?: boolean): AlertRow[]; ackAlert(id): void;
getState<T>(key): T | null; setState(key, value: unknown): void;
lastSnapshot(url): SnapshotRow | null; insertSnapshot(url, hash, text): void;
activity(n, f: { type?: 'claim' | 'spend'; index?: number; outcome?: string; limit: number }): ActivityRow[];
```

- [ ] **Step 1:** Write the failing tests:
```ts
test('claimsSince counts only rows with ts >= since (UTC ISO)', ...);
test('addAlert with same open dedupeKey → created:false; after ack → created:true', ...);
test('amounts roundtrip as bigint strings: "10000000000000000000"', ...);
test('networks isolated: testnet claims invisible to devnet queries', ...);
test('reopen runs no duplicate migrations (user_version stable)', ...);
```
- [ ] **Step 2:** Run `npx vitest run tests/ledger`. Expected: FAIL.
- [ ] **Step 3:** Implement with prepared statements (all queries parameterized).
- [ ] **Step 4:** Run `npx vitest run tests/ledger`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(ledger): sqlite ledger with claims, spends, ticks, alerts, state`.

---

### Task 5: `init`, `wallets`, `practice`, `network` commands

**Files:**
- Create: `src/commands/init.ts`, `src/commands/wallets.ts`, `src/commands/settings.ts`
- Modify: `src/cli.ts`
- Test: `tests/commands/init.test.ts`, `tests/commands/settings.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `runInit(o: { home; network: Network; restore: boolean; io: PromptIO; store: SecretStore; rng?: () => number }): Promise<void>`
  - `PromptIO = { print(s): void; ask(q): Promise<string>; clear(): void }` (real version uses `node:readline/promises`).
  - `setPractice(home, on)`, `setNetwork(home, n)` (derives and upserts wallets for `n`), `setClaimers(home, k)`
    (rejects anything outside 1–3 with "The faucet allows 3 claims per internet connection per day").
  - `listWalletsCmd(home, chain?)`.
- `init` flow:
  1. Refuse if the vault exists ("already set up; use `--restore` on a fresh install").
  2. Generate or validate the seed with `mnemonicGenerate(24)` or `mnemonicValidate`.
  3. Print it as a numbered grid, with the warning "Write these 24 words on paper. Anyone with them controls your
     wallets. Never type them into a website."
  4. Wait for Enter, then `clear()`.
  5. Ask for 3 random positions. Allow 3 attempts, then abort **without writing anything**.
  6. `store.set(newVaultPassword())`, `writeVault`, save the config with `practice: true`, upsert wallets
     (claimer = index < claimers).

- [ ] **Step 1:** Write the failing tests:
```ts
test('wrong confirmation words ×3 → no vault file, no keychain set', ...);
test('success → vault 0600, store has password, config.practice===true, 3 wallet rows, seed absent from ledger file bytes', ...);
test('restore with invalid mnemonic → error, nothing written', ...);
test('setClaimers(4) throws with faucet message; setClaimers(2) marks index 2 claimer=false', ...);
test('setNetwork("testnet") upserts testnet wallets, devnet rows unchanged', ...);
```
- [ ] **Step 2:** Run `npx vitest run tests/commands`. Expected: FAIL.
- [ ] **Step 3:** Implement, and wire the `init [--restore] [--network]`, `wallets`, `practice on|off`, `network <n>` and `claimers <k>` commands.
- [ ] **Step 4:** Run `npx vitest run tests/commands`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(cli): init with seed confirmation, wallets, practice, network`.

---

### Task 6: Chain and system adapters, plus `doctor`

**Files:**
- Create: `src/chain/sdk-chain.ts`, `src/sys/env.ts` (notify, publicIp, fetch with UA), `src/commands/doctor.ts`
- Test: `tests/sys/env.test.ts`, `tests/commands/doctor.test.ts`

**Interfaces:**
- Produces:
  - `createSdkChain(n: Network): Promise<ChainPort>`. It uses `FlopClient.createWithKeypair(rpc, pair)` (one
    client per pair, cached) and the SDK `agent-wallet` functions. `specVersion` comes from
    `api.runtimeVersion.specVersion`. It refuses to start if `genesisHash` doesn't match the pinned testnet
    genesis. For `channelStatus`, use the method from the Task 1 findings.
  - `isSupportedSpec(v: number): boolean` (from SDK `SUPPORTED_SPEC_VERSIONS`).
  - `realEnv(): Env`:
    - `notify` runs `execFile('osascript', ['-e','on run argv','-e','display notification (item 2 of argv) with title (item 1 of argv)','-e','end run', title, body])`;
    - `publicIp` fetches `https://api.ipify.org?format=json` with a 5 s timeout, returning `null` on failure;
    - `fetch` adds the UA header.
  - `runDoctor(deps): Promise<Check[]>`, where `Check = { name; ok: boolean; fix?: string }`. Checks: Node ≥22,
    macOS, Keychain item, vault decrypts, RPC reachable, genesis match, spec supported, faucet `/chain` genesis
    match, LaunchAgent loaded (warn only), ledger writable.

- [ ] **Step 1:** Write the failing tests:
```ts
test('notify passes title/body as argv, never interpolated into script', ...);   // execFile injected
test('publicIp returns null on timeout, never throws', ...);
test('doctor: unsupported spec → check fails with fix "Run: flop-pilot update"', ...);
test('doctor: faucet genesis mismatch → fails with "Faucet is not FLOP Testnet — stop"', ...);
```
- [ ] **Step 2:** Run `npx vitest run tests/sys tests/commands/doctor.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement, and wire `doctor` (prints a ✓/✗ table plus fix lines).
- [ ] **Step 4:** Run the same tests (Expected: PASS). Then run a manual smoke test, `node dist/cli.js doctor`, against devnet. Expected: RPC and genesis checks pass.
- [ ] **Step 5:** Commit: `feat: sdk chain adapter, system env, doctor`.

---

### Task 7: Faucet adapter and claim guard (pure)

**Files:**
- Create: `src/faucet/sdk-faucet.ts`, `src/faucet/guard.ts`
- Test: `tests/faucet/guard.test.ts`, `tests/faucet/sdk-faucet.test.ts`

**Interfaces:**
- Produces:
  - `createFaucet(n: Network, env: Env): FaucetPort`.
    - Testnet `claim` calls SDK `claimTestnetAgentFunds(address, { nonce, sign })` and maps its result to `ClaimResult`.
    - `limits()` parses `/limits` (`faucet.status`, `faucet.agent.*`, `faucet.dailyCap.*`, `faucet.perClient.ipGrantsPerDay`).
    - The devnet funding route comes from the Task 1 findings.
  - `HARD_CLAIM_CAP = 3`
  - `decideClaim(i: ClaimGuardInput): { ok: true } | { ok: false; reason: SkipReason; until?: Date }`
```ts
interface ClaimGuardInput { now: Date; wallet: { claimer: boolean; stopped: boolean };
  claims24h: number; lastAcceptedAt: Date | null; lastGrantSpent: boolean; hasUnresolved: boolean;
  backoffUntil: Date | null; sharedIpPauseUntil: Date | null; claimsStopped: boolean; limits: FaucetLimits; }
type SkipReason = 'not_claimer' | 'wallet_stopped' | 'claims_stopped' | 'unresolved_pending' | 'shared_ip_pause'
  | 'backoff' | 'global_cap' | 'cooldown' | 'rollover_unspent' | 'faucet_closed' | 'pool_empty';
```
  Checks run in that order, and the first failure wins. The `cooldown` check uses `limits.cooldownSeconds`.
  `pool_empty` means `remainingFlop < grantFlop`.
  - `nextBackoff(attempt: number): number` (ms) → 1 h, 2 h, 4 h, then 6 h for every attempt after that.
  - `detectPoolReset(prev: FaucetLimits, curr: FaucetLimits): Date | null` returns `new Date(curr.asOf)` when `curr.usedFlop < prev.usedFlop`.

- [ ] **Step 1:** Write the failing tests (one per reason, with exact boundaries):
```ts
test('claims24h=3 → global_cap', ...);
test('lastAcceptedAt = now-86399s → cooldown; now-86400s → ok', ...);
test('remainingFlop=9, grantFlop=10 → pool_empty; 10 → ok', ...);
test('status "paused" → faucet_closed', ...);
test('rolloverRequiresSpend && !lastGrantSpent → rollover_unspent; first-ever claim (lastAcceptedAt null) → ok', ...);
test('hasUnresolved → unresolved_pending (beats cooldown)', ...);
test('nextBackoff: [1,2,4,6,6] hours', ...);
test('detectPoolReset: used 10435850→1200 returns curr.asOf; increase returns null', ...);
test('sdk-faucet maps SDK {outcome:"refused",action:"retry_later",retryAfterSeconds:3600} → ClaimResult', ...); // SDK fn injected
```
- [ ] **Step 2:** Run `npx vitest run tests/faucet`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run tests/faucet`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(faucet): faucet adapter and pure claim guard`.

---

### Task 8: Claim flow, reconciliation, and the `fund` command

**Files:**
- Create: `src/faucet/claim.ts`, `src/commands/fund.ts`
- Test: `tests/faucet/claim.test.ts`

**Interfaces:**
- Consumes: `decideClaim`, `nextBackoff`, `Ledger`, `FaucetPort`, `ChainPort`, `Wallet`, `Env`.
- Produces:
  - `type ActionResult = { kind: 'done' | 'simulated' | 'skipped' | 'failed'; detail: string; reason?: string }`
    (shared with Tasks 9 and 11).
  - `claimWallet(ctx: Ctx, w: Wallet, ports: { faucet; chain }): Promise<ActionResult>`, where
    `Ctx = { home; config; ledger; env; network }`.
  - `reconcileClaims(ctx, ports): Promise<void>`
  - `lastGrantSpent(ctx, index): boolean`, using the rule from the Task 1 findings. The working default: at least
    one `spends` row with status `settled`, created after the wallet's last finalized claim.
- `claimWallet` order:
  1. Build the guard input from the ledger, `faucet.limits()` and state keys `backoff:<index>`,
     `sharedIpPauseUntil` and `claimsStopped`.
  2. If skipped, return `skipped` with the reason.
  3. In practice mode, return `simulated` ("would claim 10 FLOP for wallet N"). **Make no POST.**
  4. `insertClaim` with status `pending`, the nonce (`Date.now().toString()`), the public IP and
     `balance_before`.
  5. Call `faucet.claim`. The `sign` callback signs with `w.pair`, **saves the signature with `updateClaim` before
     returning it**, then returns the hex. That makes it write-ahead.
  6. Map the outcome:
     - `accepted` → `accepted`.
     - `unknown`, or any thrown error/network failure → `unknown`.
     - `unavailable` → set `backoff:<index>` from `nextBackoff`.
     - `refused`:
       - `retry_later`: backoff until `retryAfterSeconds` (default 1 h).
       - `fix_request`: stop the wallet and send an alert.
       - `report_to_operator`: set `claimsStopped` and send an alert.
       - An IP-limit reason code (from the findings) sets `sharedIpPauseUntil` = now + 24 h and sends an alert
         with the exact text from spec §4.3.
- `reconcileClaims`:
  - For `unknown` rows, resend with the **stored nonce and stored signature** (`sign` returns the stored value and
    never signs again).
  - For `accepted` rows, mark them `finalized` when `transferStatus === 'finalized'`, or when
    `finalizedFreeBalance >= balance_before + grant` (or by the method from the findings).

- [ ] **Step 1:** Write the failing tests:
```ts
test('practice mode: faucet.claim never called; no claims row', ...);
test('signature persisted before POST: faucet fake throws ECONNRESET → row unknown with signature set', ...);
test('REVIEW-FOCUS-1: reconcile of unknown resends identical nonce+signature and pair.sign not called again', ...);
test('refused retry_later 3600 → backoff state = now+3600s; second call same tick → skipped backoff, no POST', ...);
test('refused report_to_operator → claimsStopped; other wallets skipped claims_stopped', ...);
test('IP-limit refusal → sharedIpPauseUntil=now+24h and alert text matches spec §4.3', ...);
test('4th claim in 24h across wallets → skipped global_cap, no POST', ...);
```
- [ ] **Step 2:** Run `npx vitest run tests/faucet/claim.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement, and wire `fund [--wallet N] [--dry-run]`. It prints each wallet's `ActionResult` in plain English.
- [ ] **Step 4:** Run `npx vitest run tests/faucet`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(faucet): write-ahead claim flow with reconciliation and fund command`.

---

### Task 9: Enrollment

**Files:**
- Create: `src/enroll/enroll.ts`, `src/commands/enroll.ts`
- Test: `tests/enroll/enroll.test.ts`

**Interfaces:**
- Produces: `enrollWallet(ctx, w, chain): Promise<ActionResult>`.
  1. If `getAgentWallet` reports active, mark the wallet `enrolled` and skip.
  2. If `finalizedFreeBalance < toPlanck(enrollFeeFlop)`, return `skipped: needs_funds`.
  3. In practice mode, return `simulated`.
  4. Otherwise call `createAgentWallet(pair, { perTxLimit: toPlanck(perTxLimitFlop), dailyCap: toPlanck(dailyCapFlop) })`
     and mark it enrolled.
- Add DID creation **only if** the Task 1 findings say it is required: one DID per install, stored in `state`
  under `did`, and every wallet links to it. Never one per wallet.

- [ ] **Step 1:** Write the failing tests:
```ts
test('0 balance → skipped needs_funds, no extrinsic', ...);
test('already active → enrolled flag set, no extrinsic', ...);
test('caps passed as planck: perTxLimit 5e18, dailyCap 11e18', ...);
test('practice → simulated, no extrinsic', ...);
```
- [ ] **Step 2:** Run `npx vitest run tests/enroll`. Expected: FAIL.
- [ ] **Step 3:** Implement, and wire `enroll`.
- [ ] **Step 4:** Run `npx vitest run tests/enroll`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(enroll): agent wallet enrollment with caps`.

---

### Task 10: Miner directory and independence check

**Files:**
- Create: `src/spend/miners.ts`, `src/spend/independence.ts`
- Test: `tests/spend/independence.test.ts`, `tests/spend/miners.test.ts`

**Interfaces:**
- Produces:
  - `createMinerDirectory(n, chain, env): MinerDirectory`, using the mechanism from the Task 1 findings.
    `linkedAccounts` is `null` when it can't be determined.
  - `type Independence = 'independent' | 'own_address' | 'declared_own' | 'linked' | 'unverified'`
  - `checkIndependence(m: MinerInfo, own: Set<string>, declared: Set<string>): Independence`. Checks run in this
    order: own address, declared, null links → `unverified`, any linked account in `own ∪ declared` → `linked`,
    else `independent`.
  - `eligibleMiners(list, own, declared): { miner: MinerInfo; result: Independence }[]`, sorted with
    `independent` first.

- [ ] **Step 1:** Write the failing tests:
```ts
test('miner address equals own wallet → own_address', ...);
test('in config.myMiners → declared_own', ...);
test('linkedAccounts null → unverified (never independent)', ...);
test('linked stash is own wallet → linked', ...);
test('clean miner → independent', ...);
```
- [ ] **Step 2:** Run `npx vitest run tests/spend`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run tests/spend`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(spend): miner directory and independence check`.

---

### Task 11: Budget, work queue, purchases, and the `spend` command

**Files:**
- Create: `src/spend/budget.ts`, `src/spend/tasks.ts`, `src/spend/builtin-tasks.json`, `src/spend/purchase.ts`, `src/commands/spend.ts`
- Test: `tests/spend/budget.test.ts`, `tests/spend/tasks.test.ts`, `tests/spend/purchase.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 8 (`ActionResult`, `Ctx`), 10.
- Produces:
  - `planSessions(balance: bigint, reserve: bigint, perTx: bigint, minEscrow: bigint, ceilingLeft: bigint): bigint[]`
    splits `min(balance − reserve, ceilingLeft)` into chunks of at most `perTx`, and drops a remainder smaller
    than `minEscrow`.
  - `Task = { id: string; prompt: string; expectKeywords?: string[]; source: 'user' | 'builtin' }`
  - `nextTask(home): Task` takes the oldest `.txt`/`.md` in `tasks/`. When there are none, it takes the next item
    from `builtin-tasks.json` (round-robin through state key `builtinCursor`). The built-in set is 20 short
    factual Q&A items with `expectKeywords`.
  - `scoreOutput(t, output): number | null` is the fraction of `expectKeywords` present, ignoring case.
  - `spendWallet(ctx, w, ports: { chain; miners }): Promise<ActionResult[]>`. It requires the wallet to be enrolled
    and its last claim finalized. It passes `ceilingLeft = toPlanck(dailySpendCeilingFlop) − Σ escrow` over
    `spendsSince(now − 24 h)` across all wallets, and the reserve is `toPlanck(feeReserveFlop)`.
  - `purchaseOne(ctx, w, miner, escrow, task, chain): Promise<ActionResult>` runs in this order:
    1. `prepareInference`.
    2. Write `intents/<intent.id>.json` (flag `wx`, mode 0600).
    3. `insertSpend` with status `prepared`, the independence result, IP and mode.
    4. `buyInference`.
    5. Write `outputs/<ts>-<intent.id>.md`.
    6. `updateSpend` to `settlement_posted`, plus `channelId`, `gnUsed` and `score`.
    7. Move a user task file to `tasks/done/`.
  - `resumeSpends(ctx, wallets, chain): Promise<void>`:
    - `prepared` rows: buy with the **saved intent file**. Never call `prepareInference`.
    - `settlement_posted` rows: poll `channelStatus`, and move to `settled` or `refunded`.
    - The SDK error `INFERENCE_PURCHASE_UNCONFIRMED` → `unconfirmed` plus an alert. Never re-prepare.
- No miner whose result is `independent` → return `skipped: no independent miner` (log the count found and the results).

- [ ] **Step 1:** Write the failing tests:
```ts
test('planSessions(10.2e18, 0.5e18, 5e18, 0.01e18, 30e18) → [5e18, 4.7e18]', ...);
test('planSessions(10.2e18, 0.5e18, 5e18, 0.01e18, 3e18) → [3e18]', ...);   // capped by ceilingLeft
test('remainder < minEscrow dropped', ...);
test('nextTask prefers user files; falls back to builtin round-robin', ...);
test('practice → simulated "would spend X FLOP to miner Y", no prepare/buy calls', ...);
test('only unverified miners → skipped, no chain calls', ...);
test('REVIEW-FOCUS-1: crash after intent persisted (buy throws) → resumeSpends buys with same intent, prepare call count stays 1', ...);
test('intent file mode 0600; output file written; spends row settlement_posted with channelId', ...);
```
- [ ] **Step 2:** Run `npx vitest run tests/spend`. Expected: FAIL.
- [ ] **Step 3:** Implement, and wire `spend [--wallet N] [--dry-run]`.
- [ ] **Step 4:** Run `npx vitest run tests/spend`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(spend): budgeted inference purchases with resumable intents and work queue`.

---

### Task 12: Watchers (earning-start alarm, rules, runtime)

**Files:**
- Create: `src/watchers/pagewatch.ts`, `src/watchers/runtime.ts`, `src/watchers/mode.ts`
- Test: `tests/watchers/watchers.test.ts`

**Interfaces:**
- Produces:
  - `ACTIVATION_PAGES = ['https://docs.flop.network/networks/testnet', 'https://docs.flop.network/docs/testnet-and-timeline?network=testnet']`
    are checked every 60 min. `RULES_PAGES = ['https://flop.finance/testnet/', 'https://flop.finance/airdrop/']`
    are checked every 24 h.
  - `pageText(html): string` strips `<script>`/`<style>` blocks and tags, decodes entities and collapses whitespace.
  - `checkPage(ctx, url, kind: 'activation' | 'rules'): Promise<{ changed: boolean; diff?: string }>`:
    - The first ever fetch stores a snapshot and sends no alert.
    - A changed sha256 stores a new snapshot, builds `diffLines` text and calls `addAlert(kind, …, dedupeKey=url+hash)`.
      Only a newly created alert triggers `env.notify`.
    - Fetch failures are recorded in the tick errors, and the run continues.
  - `checkRuntime(ctx, chain): Promise<'ok' | 'upgraded' | 'unsupported'>` compares with state `lastSpec`:
    - `unsupported` sets `config.paused`, and alerts with dedupeKey `unsupported:<spec>` and the text
      "FLOP upgraded the chain. Run: flop-pilot update".
    - `upgraded` (still supported) sends an info alert.
  - `currentMode(ctx, chain): Promise<'standby' | 'earning'>` returns `earning` when
    `activationBlock[network] != null && finalizedHead >= activationBlock[network]`.
  - `setActivationBlock(home, n, block)`, plus the CLI command `activation <block>`.

- [ ] **Step 1:** Write the failing tests:
```ts
test('first fetch: snapshot stored, no alert', ...);
test('changed text → alert + notify once; same change next run → no second notify', ...);
test('markup-only change (same text) → no alert', ...);
test('unsupported spec → paused + one alert across two calls', ...);
test('mode earning iff finalizedHead >= activationBlock', ...);
```
- [ ] **Step 2:** Run `npx vitest run tests/watchers`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run tests/watchers`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(watchers): activation, rules and runtime watchers with deduped alerts`.

---

### Task 13: Tick orchestration, lock, launchd, kill switch

**Files:**
- Create: `src/autopilot/tick.ts`, `src/autopilot/lock.ts`, `src/autopilot/launchd.ts`, `src/commands/autopilot.ts`
- Test: `tests/autopilot/tick.test.ts`, `tests/autopilot/lock.test.ts`, `tests/autopilot/launchd.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `runTick(deps: { home; env; store: SecretStore; makeChain; makeFaucet; makeMiners }): Promise<TickSummary>`
    with `TickSummary = { mode; actions: ActionResult[]; errors: string[]; skippedAll?: string }`.
  - The order is fixed by §4.5:
    1. If `killed`, exit.
    2. Acquire the lock.
    3. Unlock the vault. `VaultLockedError` → alert `vault_locked` (dedupe), then exit.
    4. Faucet `/chain` genesis check and `limits()`. Store the previous `limits` in state `lastLimits`. When
       `detectPoolReset` returns a date, save it to state `poolResetAt`.
    5. Chain connect and `checkRuntime`. If `unsupported`, stop here. Otherwise `currentMode`, then `startTick(mode)`.
    6. Record `publicIp`.
    7. If not `paused`: `reconcileClaims`, `resumeSpends`, then `claimWallet` for each claimer, then
       `enrollWallet` for each unenrolled wallet with a finalized claim, then `spendWallet` for each enrolled
       wallet.
    8. Run the watchers.
    9. `finishTick`, release the lock, and disconnect in `finally`.
    Each step is wrapped so one failure records an error and later independent steps still run. Claims are
    never attempted after a faucet genesis mismatch.
  - `acquireLock(path): boolean` writes the pid with `wx`. A stale lock (pid not alive per `process.kill(pid, 0)`)
    is replaced. `releaseLock(path)`.
  - `renderPlist(o: { nodePath; cliPath; home; intervalSec }): string` uses label `io.floppilot.autopilot`,
    `StartInterval` = `intervalSec`, `RunAtLoad` true, `ProgramArguments` `[nodePath, cliPath, 'tick']`,
    `EnvironmentVariables.FLOP_PILOT_HOME`, and stdout/stderr going to `logs/autopilot.log`.
  - `autopilotOn()` writes `~/Library/LaunchAgents/io.floppilot.autopilot.plist` and runs
    `launchctl bootstrap gui/<uid>`. It also clears `killed`.
  - `autopilotOff()` runs `launchctl bootout`.
  - `stopAll(home, { deactivate })` sets `killed` + `paused`, calls `autopilotOff()`, and with `--deactivate` asks
    "Type DEACTIVATE to confirm" before calling `deactivateWallet` on each enrolled wallet.
  - The CLI gets `tick`, `autopilot on|off|status`, `stop [--deactivate]`, `pause` and `resume`.

- [ ] **Step 1:** Write the failing tests:
```ts
test('killed → returns immediately, no lock, no network calls', ...);
test('second concurrent tick → lock held → exits "already running"', ...);
test('stale lock (dead pid) is replaced', ...);
test('REVIEW-FOCUS-2: unsupported spec → no claim/spend calls; one alert after two ticks', ...);
test('REVIEW-FOCUS-3: chain connect throws ETIMEDOUT → tick row has error, lock released, no claims rows half-written', ...);
test('REVIEW-FOCUS-5: store.get throws VaultLockedError → alert vault_locked once, tick exits cleanly', ...);
test('paused → watchers run, no claim/spend/reconcile calls', ...);
test('happy path order: claim → (finalized) → enroll → spend, using fakes', ...);
test('renderPlist contains StartInterval 900, label, absolute node path, FLOP_PILOT_HOME', ...);
```
- [ ] **Step 2:** Run `npx vitest run tests/autopilot`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run tests/autopilot`. Expected: PASS.
- [ ] **Step 5:** Manual check (devnet, practice on): `node dist/cli.js autopilot on`, wait 1 interval, then `tail ~/.flop-pilot/logs/autopilot.log`. Expected: a tick summary with `simulated` actions. Finish with `autopilot off`.
- [ ] **Step 6:** Commit: `feat(autopilot): tick orchestration, lock, launchd, kill switch`.

---

### Task 14: Dashboard server, auth and read-only pages

**Files:**
- Create: `src/dashboard/server.ts`, `src/dashboard/auth.ts`, `src/dashboard/html.ts`, `src/dashboard/views/{layout,overview,wallets,activity,spending,rules}.ts`, `src/dashboard/public/{app.js,style.css}`, `src/commands/dashboard.ts`
- Test: `tests/dashboard/auth.test.ts`, `tests/dashboard/views.test.ts`

**Interfaces:**
- Produces:
  - `createApp(deps: { home; env; ledgerOf: () => Ledger; chainOf: () => Promise<ChainPort>; token: string; port: number }): Hono`
  - `esc(s: unknown): string` escapes `& < > " '`. Every view interpolation goes through `esc` or the `html```
    tagged template, which auto-escapes.
  - `txLink(n, hash): string` uses the format from the Task 1 findings.
  - `serveDashboard(home)` binds `127.0.0.1:<dashboardPort>`, makes the token with `randomBytes(24)`, runs
    `open http://127.0.0.1:<port>/?t=<token>`, and keeps running until Ctrl+C.
- Auth:
  - `GET /?t=<token>` sets an HttpOnly, SameSite=Strict cookie and redirects to `/`. Any request without the
    cookie gets 401.
  - A `Host` other than `127.0.0.1:<port>` or `localhost:<port>` gets 403 (DNS rebinding).
  - Non-GET requests need `Origin` equal to the server origin, else 403.
- Pages follow §4.10: Overview, Wallets (with a 30-day uPlot chart from `/api/series/:index`), Activity (with
  filters), Spending (miners and independence results, outputs, queue), and Rules & alerts.
  - uPlot is served from `node_modules/uplot/dist/` under `/static/`.
  - The IP column is shown in full on the dashboard. Export redacts it (Task 15).

- [ ] **Step 1:** Write the failing tests:
```ts
test('no cookie → 401; ?t=wrong → 401; ?t=right → 302 + cookie', ...);
test('Host evil.com → 403', ...);
test('POST with Origin http://evil.com → 403', ...);
test('REVIEW-FOCUS-4: inference output "<script>alert(1)</script>" renders as &lt;script&gt; on Spending page', ...);
test('REVIEW-FOCUS-4: rules diff and faucet reason strings escaped on Rules and Activity pages', ...);
test('Overview shows mode, next claim time per wallet, pool remaining, observed pool reset (state poolResetAt), open alerts', ...);
test('vault seed never in any rendered page (render all pages with a seeded fixture, assert no seed word)', ...);
```
- [ ] **Step 2:** Run `npx vitest run tests/dashboard`. Expected: FAIL.
- [ ] **Step 3:** Implement with Hono `app.request()` in the tests (no real port). The pages are server-rendered, and `app.js` only handles filters, charts and button POSTs.
- [ ] **Step 4:** Run `npx vitest run tests/dashboard`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(dashboard): local token-guarded dashboard with read-only pages`.

---

### Task 15: Dashboard controls, `update` and `export`

**Files:**
- Create: `src/dashboard/routes/controls.ts`, `src/commands/update.ts`, `src/commands/export.ts`
- Test: `tests/dashboard/controls.test.ts`, `tests/commands/update.test.ts`, `tests/commands/export.test.ts`

**Interfaces:**
- Consumes: `claimWallet`, `spendWallet`, `stopAll`, `setPractice`, `setActivationBlock`, `decideClaim`, `Ledger`.
- Produces routes (all POST, all behind the Task 14 auth):
  - `/api/pause`, `/api/resume`, `/api/stop` (body `{ confirm: 'STOP' }`), `/api/practice` (`{ on }`);
  - `/api/claim/:index`, `/api/spend/:index` (same functions and guards as the autopilot; they return the `ActionResult`);
  - `/api/settings` (validated: `claimers` 1–3, positive numbers, `tickMinutes` ≥ 5);
  - `/api/my-miners` (an SS58 list, validated with `decodeAddress`), `/api/activation` (`{ block }`), `/api/alerts/:id/ack`.
  - `GET /api/claim-status` returns, for each wallet, the `decideClaim` reason, so buttons can show why they're disabled.
- Produces:
  - `pickLatestTag(tags: string[]): string | null` picks the highest `vX.Y.Z` by semver and ignores pre-releases.
  - `runUpdate(deps)`:
    - If there's no `.git`, print the ZIP re-download steps.
    - If `git status --porcelain` is non-empty, abort ("local changes; not updating").
    - Otherwise run `git fetch --tags`, `git checkout <tag>`, `npm ci`, then `runDoctor`.
    - It never pushes, and never checks out a branch head.
  - `runExport(home, { format: 'csv' | 'json'; withIp: boolean })` writes `claims` and `spends`. The IP becomes
    `redacted` unless `withIp`. It never includes signatures, intents or the seed.

- [ ] **Step 1:** Write the failing tests:
```ts
test('POST /api/claim/0 when guard says cooldown → ActionResult skipped cooldown, no POST to faucet', ...);
test('/api/settings claimers=4 → 400 with faucet message', ...);
test('/api/stop without confirm → 400; with confirm → killed=true', ...);
test('pickLatestTag(["v0.1.0","v0.10.0","v0.9.1","v1.0.0-rc1"]) → "v0.10.0"', ...);
test('runUpdate dirty tree → aborts, no checkout', ...);   // git exec injected
test('export default redacts IP; never contains "signature" or intent fields', ...);
```
- [ ] **Step 2:** Run `npx vitest run tests/dashboard/controls.test.ts tests/commands`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add the Controls page view and wire the `update` and `export [--json] [--with-ip]` CLI commands.
- [ ] **Step 4:** Run `npx vitest run`. Expected: the whole suite PASSES.
- [ ] **Step 5:** Commit: `feat: dashboard controls, update via release tags, redacted export`.

---

### Task 16: Novice guide, README, and end-to-end devnet verification

**Files:**
- Create: `docs/SETUP.md`, `README.md`, `docs/TROUBLESHOOTING.md` (linked from SETUP)

**Interfaces:**
- Consumes: the final CLI surface (spec §4.11) and real outputs captured in this task.

- [ ] **Step 1: End-to-end on devnet, practice OFF.** Follow the guide's own steps on a clean `FLOP_PILOT_HOME`:
  `init --network devnet` → `doctor` → `fund` → wait for finality → `enroll` → `spend` → `dashboard`.
  Expected: one claim `finalized`, enrolled `true`, at least one spend `settlement_posted` → `settled`, and the
  output visible on the Spending page. Save the real terminal outputs for the guide.
- [ ] **Step 2: Write `docs/SETUP.md`** for people with no terminal experience, following spec §8 steps 1–10:
  - Each step has a goal line, a copy-paste block, a "You should see:" block (real output from Step 1), and an
    "If you see X → do Y" box.
  - Include the plain-language rules box: one person, one install; never run a friend's wallets; never share or
    type your 24 words anywhere; household installs split the 3 claims (for example `flop-pilot claimers 2` and
    `claimers 1`).
  - Include the "FLOP upgraded → `flop-pilot update`" routine.
  - The install commands are `git clone <YOUR-REPO-URL>` with a placeholder the owner fills in, then `cd`,
    `npm ci`, `npm link`. Also give the Download ZIP path.
- [ ] **Step 3: Write `README.md`**: what it is, a safety summary, a link to SETUP, the command list, the data
  locations (`~/.flop-pilot/`), how to uninstall (`autopilot off`, delete the Keychain item, `rm -rf ~/.flop-pilot`
  after writing down the seed), and a disclaimer ("Testnet FLOP has no value; rules are provisional; check
  flop.finance/testnet").
- [ ] **Step 4: Novice dry read.** Dispatch a fresh subagent that has seen nothing else: "You are new to computers
  and crypto. Follow docs/SETUP.md literally on a clean FLOP_PILOT_HOME (devnet, practice on). Report every step
  where you were unsure what to type or what you should see." Fix every issue it reports.
- [ ] **Step 5:** Run `npx vitest run && npm run build`. Expected: PASS, and the build has no errors.
- [ ] **Step 6:** Commit: `docs: novice setup guide, readme, troubleshooting`. Push happens after the final review (see the Git constraint).
