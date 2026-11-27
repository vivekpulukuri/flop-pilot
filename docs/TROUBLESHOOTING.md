# Troubleshooting

Find the message you see in the left column.

| You see | What it means | Do this |
|---|---|---|
| `flop-pilot: command not found` | The alias from setup step 4 isn't loaded | Run `source ~/.zshrc`, or open a new Terminal window |
| `flop-pilot is not set up yet. Run: flop-pilot init` | No wallets on this Mac yet | `flop-pilot init --network devnet` |
| `✗ Vault unlocks` / alert "could not unlock your wallets" | The macOS Keychain is locked or said no | Log in to your Mac. If macOS asks whether `security` can use the "flop-pilot" item, click **Always Allow** |
| `The flop-pilot folder is inside your Documents folder…` | macOS blocks background jobs there | Run the `mv …` command it prints, then `flop-pilot autopilot on` again |
| `FLOP upgraded the chain. Run: flop-pilot update` | FLOP changed the chain and this version doesn't support it yet | `cd ~/flop-pilot && flop-pilot update`. If it says no release yet, wait for one; the autopilot resumes by itself |
| `this wallet claimed less than 24 hours ago` | Each wallet can claim once per 24 hours | Nothing; it claims again when the time is up |
| `3 claims already made in the last 24 hours` | The daily limit is used | Nothing |
| `faucet's daily pool is empty` | The faucet ran out for today | Nothing; it claims after the pool refills |
| `spend the last grant on inference first` | The faucet only gives a wallet more after it has spent its last grant | Add a miner (setup step 10) so spending can happen |
| `paused: your internet connection may be shared` | The faucet saw too many claims from your connection | If someone else on your Wi-Fi runs FLOP Pilot, split claims: `flop-pilot claimers 1` or `2` |
| `wallet stopped after a faucet refusal` | The faucet rejected a request for a reason that needs a fix | Check the alert text on the dashboard; if unsure, ask in FLOP's community channels |
| `all claims stopped after a faucet report` | The faucet asked to report a problem to FLOP | Report the alert text to the FLOP team; don't retry |
| `no independent miner with an endpoint` | No miner to buy from yet | Add one: `flop-pilot miners add <address> <https-url>` |
| `Port 4747 is busy` | The dashboard is already open in another Terminal window | Use that window, or close it with Ctrl + C |
| Mac was asleep or off | The autopilot didn't run while it slept | Nothing; it catches up when the Mac wakes |

Still stuck? Run `flop-pilot doctor` and share its output (it contains no secrets) when you ask for help.
**Never share your 24 words.**
