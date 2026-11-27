# FLOP Pilot: design

Status: draft, awaiting approval · Date: 2026-11-27 · Approach chosen: **A (TypeScript + official FLOP SDK)**

## 1. Intent and why

The tool is for people new to crypto who want to be as useful as possible to the FLOP Testnet as an
**agent**. Each day: claim the most FLOP the faucet allows, then spend all of it on real
inference bought from independent miners, without breaking any program rule and without
missing a day once voucher earning starts.

They want:

- a **CLI** to create wallets, enroll them as agents, fund them, spend, and run on autopilot;
- an **autopilot** that checks the faucet limits, balances and rules by itself;
- a **local dashboard** with full visibility (per-wallet metrics, claims, spends,
  transactions, origin IP) and full controls;
- a **step-by-step guide** that people new to crypto can follow on their own machines to set up
  their own copy.

Success means a newcomer can go from nothing to a running autopilot by copy-pasting
from the guide, and after that each install claims and spends its full allowance every day
with no action needed. The dashboard shows what happened and why.

## 2. Goals, non-goals, anti-goals

**Goals**
1. One seed phrase derives the wallets (default 3, see §4.1).
2. Daily faucet claims up to the allowed maximum, done early in the day.
3. Spend every grant on real inference from miners that pass the independence check.
4. Hands-off autopilot on macOS that survives sleep, reboots and network drops.
5. A local dashboard with full visibility and controls.
6. All 7 ideas from the conversation (§5).
7. A novice guide, `docs/SETUP.md`, that a non-developer can follow (§8).

**Non-goals (v1)**
- Running a miner or validator.
- Mainnet.
- Windows or Linux support. The guide and launchd setup are macOS-only. The code should not
  block a later port.
- A hosted or multi-user dashboard. Each person runs their own copy.
- Voucher trading, which is disabled on Testnet anyway.

**Anti-goals: failure even if the code works**
- Anything that gets the owner flagged for "manufactured activity" or forfeits their
  allocation.
- Getting around faucet limits: IP rotation, VPNs, proxies, more than 3 claims in 24 h, or
  hiding that the wallets are linked.
- Counting self-transfers between the owner's own wallets as "spend".
- Leaking the seed phrase in any form: logs, dashboard, exports, crash dumps.
- Retrying a faucet refusal in a loop. The faucet docs forbid it.
- Failing silently. Every skipped or failed step shows up in the dashboard with a reason.
- A guide that assumes developer knowledge.

## 3. Constraints and verified facts (as of 2026-11-27)

| Fact | Source |
|---|---|
| Chain: Substrate, `flop_testnet`, genesis `0x918abd58…cfd800`, RPC `wss://testnet.flop.network`, SS58 prefix 42, 18 decimals, runtime spec 1014035 | github.com/flop-labs/network `networks/testnet.md`, `faucet.flop.network/chain` |
| SDK `@flop-labs/sdk@0.13.1` (published 2026-11-26) admits spec 1014035. It throws `RUNTIME_INCOMPATIBLE` on unsupported runtime upgrades | SDK `runtime-compatibility.js` |
| SDK testnet profile: gateway `https://gateway.testnet.flop.network`, faucet `https://faucet.flop.network` | SDK `chain.js` |
| Devnet profile: RPC `wss://rpc.devnet.flop.network`, faucet `https://faucet.devnet.flop.network`, gateway `https://api.flop.network` | SDK `chain.js` |
| Faucet agent grant: 10 FLOP per address per rolling 24 h, `cooldownSeconds` 86400, **`rolloverRequiresSpend: true`** (the next grant needs a finalized spend of the previous one) | `faucet.flop.network/limits` |
| Per client: `ipGrantsPerDay` 3, `ipRangeGrantsPerDay` 20 | same |
| The faucet's daily pool was ~95% used when checked (`dailyCap.remainingFlop` 564150 of 11,000,000) | same |
| Claim function: `claimTestnetAgentFunds(address, { sign, nonce? })`. Message signed: `flop-faucet-agent/v1|<genesis>|<address>|<nonce>`. Outcomes: `accepted \| refused \| unavailable \| unknown`. On `unknown`, reconcile by resending the **same** address, nonce and signature, never a new nonce. Refusals carry `action`: `retry_later \| fix_request \| report_to_operator`, plus `retryAfterSeconds` | SDK `faucet.d.ts` / `faucet.js` |
| Grant is spendable only once its tx is in a **finalized** block | flop.network/llms.txt |
| Enrollment: `createAgentWallet(api, signer, { agent, perTxLimit, dailyCap, allowedDestinations? })`; `deactivateWallet` / `reactivateWallet` / `getAgentWallet` | SDK `agent-wallet.d.ts` |
| Inference purchase: `client.prepareInferenceSession({ minerUrl, escrowFlop, maxTurns })`, then `client.buyInferenceSession({ intent, prompt })`. **The intent holds a session secret and must be saved (mode 0600) before buying.** Reuse it unchanged after any uncertain result; never prepare twice for one purchase | SDK `client.d.ts` and README |
| Cooperative settlement pays the miner the whole escrow, so escrow equals the cost. Tx fees are extra | docs.flop.network/docs/send-to-specific-miner (Devnet) |
| Testnet inference: docs (undated) say no Testnet miner or model is registered yet. On 2026-11-27 the testnet gateway `/v1/models` lists `qwen/qwen3-14b`. It may be opening now | flop.network/llms.txt, live gateway |
| Program rules (marked provisional): wallets under common control are scored as one participant; spend to a commonly controlled miner, or circulated between own wallets, is not credited; manufactured activity forfeits allocation | flop.finance/testnet |
| Agents are scored pro rata on compute purchased in settled sessions. Faucet grants and holding earn nothing | flop.finance/airdrop (draft) |
| Voucher earning starts at a future announced activation block, with no backfill. No date announced yet | docs.flop.network/networks/testnet |
| CLI and tooling need Node.js 22+ | `@flop-labs/cli` README |

