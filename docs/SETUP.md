# Set up FLOP Pilot on your Mac

This guide takes you from nothing to a running autopilot. You copy each command, paste it into
Terminal, press Return, and check that you see what the guide shows. No crypto or coding
experience needed. Plan on about 30 minutes.

## Before you start: what this is, and the rules

FLOP Pilot looks after up to 3 wallets on the FLOP **Testnet** (a practice network). Every day it:

1. collects free test FLOP from the official faucet, within the faucet's limits,
2. registers each wallet as an "agent" (a buyer of AI computing),
3. spends the FLOP buying AI answers from miners run by other people.

You watch and control all of it on a page that only your Mac can open.

Testnet FLOP has **no money value**. FLOP's testnet program may reward real activity later. Its
rules are still marked provisional, so check https://flop.finance/testnet/ for the current
version. The rules that matter most:

| Do | Don't |
|---|---|
| One person, one install, on your own internet connection | Run wallets for a friend, or let a friend run yours. The rules count wallets under one person's control as one participant |
| Keep your 24 words on paper, offline | Type your 24 words into any website, chat or form. Nobody from FLOP will ever ask for them |
| If two people share one home internet, split the 3 daily claims (see step 9) | Use a VPN or other tricks to get more claims. That breaks the rules and can disqualify you |

## Words you'll see

| Word | Meaning |
|---|---|
| **Testnet / devnet** | Practice networks. Testnet is the one that counts; devnet is a sandbox for trying things first. Each has its own wallets and coins. |
| **Faucet** | FLOP's official giveaway of free test coins. |
| **Agent** | A wallet that buys AI computing. "Enroll" means registering a wallet as one. |
| **Miner** | Someone else's computer that answers AI questions for FLOP. |
| **Inference** | One AI answer, bought from a miner. |
| **Endpoint** | A miner's web address, such as `https://…`, which they share themselves. |
| **Seed phrase / 24 words** | The master key to your wallets. |
| **Keychain** | Your Mac's built-in password safe. |
| **Practice mode** | Everything is simulated, and nothing is signed or sent. |
| **Block** | One step of the network's history. Earning starts at an announced block number. |

## Step 1: Open Terminal

Press **Cmd + Space**, type `Terminal`, and press Return. A window with a text prompt opens. Every
command in this guide goes into that window.

## Step 2: Install Node.js

Go to https://nodejs.org, download the **LTS** installer for macOS, open it and click through.
Then, in Terminal, run:

```sh
node -v
```

You should see a version of 22 or higher:

```
v22.22.3
```

> **If you see `command not found`:** close Terminal completely (Cmd + Q), open it again, and retry.

## Step 3: Download FLOP Pilot to your home folder

Install it in your **home folder**, not in Documents, Desktop or Downloads. macOS stops
background jobs from reading those folders, and the autopilot would freeze.

```sh
cd ~ && git clone https://github.com/vivekpulukuri/flop-pilot.git && cd flop-pilot && npm ci
```

The first time you use `git`, your Mac may offer to install "command line developer tools".
Click **Install**, wait for it to finish, then run the command again.

You should see it end with something like:

```
added 160 packages in 20s
```

> **No git?** On the GitHub page click **Code → Download ZIP**, unzip it, rename the folder to
> `flop-pilot`, move it into your home folder (the one with your name in Finder), then run
> `cd ~/flop-pilot && npm ci`.

## Step 4: Make the `flop-pilot` command available

```sh
echo 'alias flop-pilot="node $HOME/flop-pilot/dist/cli.js"' >> ~/.zshrc && source ~/.zshrc && flop-pilot --version
```

You should see:

```
0.1.0
```

## Step 5: Create your wallets and write down your 24 words

