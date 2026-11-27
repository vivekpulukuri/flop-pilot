# Devnet discovery findings (Task 1 spike), 2026-11-27

Method: queried live devnet and testnet RPC with `@polkadot/api` 17.0.2 (shipped with `@flop-labs/sdk@0.13.1`);
called the faucet's `/chain` and `/limits`, the hosted read-only MCP (`https://mcp.flop.network/mcp`), the
testnet gateway, flop.network/llms.txt, and the SDK source; ran one devnet funding and one enrollment with a
throwaway key. **No testnet faucet claim was made**, so the owner's 3-per-IP daily quota is untouched.

**Chain state on the day:**
- Testnet runtime moved **1014035 → 1014039** today. SDK 0.13.1 admits 1014039.
- Devnet runs 1014038.
- Testnet `modelRegistry.modelsByMiner` has **0 entries**.
- The testnet gateway `/v1/models` listed `qwen/qwen3-14b` in the morning and **0 models** later.
- So testnet inference is not live, which matches the docs.

| # | Question | Answer | Evidence | Sets |
|---|---|---|---|---|
| 1 | Miner discovery | **No public directory publishes miner endpoint URLs.** On chain: `modelRegistry.modelsByMiner` (miner → model hashes; devnet 3, testnet 0) and `minerStaking.*`. Hosted MCP `flop_list_session_offers` / `flop_find_best_miner` return miner addresses, signed offers (`minEscrow`, `expiry`) and reliability, with **no URL** (`venue: null`), and it is devnet-only ("Testnet has no hosted MCP"). The SDK's direct-session endpoint "defaults to the miner host's loopback endpoint". | live queries; SDK `compute-channel/direct-session.d.ts:56` | Task 10: `MinerDirectory` = chain registry (addresses and models) joined with an **owner-maintained endpoint list** (`config.minerEndpoints: {address, url}[]`, editable in the dashboard). A miner without a known URL is listed as `no endpoint` and never spent to. |
| 2 | Miner links | Linked accounts come from `minerStaking.delegators` / `delegatorStakeMap` and `minerStaking.sponsorPositionsByMiner` (sponsors). The miner account itself is the registry key. | devnet `api.query.minerStaking` keys | Task 10: `linkedAccounts` = delegators ∪ sponsors. If the query fails → `null` → `unverified`. |
| 3 | What "spend" unlocks the next grant | "A repeat grant needs on-chain use of the previous one (**a finalized paid compute channel or settled HTLC to another account**)." The refusal code is `agent_spend_missing`, with `action: fix_request`. | llms.txt (faucet section) | Task 8: `lastGrantSpent` = a `spends` row with status `settled` after the last finalized claim. An `agent_spend_missing` refusal is treated as `rollover_unspent`, **not** a wallet stop. |
| 4 | Claim before enroll? | The testnet claim is keyed only on address + nonce + signature (`claimTestnetAgentFunds`). No enrollment or DID is required. | SDK `faucet.js` claim code; llms.txt steps 1–5 | Claim-first order holds (Tasks 8–9). |
| 5 | DID required? | Not for claims or sessions. An `agentIdentity` pallet exists (`registerAgent(name, agentType, capabilities, endpoints, metadataUri, stakeAmount)`, `didToAgent`; testnet agentCount 310), but no doc ties it to scoring. | live metadata | Task 9: **no DID in v1** (Ruling). |
| 6 | Fees | `createWallet` ≈ **0.00349 FLOP**; `transferKeepAlive` ≈ **0.00272 FLOP**; existential deposit **0.01 FLOP**. A session is about 2–3 extrinsics. | devnet `paymentInfo`, `consts.balances.existentialDeposit` | Defaults: `enrollFeeFlop: 0.01`, `feeReserveFlop: 0.1` (≈ ED + 30 extrinsics). |
| 7 | Do agent-wallet caps constrain `buyInferenceSession`? | **No.** The agent wallet has its own `agentWallet.walletFunds`, and caps apply to `agentTransfer` from those funds. `computeChannel.openChannel` is signed from the account's free balance. | pallet storage and call shapes | The local `dailySpendCeilingFlop` is the main rail. Enrollment stays (spec §4.2, cheap), but its caps don't limit sessions. Show this in the dashboard. |
| 8 | Devnet funding route | `requestFaucetFunding(addr, { network: 'devnet' })` → `POST /fund`, 25 FLOP, `outcome: accepted`, `transferStatus: included`. Devnet has no `/v1/testnet/agent-claims`. | devnet run: tx `0xd5b6…7982` | Task 7: `DevnetFaucet.claim` uses `requestFaucetFunding` (ignores `sign`). Devnet agent grant is 2 FLOP, with limits `ipGrantsPerDay 300`. |
| 9 | IP-limit reason codes / pool reset time | Not published. Refusals are JSON `{error, reason, action, retryAfterSeconds}`, plus `Retry-After`. The IP limit couldn't be triggered safely. | llms.txt "Limits and back-off" | Task 8: shared-IP guard matches `reason` against `/(^|_)ip(_|$)/`. Pool reset is learned from `/limits` (spec §4.3). |
| 10 | Grant finality | The response says `included` first. The finalized-head balance rose to 25 FLOP within ~10 s. | devnet run (`api.at(finalizedHead)`) | `reconcileClaims`: finalized when `transferStatus==='finalized'` or `finalizedFree ≥ balance_before + grant`. |
| 11 | Settlement status | `computeChannel.channels(channelId)` → `{ agent, miner, escrow, state: { <variant>: … } }` (for example `state: { closed: null }`). | devnet channel entry | Task 11: `channelStatus` maps the `state` variant: `open*` → `open`, `settlementPosted*`/`pending*` → `settlement_posted`, `closed`/`settled`/`finalized` → `settled`, `refunded`/`timedOut` → `refunded`, missing → `unknown`. |
| 12 | Explorer links | `https://testnet.flopscan.io/transactions/<hash>` and `/account/<ss58>` (200; `/tx/` and `/extrinsic/` are 404). | HTTP probe | Task 14: `txLink`. Devnet uses `https://explorer.devnet.flop.network` with the same paths (assumed). |

## Step 3: end-to-end purchase

**Not run.** There's no miner endpoint URL available on devnet (Q1), so `prepareInferenceSession({ minerUrl })`
can't be exercised against a real miner. The purchase path is covered by unit tests with fakes. Task 16
re-attempts it if an endpoint is known by then.

## Contradictions with the spec

None blocking. Two refinements (Rulings in the ledger):
- Miner endpoints are owner-supplied, not auto-discovered.
- Agent-wallet caps don't limit sessions, so the local ceiling is the main spend rail.