## 4. Design

### 4.1 Wallets and keys
- One BIP-39 seed phrase (24 words). Wallets are sr25519 hard derivations, with the network
  in the path so devnet and testnet never share addresses: `<seed>//flop-agent//testnet//0`,
  `//1`, `//2`, and `<seed>//flop-agent//devnet//0`, and so on. *(Claude's call)*
- The number of **claiming** wallets is configurable from 1 to 3 (default 3, to match
  `ipGrantsPerDay`). The CLI refuses a 4th claimer and says why. A household with two
  installs sets each to fewer (for example 2 + 1). *(Claude's call)*
- Vault: the seed is encrypted at rest (scrypt + AES-256-GCM via `node:crypto`) in
  `~/.flop-pilot/vault.json` (mode 0600). The vault password is kept in the **macOS
  Keychain** (`security add-generic-password` / `find-generic-password`), so the autopilot
  can unlock it without prompting.
- On `init`, the seed is shown **once**. The user must re-type 3 random words to confirm
  they wrote it down. `init --restore` takes an existing phrase.
- Neither the seed nor private keys ever reach logs, the ledger, the dashboard or exports.

### 4.2 Enrollment
`enroll` makes each wallet an on-chain agent wallet with `createAgentWallet`, with `agent` =
its own address and conservative caps: `perTxLimit` ≈ the largest planned session escrow
plus margin, and `dailyCap` ≈ 10 FLOP plus fee margin. Caps are editable in settings. If the
Testnet agent role also needs a DID (flop.finance lists "DID and a wallet"), enrollment
creates or links it too. See §7.

- **Order** *(Claude's call, verify on devnet, §7)*: a new wallet holds 0 FLOP and
  enrolling costs fees, so the wallet **claims first**, then enrolls using part of its first
  finalized grant. The faucet claim is keyed only on address and signature (no registration
  found in the docs). The autopilot spends only from enrolled wallets, so all counted spend
  is agent activity.
- **Identity** *(Claude's call)*: if a DID is needed, there is **one DID per install
  (owner)**, and all its wallets link to it. That matches "one participant, one score".
  The tool never creates one DID per wallet. Nothing in the tool tries to hide that the
  wallets belong to one person.

### 4.3 Funding (faucet claims)
- Use `claimTestnetAgentFunds`. The signer is the wallet's own keypair over the UTF-8 message.
- Save the nonce and signature in the ledger **before** sending (write-ahead). On `unknown`,
  the next tick resends the identical request. Never mint a new nonce until the previous one
  reaches a final result.
- On `refused`, follow `action` and `retryAfterSeconds`:
  - `retry_later`: schedule it.
  - `fix_request`: stop that wallet and alert.
  - `report_to_operator`: stop **all** claims and alert.
  - Never retry a refusal in a loop.
- A claim counts as spendable only once its tx is finalized, checked on chain.
- **Claim guard (idea 1):** across all wallets, no more than 3 accepted-or-pending claims in
  any rolling 24 h, whatever the network or IP. A wallet also needs its own 24 h cooldown
  passed and its previous grant spent (rollover rule).
- **Pool check before every POST** *(Claude's call)*: read `/limits` first. If
  `faucet.status` isn't `open`, or `dailyCap.remainingFlop` is below the grant, **send no
  request**. Log it as `skipped: pool empty`. So an empty pool never causes repeated POSTs.
- **Claim timing** *(Claude's call)*: claim on the first tick when the wallet's cooldown is
  over **and** the pool check passes. The tool learns the pool's reset time by watching
  `dailyCap.usedFlop` drop in `/limits` snapshots. Once that's known, a wallet whose
  cooldown ended while the pool was empty claims on the first tick after the reset. The
  dashboard shows the observed reset time.
- **`unavailable` outcome**: no immediate retry. Back off at 1 h, then 2 h, 4 h, up to 6 h,
  and each attempt still needs the pool check to pass.
- **Shared-IP guard** *(Claude's call)*: a refusal that points to the per-IP or IP-range
  limit (reason code to be confirmed, §7) pauses claims for **all** wallets for 24 h. It
  alerts: "Another install or device may share your internet connection. Lower the number of
  claiming wallets, or set up only one install per connection." Practice mode makes no
  faucet requests, so setting up a friend's install on someone else's Wi-Fi is safe.

### 4.4 Spending (inference purchases)
- Find miners that serve sessions on the selected network. Builder to investigate the exact
  mechanism (§7).
- **Independence check (idea 2).** A miner is rejected if:
  - its address is any of the owner's derived addresses;
  - it is on the owner's declared "my miners" list in settings; or
  - its on-chain controller, stash or payout accounts link to any owner address (checks
    available on chain).
  - If the check can't be done, don't spend. Log it as `skipped: independence unverified`.
- Budget per tick: finalized balance minus a fee reserve, split into sessions under
  `perTxLimit`. "Spend them all" means spend down to the reserve.
- Purchase flow:
  1. `prepareInferenceSession`.
  2. Save the intent to `~/.flop-pilot/intents/<id>.json` (0600), and record it in the
     ledger.
  3. `buyInferenceSession({ intent, prompt })`.
  4. Record `channelId`, `gnUsed` and the output.
  5. Track until settlement is finalized.
  6. On restart, resume saved intents. Never re-prepare them.
- **Useful inference (idea 5):** prompts come from a work queue.
  - Users drop `.txt` or `.md` tasks into `~/.flop-pilot/tasks/`.
  - When the queue is empty, a built-in default set is used (a small Q&A eval set, with
    answers checked for a basic quality score).
  - Outputs are saved to `~/.flop-pilot/outputs/` and linked in the dashboard.
- The gateway (API-key) route spends the gateway broker's funds, not the owner's wallet, so
  it is **not** used for spending.

### 4.5 Autopilot
- A macOS LaunchAgent (`~/Library/LaunchAgents/io.floppilot.autopilot.plist`) runs
  `flop-pilot tick` every 15 min. Ticks missed during sleep are covered by the next one.
- A tick is idempotent and holds a lock file so two ticks never overlap.
- Each tick, in order:
  1. Kill-switch and pause check.
  2. Fetch faucet `/limits` and `/chain`. Verify the genesis hash.
  3. Check RPC health and runtime spec support. On `RUNTIME_INCOMPATIBLE`, pause, alert
     "update SDK", and stop.
  4. Record the public IP.
  5. Reconcile unknown claims and saved intents.
  6. Claims (under the guard).
  7. Wait for finalization.
  8. Spends.
  9. Run the watchers.
  10. Write a tick summary row.
- Modes:
  - **standby**: before the activation block. It still claims and spends, because that
    helps the testnet and keeps the faucet rollover going, but labels the activity "earns 0".
  - **earning**: from the activation block on.

### 4.6 Watchers (ideas 3 and 4)
- **Earning-start alarm:**
  - Hash-diff `docs.flop.network/networks/testnet` and
    `docs.flop.network/docs/testnet-and-timeline?network=testnet`.
  - Watch runtime upgrades on chain.
  - On a change, send a macOS notification (`osascript display notification`) and show a
    dashboard banner.
  - The user confirms the announced block number in the dashboard. The autopilot switches
    to earning at that finalized block.
- **Rules watcher:** hash-diff `flop.finance/testnet/` and `flop.finance/airdrop/` once a
  day (on the page's text content, so markup churn is ignored). On a change, send a
  notification and show a "rules changed, review" banner with a link and a text diff.
- Watchers use a fixed generic User-Agent and send nothing about the user.

### 4.7 Safety rails (idea 7)
- **Practice mode**: the default on first run. Every command and the autopilot simulate,
  show "would claim / would spend X to miner Y", and sign nothing. It's a global setting and
  a `--dry-run` flag.
- On-chain caps through agent-wallet `perTxLimit` / `dailyCap` (§4.2).
- A local daily spend ceiling as a second line of defense.
- **Kill switch**: `flop-pilot stop` or the dashboard button. It halts the autopilot at once.
  It can also `deactivateWallet` on chain, after a confirmation.

### 4.8 Network selection (idea 6)
- **One active network at a time** *(Claude's call)*. Devnet is a **one-time rehearsal**:
  prove claim → spend → settle end to end where miners exist, then run
  `flop-pilot network testnet`. The autopilot runs only on the active network.
- The 3-claim cap applies per faucet. Devnet and testnet have separate faucets and separate
  addresses (§4.1), so the rehearsal doesn't delay any testnet claim.
- The ledger keeps networks separate, and the dashboard can show history from either.

### 4.9 Ledger
- SQLite at `~/.flop-pilot/ledger.db`. Tables:
  - `wallets` (index, address, enrolled, caps, active)
  - `claims` (wallet, nonce, signature, outcome, reason, action, retry_after, tx_hash,
    finalized_block, amount, public_ip, network, ts)
  - `spends` (wallet, intent_id, miner, independence_result, escrow, fee, channel_id,
    status, gn_used, output_path, public_ip, ts)
  - `ticks` (start, end, mode, summary, errors)
  - `alerts` (kind, message, acknowledged)
  - `watch_snapshots` (url, hash, text, ts)
- Balances come from the chain, and the ledger is the record of what was done.

### 4.10 Dashboard
- `flop-pilot dashboard` starts a server bound to **127.0.0.1 only** and opens the browser
  with a random session token. Requests without the token are rejected, which covers CSRF
  from other local pages.
- Pages:
  - **Overview**: mode (standby or earning), autopilot state, the next claim time for each
    wallet, today's claimed and spent amounts, the faucet pool left, active alerts.
  - **Wallets**: one card per wallet with address (copyable), balance, enrolled status and
    caps, last claim, cooldown left, rollover status, lifetime claimed and spent, and a
    30-day chart.
  - **Activity**: one table merging claims, spends and transactions, filterable by wallet,
    type, outcome and network. Columns: time, wallet, type, amount, miner, status, tx hash
    (linked to `testnet.flopscan.io`), origin IP, reason.
  - **Spending**: escrow by miner, the independence check result for each miner, saved
    inference outputs, and the work queue.
  - **Rules & alerts**: watcher status, diffs, a field to confirm the activation block, and
    acknowledge buttons.
  - **Controls**:
    - pause and resume, plus the kill switch;
    - practice mode toggle;
    - claim now and spend now per wallet (same guards as the autopilot; the button shows
      why it's disabled);
    - edit caps, reserve and tick interval;
    - "my miners" list;
    - CSV/JSON export, with the IP column redacted by default.
- No-build frontend: server-rendered HTML plus small vanilla JS and a locally bundled chart
  library, so novices never run a frontend build.

### 4.11 CLI surface

```
flop-pilot init [--restore] [--network devnet|testnet]   # seed, vault, Keychain, 3 wallets, config
flop-pilot doctor          # Node version, RPC, faucet, SDK runtime support, Keychain, launchd
flop-pilot wallets         # list addresses, balances, status
flop-pilot enroll          # createAgentWallet for each wallet (+DID if required)
flop-pilot fund [--wallet N]    # guarded faucet claim
flop-pilot spend [--wallet N]   # guarded inference purchase(s)
flop-pilot tick            # one autopilot cycle (what launchd runs)
flop-pilot autopilot on|off|status   # install/remove LaunchAgent
flop-pilot stop            # kill switch
flop-pilot dashboard       # open local dashboard
flop-pilot practice on|off # dry-run mode
flop-pilot network devnet|testnet   # switch active network
flop-pilot update          # pull latest release + reinstall pinned deps (see §4.12)
flop-pilot export [--with-ip]
```

Every command supports `--json` and `--dry-run`, and prints plain-English next steps on error.

### 4.12 Sharing and updates (**decided by the owner**)
- FLOP upgrades its chain often (runtime specs 1014000 → 1014040 so far), and the SDK only
  accepts versions it knows. Each upgrade the SDK doesn't support pauses every install with
  `RUNTIME_INCOMPATIBLE` until it is updated. This may happen on activation day itself.
- **Owner's decision: no self-update**, since the process holds the seed. Instead:
  - an immediate macOS notification and dashboard banner: "FLOP upgraded. Run
    `flop-pilot update`";
  - `update` fetches the latest release from the project's home and reinstalls the pinned
    dependencies;
  - `doctor` confirms it worked.
  - Downtime is the time until the user runs one command.
- **Owner's decision: the code lives in a public GitHub repo** owned by the owner, so anyone
  can audit it. **Owner's update (2026-11-27): the builder may commit and push to
  `github.com/vivekpulukuri/flop-pilot` (public). Commits are authored only by the owner, with
  no Claude co-author line.**
  - Releases are git tags, for example `v0.3.0`.
  - `flop-pilot update` runs `git fetch --tags`, checks out the newest release tag (never an
    untagged commit), then `npm ci` against the committed lockfile, then `doctor`.
  - Install is `git clone <repo>` and `npm ci`. The guide gives exact commands, plus a
    "Download ZIP" fallback for people without git (they update by downloading again).
  - The SDK is pinned to an exact version in `package.json`. Bumping it is a reviewed
    release, not something each install does on its own.

## 5. The seven ideas, mapped
1. Hard 3-claims cap: §4.3.
2. Miner independence check: §4.4.
3. Earning-start alarm and mode switch: §4.5, §4.6.
4. Rules watcher: §4.6.
5. Useful inference work queue: §4.4.
6. Devnet first: §4.8, §8.
7. Safety rails (caps, kill switch, practice mode): §4.7.

## 6. Approaches considered
- **A. TypeScript + official `@flop-labs/sdk` (chosen).** The SDK is maintained by FLOP and
  already has faucet claims, agent wallets, inference purchases and runtime guards. One
  process covers the CLI, autopilot and dashboard. It is the most code of the three.
- **B. Shell scripts around the `flop` CLI.** Less code, but the faucet claim isn't in the
  CLI yet, and parsing its output breaks between versions.
- **C. Python `flop-sdk` 0.4.0.** Rejected: stale, and it doesn't admit the current testnet
  runtime.

## 7. Left to the builder (verify on devnet before building on it)
1. **Miner discovery.** How to list session-serving miners and their `minerUrl` on chain or
   through an indexer, per network.
2. **What the faucet counts as "spend"** for `rolloverRequiresSpend` on Testnet. The working
   assumption is that a settled inference session counts. Confirm it.
3. **Whether Testnet enrollment needs a DID**, and how to make one (`flop agent credential`
   may be relevant).
4. **Fee reserve size** and session escrow sizing (the SDK has
   `computeChannel.estimateSession`).
5. Whether `createAgentWallet` caps limit `buyInferenceSession` spends, or only
   `agentTransfer`. If they don't, the local ceiling is the main rail.
6. **Whether devnet has a faucet agent-claim route.** If not, use whatever funding route
   devnet supports for the practice run.
7. Library choices: HTTP server, SQLite binding, chart library, test framework.
8. Exact public-IP lookup method. Use an IP-echo endpoint with a generic User-Agent.
9. **Whether the faucet requires an enrolled agent wallet to claim.** If it does, the
   claim-first order in §4.2 needs another way to pay the first fee.
10. **The faucet's refusal reason codes** for the per-IP and IP-range limits (for the
    shared-IP guard, §4.3), and the pool's reset time, if it is published anywhere.

## 8. Novice guide: `docs/SETUP.md` (deliverable)
Written for people with no terminal experience. One idea per step, copy-paste commands,
an expected-output block after each step, and a "if you see X, do Y" box.

1. What this is, what it is not, and the rules in plain words: one person, one install;
   never run a friend's wallets; never share your seed phrase.
2. Install Node.js 22+ (official macOS installer) and check it.
3. Get the project from the public GitHub repo (`git clone`, or Download ZIP) and run
   `npm ci`.
4. `flop-pilot init --network devnet`: write down the seed and confirm it.
5. `flop-pilot doctor`, then the practice-mode tour of the dashboard.
6. Devnet run: practice mode off, `fund`, `spend`, and see it in the dashboard.
7. Switch to testnet: `init`'s network switch, `enroll`, `autopilot on`.
8. Daily life: what to check, what alerts mean, how to pause, and the "FLOP upgraded → run
   `flop-pilot update`" routine.
9. Troubleshooting table: the common refusals, `RUNTIME_INCOMPATIBLE` → update, Mac asleep,
   Keychain prompts.
10. Safety, and uninstalling.

## 9. Testing
- Unit tests with fake faucet and chain clients, covering:
  - claim guard edge cases (rolling window, `unknown` reconcile, each refusal action);
  - rollover blocking;
  - intent resume;
  - independence check;
  - practice mode signs nothing.
- Devnet end-to-end run before any testnet run.
- Dashboard smoke test: the token is required, and the server is bound to 127.0.0.1.