Start on **devnet** (FLOP's development network) to practise safely:

```sh
flop-pilot init --network devnet
```

It shows 24 words in a numbered grid. **Write all 24 on paper, in order.** These words are the
master key to every wallet this tool makes. Press Return, and the words disappear from the screen.
It then asks for 3 of them, chosen at random, to check your copy. Type each word and press Return:

```
Word #4:
Word #11:
Word #19:
```

(Your numbers will be different.)

You should see:

```
Set up done. Network: devnet. Practice mode is ON (nothing is signed or sent). Next: flop-pilot doctor
```

Your words are stored encrypted on this Mac, and the password for them sits in your Mac's
Keychain. If a box asks whether `security` may use the "flop-pilot" item, click **Always Allow**. You never need to type them again unless you move to a new Mac
(`flop-pilot init --restore`).

> **If you see `The words did not match after 3 tries`:** nothing was saved. Run the command again.
> You get a new set of 24 words; write those down instead.

## Step 6: Check everything

```sh
flop-pilot doctor
```

You should see ticks:

```
✓ Node.js 22 or newer  (v22.22.3)
✓ macOS  (darwin)
✓ Set up (init done)
✓ Vault unlocks
✓ Data folder writable  (/Users/you/.flop-pilot)
✓ Chain RPC reachable  (wss://rpc.devnet.flop.network)
✓ Chain is FLOP devnet  (0x99c1…d631)
✓ Chain version supported  (1014038)
✓ Faucet is FLOP Devnet  (0x99c1…d631)
✓ Install location works with the autopilot  (/Users/you/flop-pilot/dist/cli.js)
! Autopilot installed  (not installed)
    → When ready: flop-pilot autopilot on
```

The long codes and folder names will differ on your Mac; `you` is your Mac user name. The `!` on the last line is fine for now. Any `✗` line has a `→` line under it that says how to fix it.

## Step 7: Look around in practice mode

Practice mode is on, so nothing is signed or sent. Try:

```sh
flop-pilot wallets
flop-pilot fund
```

You should see your 3 wallet addresses: `claimer:yes` means the wallet collects from the faucet,
and `enrolled:no` means it isn't registered as an agent yet. Then:

```
○ practice: would claim 25 FLOP for wallet #0
○ practice: would claim 25 FLOP for wallet #1
○ practice: would claim 25 FLOP for wallet #2
```

Now open your dashboard:

```sh
flop-pilot dashboard
```

Your browser opens a page showing your three wallets as coloured strips. If no page opens, copy the
`http://127.0.0.1:4747/?t=…` link it prints and paste it into your browser.

While the dashboard is open, that Terminal window is busy. Press **Cmd + N** for a new Terminal
window to keep typing commands. To close the dashboard, click its Terminal window and press
**Control + C** (the `control` key, not `command`).

## Step 8: Do it for real on devnet

```sh
flop-pilot practice off
flop-pilot fund --wallet 0
```

You should see a real claim:

```
✓ claimed 25 FLOP for wallet #0 (tx 0xa21d…ef53)
```

The network needs about a minute to make that payment final. Wait a minute, then register the
wallet as an agent and try spending:

```sh
flop-pilot enroll
flop-pilot spend
```

You should see:

```
✓ enrolled wallet #0 as an agent (tx 0xd1a6…73d9)
– wallet #1 needs at least 0.01 FLOP to enroll (has 0.0000); it enrolls after its first claim
– wallet #2 needs at least 0.01 FLOP to enroll (has 0.0000); it enrolls after its first claim
```

and, for `spend`:

```
– wallet #0: no miner to buy from yet. 3 miners found: 3 have no endpoint added yet. Add a miner endpoint on the Controls page.
– wallet #1 is not enrolled yet
– wallet #2 is not enrolled yet
```

All three lines are expected. Miners share their endpoint addresses themselves, so spending starts
once you add one (step 10). Wallets #1 and #2 claim and enroll on their own once the autopilot runs.

## Step 9: Switch to Testnet and turn on the autopilot

```sh
flop-pilot network testnet
flop-pilot autopilot on
```

You should see:

```
Active network is now testnet.
Autopilot ON (runs every 15 min). Agent file: /Users/you/Library/LaunchAgents/io.floppilot.autopilot.plist
```

Your testnet wallets have **new addresses**. That's on purpose: devnet and testnet keep separate
wallets, and both come from the same 24 words. Your devnet coins stay on devnet.

> **If you see `The flop-pilot folder is inside your Documents folder…`:** copy the `mv …` line it
> prints, paste it into Terminal and press Return. It moves the folder to your home folder and
> turns the autopilot on.

From now on, every 15 minutes (and whenever your Mac wakes up), the autopilot:

1. checks the faucet and claims for each wallet whose 24-hour wait is over,
2. registers new wallets as agents once they have FLOP,
3. spends each wallet's FLOP on inference from independent miners,
4. watches FLOP's rules and timeline pages for changes.

**Sharing your internet with another FLOP Pilot user?** The faucet allows 3 claims per
connection per day in total. Agree on a split. For example, one of you runs
`flop-pilot claimers 2` and the other runs `flop-pilot claimers 1`.

## Step 10: Add miners to buy from

When a miner shares their address and endpoint (see FLOP's website, https://flop.network), add it.
Replace both parts in angle brackets, including the `<` and `>`:

```sh
flop-pilot miners add <miner address> <miner endpoint>
```

For example: `flop-pilot miners add 5GrmgqmvwX2WgedTsz7UTJix9k4az2NdEBT9my4yFnRTD23m https://miner.example.com`

You can also do this on the dashboard's **Controls** tab. The autopilot only pays miners that are
not linked to your own wallets. If you run a miner yourself, list its address under
**Miners you run yourself** on the Controls tab.

## Step 11: Daily life

- Open the dashboard whenever you like: `flop-pilot dashboard`.
- The **Overview** tab tells you what happens next, for example "Next claim in 3 h 12 m, wallet #1."
- Your Mac shows a notification when something needs you:
  - **"FLOP upgraded the chain. Run: flop-pilot update"**: run `cd ~/flop-pilot && flop-pilot update`. The autopilot waits until you do, then carries on by itself.
  - **"The testnet timeline page changed"**: FLOP may have announced when earning starts. Read the page, then enter the start block on the **Rules and alerts** tab or with `flop-pilot activation <block>`.
  - **"Rules page changed"**: read what changed on the **Rules and alerts** tab.
- Pause anytime with `flop-pilot pause` (and `flop-pilot resume`). Stop everything with `flop-pilot stop`.

Something not working? See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Uninstall

```sh
flop-pilot autopilot off
```

Then, **only after checking your 24 words are safely on paper**:

```sh
security delete-generic-password -s flop-pilot -a vault; rm -rf ~/.flop-pilot ~/flop-pilot
```
