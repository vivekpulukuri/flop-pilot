# Set up FLOP Pilot

This guide takes you from nothing to a running autopilot on **macOS, Windows or Linux** (including
a Linux server). You copy each command, paste it into your terminal, press Enter, and check that
you see what the guide shows. No crypto or coding experience needed. Plan on about 30 minutes.

Where a step differs between computers, look for the boxes marked **Mac**, **Windows**, **Linux**
or **Server**.

## Before you start: what this is, and the rules

FLOP Pilot looks after up to 3 wallets on the FLOP **Testnet** (a practice network). Every day it:

1. collects free test FLOP from the official faucet, within the faucet's limits,
2. registers each wallet as an "agent" (a buyer of AI computing),
3. spends the FLOP buying AI answers from miners run by other people.

You watch and control all of it on a page that only your computer can open.

Testnet FLOP has **no money value**. FLOP's testnet program may reward real activity later. Its
rules are still marked provisional, so check https://flop.finance/testnet/ for the current
version. The rules that matter most:

| Do | Don't |
|---|---|
| One person, one install, on **one** computer and your own internet connection | Run it on your laptop **and** a server. That's two installs for one person, which breaks the rules |
| Keep your 24 words (and your passphrase, if you choose one) on paper, offline | Type your 24 words into any website, chat or form. Nobody from FLOP will ever ask for them |
| If two people share one home internet, split the 3 daily claims (step 9) | Run wallets for a friend, or use a VPN or other tricks to get more claims |

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
| **Passphrase** | An optional password you choose and write on paper (step 5). |
| **Practice mode** | Everything is simulated, and nothing is signed or sent. |
| **Block** | One step of the network's history. Earning starts at an announced block number. |

## Step 1: Open a terminal

The terminal is a window where you type commands.

> **Mac:** press **Cmd + Space**, type `Terminal`, press Return.
>
> **Windows:** press the **Windows key**, type `PowerShell`, and open **Windows PowerShell**.
>
> **Linux:** open the **Terminal** app (often **Ctrl + Alt + T**).
>
> **Server:** connect with `ssh you@your-server` from your own computer.

## Step 2: Install Node.js (version 22.13 or newer)

> **Mac and Windows:** go to https://nodejs.org, download the **LTS** installer, open it and click
> through. Then close the terminal and open a new one.
>
> **Linux / Server (Ubuntu, Debian):** your system's own Node is often too old. Install the
> current LTS from NodeSource:
>
> ```sh
> curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
> sudo apt install -y nodejs git
> ```

Then check:

```sh
node -v
```

You should see `v22.13.0` or higher (for example `v22.22.3` or `v24.1.0`).

> **Windows: if you see "running scripts is disabled on this system"** when you use `npm` later,
> run this once, then try again:
>
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

## Step 3: Download FLOP Pilot to your home folder

Run these three commands, one at a time:

```sh
cd ~
git clone https://github.com/vivekpulukuri/flop-pilot.git
cd flop-pilot
```

Then install it:

```sh
npm ci
```

You should see it end with something like `added 150 packages in 20s`.

> **Mac:** install it in your home folder (as above), **not** in Documents, Desktop or Downloads.
> macOS stops background jobs from reading those folders, and the autopilot would freeze. The
> first time you use `git`, your Mac may offer to install "command line developer tools": click
> **Install**, wait, then run the command again.
>
> **Windows:** if `git` isn't found, install it from https://git-scm.com (keep all the default
> options), open a new PowerShell window and start this step again.
>
> **No git at all?** On the GitHub page click **Code → Download ZIP**, unzip it, rename the folder
> to `flop-pilot`, move it into your home folder, then run `cd ~/flop-pilot` and `npm ci`.

## Step 4: Check the commands work

Every command from here on is an `npm run …` command, run from inside the `flop-pilot` folder.
Your terminal is in that folder now. **Whenever you open a new terminal window, first run
`cd ~/flop-pilot`.**

```sh
npm run about
```

