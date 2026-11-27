# FLOP Pilot

An autopilot for the FLOP Testnet **agent** role, for macOS. It looks after up to 3 wallets made
from one seed phrase. Each day it claims the faucet grant within the faucet's limits, enrolls the
wallets as agents, spends every grant on inference from independent miners, and shows everything
on a dashboard that only your Mac can open.

**New here? Follow [docs/SETUP.md](docs/SETUP.md). It's step by step, no experience needed.**

## Safety and rules, in short

- Testnet FLOP has no value. FLOP's program rules are provisional; check https://flop.finance/testnet/.
- One person, one install. Wallets under common control count as one participant. FLOP Pilot never hides that its wallets are linked.
- Never more than 3 faucet claims a day per install. No IP rotation or VPN tricks.
- It never pays a miner linked to your own wallets, because self-dealing isn't credited and can be flagged.
- Your 24-word seed phrase is encrypted on disk, with the password in the macOS Keychain. It never appears in logs, the dashboard or exports.
- Practice mode (on by default) signs and sends nothing until you turn it off.
- The dashboard listens on `127.0.0.1` only and needs a per-run link.

## Commands

| Command | What it does |
|---|---|
| `init [--restore] [--network devnet\|testnet]` | Create (or restore) your seed phrase, vault and 3 wallets |
| `doctor` | Check setup, chain, faucet and install location |
| `wallets` | List addresses and status |
| `fund [--wallet N] [--dry-run]` | Claim the faucet grant (guarded) |
| `enroll [--dry-run]` | Register funded wallets as agent wallets with spending caps |
| `spend [--wallet N] [--dry-run]` | Buy inference from independent miners |
| `miners add\|list\|remove` | Manage the miner endpoints you buy from |
| `autopilot on\|off\|status` | Background job, every 15 minutes |
| `tick` | Run one autopilot cycle now |
| `pause` / `resume` / `stop [--deactivate]` | Pause, resume, kill switch |
| `practice on\|off` | Practice mode |
| `network devnet\|testnet` | Switch the active network |
| `claimers 1\|2\|3` | How many wallets claim (split with others on your connection) |
| `activation <block>\|clear` | Enter the announced block where earning starts |
| `dashboard [--no-open]` | Open the local dashboard |
| `update` | Update to the newest release tag (run it when FLOP upgrades) |
| `export [--json] [--with-ip]` | Save claims and purchases to a file (IP left out by default) |

## Where things live

- `~/.flop-pilot/`: config, encrypted vault, ledger (SQLite), purchase intents, task queue (`tasks/`), inference outputs, logs.
- Keychain item `flop-pilot` / `vault`: the vault password.
- `~/Library/LaunchAgents/io.floppilot.autopilot.plist`: the background job, while the autopilot is on.

## Development

```sh
npm ci
npm test        # vitest
npm run build   # tsc → dist/
```

Design: `docs/superpowers/specs/2026-11-27-flop-pilot-design.md` · Plan: `docs/superpowers/plans/2026-11-27-flop-pilot.md` · Network findings: `docs/research/2026-11-27-devnet-findings.md`.

Built on the official [`@flop-labs/sdk`](https://www.npmjs.com/package/@flop-labs/sdk), pinned to an exact version.

## Disclaimer

Unofficial tool, not affiliated with FLOP Labs. Testnet FLOP has no value. Rules and rewards are
FLOP's to decide and may change. You're responsible for following them.
