# Cross-platform Implementation Plan (v0.2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Run FLOP Pilot on Windows, Linux desktops and Linux servers as well as macOS.
**Architecture:** OS adapters behind the existing `SecretStore`, a new `Scheduler` interface, and per-OS notify/open in `Env`; selection by `process.platform` (injectable for tests).
**Spec:** `docs/superpowers/specs/2026-11-27-flop-pilot-design.md` §10.

## Global Constraints
- Same `npm run` scripts on every OS. Node >= 22. Remove `"os": ["darwin"]` from package.json.
- Windows/Linux secrets passed via stdin or env vars, never argv.
- Linux server fallback key file `~/.flop-pilot/vault.key` mode 0600; doctor warns.
- Per-home job names (`jobName(home)`: `flop-pilot` for the default home, `flop-pilot-<sha12>` otherwise; macOS keeps `io.floppilot.autopilot[.<sha12>]`).
- Commit as owner, no Claude trailer; push after CI passes on all three OSes.

## Review Focus
1. Crontab rewrite must keep the user's other cron lines untouched — test in Task 2.
2. A path with spaces or a single quote (`C:\Users\Ann Lee`, `/home/o'neil`) must not break the cron line, the .vbs or schtasks — tests in Task 2.
3. Headless Linux (no DISPLAY, no D-Bus) must pick the key file, not hang on secret-tool — test in Task 1.
4. Tests that assert POSIX file modes must not fail on Windows — Task 4.
5. `doctor` must say which store is in use and warn on the key file — Task 1.

### Task 1: Platform secret stores
Files: `src/platform/secrets.ts`, `tests/platform/secrets.test.ts`; modify `src/keys/keychain.ts` (exec gains `{ input?, env? }`), `src/cli.ts`, `src/commands/doctor.ts`.
Produces: `type Plat = 'darwin' | 'win32' | 'linux'`; `secretStoreFor(home, o: { plat; exec; env }): SecretStore & { kind: 'keychain' | 'dpapi' | 'secret-service' | 'key-file'; weak: boolean }`; `dpapiStore(home, exec)`, `secretToolStore(account, exec)`, `keyFileStore(home)`.
Tests: dpapi set passes secret in env `FP_SECRET` (not argv) and writes the blob file; get decrypts via env `FP_BLOB`; secret-tool store reads secret from stdin; lookup exit 1 → null; linux without DBUS_SESSION_BUS_ADDRESS → key-file; key file mode 0600; doctor shows store and warns when weak.

### Task 2: Scheduler adapters
Files: `src/autopilot/scheduler.ts`, `tests/autopilot/scheduler.test.ts`; modify `src/commands/autopilot.ts`, `src/autopilot/launchd.ts` (protectedFolder only on darwin), `src/cli.ts` (doctor isInstalled).
Produces: `interface Scheduler { install(o: { home; nodePath; cliPath; intervalMin }): Promise<string>; uninstall(home): Promise<void>; isInstalled(home): Promise<boolean> }`; `schedulerFor(plat, exec, o?)`; `cronLine(o)`, `mergeCrontab(existing, line, tag)`, `removeFromCrontab(existing, tag)`, `vbsLauncher(o)`, `schtasksCreateArgs(name, vbs, min)`.
Tests: merge keeps foreign lines and replaces only our tag; quoting of spaces/quotes; vbs runs hidden (window style 0) and sets FLOP_PILOT_HOME; schtasks args; `crontab -l` exit 1 (no crontab) treated as empty; protectedFolder returns null off darwin.

### Task 3: Notifications and opening the dashboard
Files: modify `src/sys/env.ts`, `src/commands/dashboard.ts`; test `tests/sys/env.test.ts`.
Produces: `realEnv({ plat })` per-OS notify (linux `notify-send` argv; windows PowerShell balloon with title/body in env vars); `openUrlCommand(url, plat, env): { file; args } | null` (null on headless linux); dashboard prints SSH tunnel hint when null.

### Task 4: Cross-platform tests and CI
Files: `.github/workflows/ci.yml`; modify tests asserting modes (`it.skipIf(process.platform === 'win32')`), package.json (drop `os`).
Verify: `npx vitest run` green locally; after push, `gh run watch` green on all three OSes.

### Task 5: Docs
Files: `docs/SETUP.md` (Windows / Linux / Server boxes, laptop+server rule), `docs/TROUBLESHOOTING.md`, `README.md`.
Verify: `tests/scripts.test.ts` still green.
