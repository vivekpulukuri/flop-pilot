# Troubleshooting

Find the message you see in the left column.

| You see | What it means | Do this |
|---|---|---|
| `npm error Missing script` or `Could not read package.json` | Terminal isn't in the flop-pilot folder | Run `cd ~/flop-pilot`, then the command again |
| `flop-pilot is not set up yet. Run: npm run init` | No wallets on this Mac yet | `npm run init` |
| `✗ Vault unlocks` / alert "could not unlock your wallets" | The macOS Keychain is locked or said no | Log in to your Mac. If macOS asks whether `security` can use the "flop-pilot" item, click **Always Allow** |
| `The flop-pilot folder is inside your Documents folder…` | macOS blocks background jobs there | Run the `mv …` command it prints, then `npm run autopilot:on` again |
| `FLOP upgraded the chain. Run: npm run update` | FLOP changed the chain and this version doesn't support it yet | `cd ~/flop-pilot && npm run update`. If it says no release yet, wait for one; the autopilot resumes by itself |
| `this wallet claimed less than 24 hours ago` | Each wallet can claim once per 24 hours | Nothing; it claims again when the time is up |
| `3 claims already made in the last 24 hours` | The daily limit is used | Nothing |
| `faucet's daily pool is empty` | The faucet ran out for today | Nothing; it claims after the pool refills |
| `spend the last grant on inference first` | The faucet only gives a wallet more after it has spent its last grant | Add a miner (setup step 10) so spending can happen |
| `paused: your internet connection may be shared` | The faucet saw too many claims from your connection | If someone else on your Wi-Fi runs FLOP Pilot, split claims: `npm run claimers:1` or `npm run claimers:2` |
| `wallet stopped after a faucet refusal` | The faucet rejected a request for a reason that needs a fix | Check the alert text on the dashboard; if unsure, ask in FLOP's community channels |
| `all claims stopped after a faucet report` | The faucet asked to report a problem to FLOP | Report the alert text to the FLOP team; don't retry |
| `no miner to buy from yet` | No miner endpoint added yet | Add one: `npm run miners:add -- <address> <https-url>` |
| `Port 4747 is busy` | The dashboard is already open in another Terminal window | Use that window, or close it with Ctrl + C |
| Mac was asleep or off | The autopilot didn't run while it slept | Nothing; it catches up when the Mac wakes |

Still stuck? Run `npm run doctor` and share its output (it contains no secrets) when you ask for help.
**Never share your 24 words.**
