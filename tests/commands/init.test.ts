import { test, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit, type PromptIO } from '../../src/commands/init.js';
import { paths } from '../../src/core/paths.js';
import { loadConfig } from '../../src/core/config.js';
import { openLedger } from '../../src/ledger/ledger.js';
import { memSecretStore } from '../fakes.js';
import { TEST_SEED } from '../fixtures/seed.js';

let home: string;
beforeEach(() => { home = join(mkdtempSync(join(tmpdir(), 'fpi-')), 'h'); });

/** Answers "Word #N" prompts from the printed seed grid (or always wrong). */
function scriptedIO(mode: 'right' | 'wrong', restoreWith?: string) {
  const out: string[] = [];
  let shownWords: string[] = [];
  const io: PromptIO & { out: string[] } = {
    out,
    print(s) {
      out.push(s);
      const m = [...s.matchAll(/(\d+)\.\s+([a-z]+)/g)];
      if (m.length >= 24) { shownWords = []; for (const x of m) shownWords[Number(x[1]) - 1] = x[2]; }
    },
    async ask(q) {
      if (/24 words/i.test(q) && restoreWith !== undefined) return restoreWith;
      const n = /#(\d+)/.exec(q);
      if (n) return mode === 'right' ? shownWords[Number(n[1]) - 1] : 'wrong';
      return '';
    },
    clear() { out.push('<clear>'); },
  };
  return io;
}

test('wrong confirmation words x3 writes nothing', async () => {
  const store = memSecretStore();
  await expect(runInit({ home, network: 'devnet', restore: false, io: scriptedIO('wrong'), store, rng: () => 0.5 })).rejects.toThrow(/nothing was saved/i);
  expect(existsSync(paths(home).vault)).toBe(false);
  expect(store.value).toBeNull();
});

test('success writes 0600 vault, keychain password, practice config and 3 wallets', async () => {
  const store = memSecretStore();
  const io = scriptedIO('right');
  await runInit({ home, network: 'devnet', restore: false, io, store, rng: () => 0.3 });
  expect(statSync(paths(home).vault).mode & 0o777).toBe(0o600);
  expect(store.value).toBeTruthy();
  const c = loadConfig(home);
  expect(c.practice).toBe(true);
  expect(c.network).toBe('devnet');
  const l = openLedger(paths(home).ledger);
  expect(l.listWallets('devnet').map((w) => [w.idx, w.claimer])).toEqual([[0, true], [1, true], [2, true]]);
  l.close();
  expect(io.out.join('\n')).toMatch(/Write these 24 words on paper/);
  expect(io.out).toContain('<clear>');
});

test('seed words never land in the ledger or config files', async () => {
  await runInit({ home, network: 'devnet', restore: true, io: scriptedIO('right', TEST_SEED), store: memSecretStore(), rng: () => 0.1 });
  const words = TEST_SEED.split(' ');
  for (const f of [paths(home).ledger, paths(home).config]) {
    const bytes = readFileSync(f, 'latin1');
    expect(bytes.includes(words.slice(0, 3).join(' '))).toBe(false);
  }
});

test('restore with an invalid mnemonic throws and writes nothing', async () => {
  await expect(runInit({ home, network: 'devnet', restore: true, io: scriptedIO('right', 'not a real seed phrase'), store: memSecretStore() })).rejects.toThrow(/not a valid/i);
  expect(existsSync(paths(home).vault)).toBe(false);
});

test('refuses when already set up', async () => {
  await runInit({ home, network: 'devnet', restore: true, io: scriptedIO('right', TEST_SEED), store: memSecretStore() });
  await expect(runInit({ home, network: 'devnet', restore: true, io: scriptedIO('right', TEST_SEED), store: memSecretStore() })).rejects.toThrow(/already set up/i);
});