npm first prints two lines starting with `>` (that's normal for every `npm run` command), then:

```
0.1.0
```

## Step 5: Create your wallets and write down your 24 words

Start on **devnet** (the sandbox) to practise safely:

```sh
npm run init
```

**First it asks how your wallets should unlock:**

```
How should FLOP Pilot unlock your wallets?
  1) Automatically: kept safely on this computer (recommended; lets the autopilot run in the background)
  2) A passphrase you write on paper and type each time you start it
Choose 1 or 2 [1]:
```

- **1 (recommended):** a password is stored in your computer's secure store (Mac Keychain,
  Windows' built-in encryption, or the Linux keyring). The autopilot runs by itself in the
  background.
- **2 (passphrase on paper):** you choose a passphrase of at least 12 characters (four random words
  works well) and write it down. Nothing is stored. You type it each time you start FLOP Pilot, and
  the autopilot runs in a window you keep open (step 9). Choose this if you'd rather nothing secret
  lived on the computer.

You can switch later with `npm run unlock:passphrase` or `npm run unlock:auto`.

**Then it shows 24 words in a numbered grid. Write all 24 on paper, in order.** These words are
the master key to every wallet this tool makes. Press Enter, and the words disappear from the
screen. It then asks for 3 of them, chosen at random, to check your copy. Type each word and press
Enter:

```
Word #4:
Word #11:
Word #19:
```

(Your numbers will be different.)

If you chose a passphrase, it asks you to type it twice. Nothing appears on screen while you type;
that's on purpose.

You should see:

```
Set up done. Network: devnet. Practice mode is ON (nothing is signed or sent). Next: npm run doctor
```

> **If you see `The words did not match after 3 tries`:** nothing was saved. Run the command again.
> You get a new set of 24 words; write those down instead.
>
> **Mac:** if a box asks whether `security` may use the "flop-pilot" item, click **Always Allow**.

## Step 6: Check everything

```sh
npm run doctor
```

You should see a list of ticks like this (codes, versions and folder names will differ):

```
✓ Node.js 22.13 or newer  (v22.22.3)
✓ Set up (init done)
✓ Password store  (macOS Keychain)
✓ Vault unlocks
✓ Data folder writable
✓ Chain RPC reachable  (wss://rpc.devnet.flop.network)
✓ Chain is FLOP devnet
✓ Chain version supported
✓ Faucet is FLOP Devnet
! Autopilot installed  (not installed)
    → When ready: npm run autopilot:on
```

The `!` on the last line is fine for now. Any `✗` line has a `→` line under it that says how to fix it.

> **Server:** you'll likely see `! Password store (key file)`. A server has no keyring, so the
> password is kept in a file only your user can read. That's weaker: anyone who can log in as you
> could read it. If you'd rather keep nothing on the server, run `npm run unlock:passphrase`.

## Step 7: Look around in practice mode

Practice mode is on, so nothing is signed or sent. Try:

```sh
npm run wallets
npm run fund
```

You should see your 3 wallet addresses (`claimer:yes` means it collects from the faucet;
`enrolled:no` means it isn't registered as an agent yet), then:

```
○ practice: would claim 25 FLOP for wallet #0
○ practice: would claim 25 FLOP for wallet #1
○ practice: would claim 25 FLOP for wallet #2
```

Now open your dashboard:

```sh
npm run dashboard
```

Your browser opens a page showing your three wallets as coloured strips. If no page opens, copy the
`http://127.0.0.1:4747/?t=…` link it prints into your browser.

While the dashboard is open, that terminal window is busy. Open a **new terminal window** (and run
`cd ~/flop-pilot`) to keep typing commands. To close the dashboard, click its window and press
**Control + C** (the `control`/`Ctrl` key, not `command`).

> **Server:** there's no browser on a server. The dashboard prints an `ssh -L 4747:…` command.
> Run that on your own computer, then open the link in your browser there.

## Step 8: Do it for real on devnet

```sh
npm run practice:off
npm run fund
```

You should see real claims:

```
✓ claimed 25 FLOP for wallet #0 (tx 0xa21d…ef53)
✓ claimed 25 FLOP for wallet #1 (tx 0x…)
✓ claimed 25 FLOP for wallet #2 (tx 0x…)
```

The network needs about a minute to make those payments final. Wait a minute, then register the
wallets as agents and try spending:

```sh
npm run enroll
npm run spend
```

You should see each wallet enrolled (`✓ enrolled wallet #0 as an agent (tx …)`), and for `spend`:

```
– wallet #0: no miner to buy from yet. 3 miners found: 3 have no endpoint added yet. Add a miner endpoint on the Controls page.
```

That's expected. Miners share their endpoint addresses themselves, so spending starts once you
add one (step 10).

## Step 9: Switch to Testnet and start the autopilot

```sh
npm run network:testnet
```

Your testnet wallets have **new addresses**. That's on purpose: devnet and testnet keep separate
wallets, and both come from the same 24 words. Your devnet coins stay on devnet.

**If you chose automatic unlock (option 1):**

```sh
npm run autopilot:on
```

You should see `Autopilot ON (runs every 15 min).` From now on it runs in the background (on a Mac
through launchd, on Windows through Task Scheduler, on Linux through cron) and catches up after
your computer sleeps.

**If you chose a passphrase (option 2):**

```sh
npm run autopilot:run
```

It asks for your passphrase once, then runs every 15 minutes **in that window**. Keep the window
open. Press Control + C to stop it.

> **Server + passphrase:** run it inside `tmux` so it keeps going after you disconnect:
> `tmux new -s flop`, then `npm run autopilot:run`, then press **Ctrl + B**, then **D**, to leave it
> running. Come back later with `tmux attach -t flop`.
>
> **Mac: if you see `The flop-pilot folder is inside your Documents folder…`**, copy the `mv …`
> line it prints, paste it into Terminal and press Return. It moves the folder to your home folder
> and turns the autopilot on.

Every 15 minutes the autopilot:

1. checks the faucet and claims for each wallet whose 24-hour wait is over,
2. registers new wallets as agents once they have FLOP,
3. spends each wallet's FLOP on inference from independent miners,
4. watches FLOP's rules and timeline pages for changes.

**Sharing your internet with another FLOP Pilot user?** The faucet allows 3 claims per connection
per day in total. Agree on a split. For example, one of you runs `npm run claimers:2` and the
other runs `npm run claimers:1`.

## Step 10: Add miners to buy from

When a miner shares their address and endpoint (see FLOP's website, https://flop.network), open the
dashboard's **Controls** tab, fill in **Miner address** and **Endpoint**, and click **Add miner**.

On Mac and Linux you can also use the terminal. Replace both parts in angle brackets, including the
`<` and `>`, and keep the `--`:

```sh
npm run miners:add -- <miner address> <miner endpoint>
```

The autopilot only pays miners that are not linked to your own wallets. If you run a miner
yourself, list its address under **Miners you run yourself** on the Controls tab.

## Step 11: Daily life

- Open the dashboard whenever you like: `npm run dashboard`.
- The **Overview** tab tells you what happens next, for example "Next claim in 3 h 12 m, wallet #1."
- You get a notification (Mac and Windows; on Linux desktops if `notify-send` is installed) when
  something needs you. Every alert also shows on the dashboard:
  - **"FLOP upgraded the chain. Run: npm run update"**: open a terminal, run `cd ~/flop-pilot`, then
    `npm run update`. The autopilot waits until you do, then carries on by itself.
  - **"The testnet timeline page changed"**: FLOP may have announced when earning starts. Read the
    page, then enter the start block on the **Rules and alerts** tab.
  - **"Rules page changed"**: read what changed on the **Rules and alerts** tab.
- Pause anytime with `npm run pause` (and `npm run resume`). Stop everything with `npm run stop`.

Something not working? See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Uninstall

First stop the autopilot:

```sh
npm run autopilot:off
```

Then, **only after checking your 24 words are safely on paper**, delete the data:

> **Mac:**
> ```sh
> security delete-generic-password -s flop-pilot -a vault
> rm -rf ~/.flop-pilot ~/flop-pilot
> ```
>
> **Windows (PowerShell):**
> ```powershell
> Remove-Item -Recurse -Force ~\.flop-pilot, ~\flop-pilot
> ```
>
> **Linux / Server:**
> ```sh
> secret-tool clear service flop-pilot account vault
> rm -rf ~/.flop-pilot ~/flop-pilot
> ```
> (The `secret-tool` line only matters on a desktop; ignore an error from it on a server.)
