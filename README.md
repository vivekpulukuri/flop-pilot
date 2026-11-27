# FLOP Pilot

An autopilot for the FLOP Testnet **agent** role, for **macOS, Windows and Linux** (desktop or server). It looks after up to 3 wallets made
from one seed phrase. Each day it claims the faucet grant within the faucet's limits, enrolls the
wallets as agents, spends every grant on inference from independent miners, and shows everything
on a dashboard that only your computer can open.

**New here? Follow [docs/SETUP.md](docs/SETUP.md). It's step by step, no experience needed.**

## Safety and rules, in short

- Testnet FLOP has no value. FLOP's program rules are provisional; check https://flop.finance/testnet/.
- One person, one install, on one computer (not a laptop *and* a server). Wallets under common control count as one participant. FLOP Pilot never hides that its wallets are linked.
- Never more than 3 faucet claims a day per install. No IP rotation or VPN tricks.
- It never pays a miner linked to your own wallets, because self-dealing isn't credited and can be flagged.
- Your 24-word seed phrase is encrypted on disk. The vault password lives in the OS secure store (macOS Keychain, Windows DPAPI, Linux keyring; a 0600 key file on servers without one), or nowhere at all if you choose a passphrase written on paper. The seed never appears in logs, the dashboard or exports.
- Practice mode (on by default) signs and sends nothing until you turn it off.
- The dashboard listens on `127.0.0.1` only and needs a per-run link.

## Commands

Run these from the `flop-pilot` folder. Commands that take extra words need `--` before them.

| Command | What it does |
|---|---|
| `npm run init` / `npm run init:restore` / `npm run init:passphrase` | Create (or restore) your seed phrase, vault and 3 wallets (starts on devnet) |
| `npm run doctor` | Check setup, chain, faucet and install location |
| `npm run wallets` | List addresses and status |
| `npm run fund` | Claim the faucet grant (guarded); add `-- --wallet 1` or `-- --dry-run` |
| `npm run enroll` | Register funded wallets as agent wallets with spending caps |
| `npm run spend` | Buy inference from independent miners |
| `npm run miners:list` / `npm run miners:add -- <address> <url>` / `npm run miners:remove -- <address>` | Miner endpoints you buy from |
| `npm run autopilot:on` / `npm run autopilot:off` / `npm run autopilot:status` | Background job every 15 minutes (launchd, Task Scheduler or cron) |
| `npm run autopilot:run` | Run the autopilot in the open window (needed in passphrase mode; use tmux on servers) |
| `npm run unlock:passphrase` / `npm run unlock:auto` | Switch between a passphrase on paper and automatic unlock |
| `npm run tick` | Run one autopilot cycle now |
| `npm run pause` / `npm run resume` / `npm run stop` / `npm run stop:deactivate` | Pause, resume, kill switch |
| `npm run practice:on` / `npm run practice:off` | Practice mode |
| `npm run network:devnet` / `npm run network:testnet` | Switch the active network |
| `npm run claimers:1` / `npm run claimers:2` / `npm run claimers:3` | How many wallets claim (split with others on your connection) |
| `npm run activation -- <block>` | Enter the announced block where earning starts (`-- clear` to remove) |
| `npm run dashboard` | Open the local dashboard |
| `npm run update` | Update to the newest release tag (run it when FLOP upgrades) |
| `npm run export` | Save claims and purchases to a file (IP left out; `-- --with-ip` to include) |
| `npm run pilot -- <anything>` | Run the underlying CLI directly |

## Where things live

- `~/.flop-pilot/`: config, encrypted vault, ledger (SQLite), purchase intents, task queue (`tasks/`), inference outputs, logs.
- Vault password: macOS Keychain item `flop-pilot`/`vault`; Windows `~/.flop-pilot/vault.key.dpapi`; Linux keyring (`secret-tool`), or `~/.flop-pilot/vault.key` on servers. Nothing in passphrase mode.
- Background job: macOS `~/Library/LaunchAgents/io.floppilot.autopilot.plist`; Windows Task Scheduler task `flop-pilot`; Linux a crontab line tagged `# flop-pilot:flop-pilot`.

## Development

```sh
npm ci
npm test        # vitest (CI runs it on Linux, Windows and macOS)
npm run build   # tsc → dist/
```

Requires Node.js 22.13+ (uses the built-in `node:sqlite`, so nothing needs compiling).


Design: `docs/superpowers/specs/2026-11-27-flop-pilot-design.md` · Plan: `docs/superpowers/plans/2026-11-27-flop-pilot.md` · Network findings: `docs/research/2026-11-27-devnet-findings.md`.

Built on the official [`@flop-labs/sdk`](https://www.npmjs.com/package/@flop-labs/sdk), pinned to an exact version.

## Disclaimer

Unofficial tool, not affiliated with FLOP Labs. Testnet FLOP has no value. Rules and rewards are
FLOP's to decide and may change. You're responsible for following them.
