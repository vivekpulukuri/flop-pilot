import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { SecretStore } from '../core/types.js';
import { paths } from '../core/paths.js';

export interface VaultFile {
  v: 1; kdf: 'scrypt'; N: number; r: number; p: number;
  salt: string; iv: string; tag: string; ct: string;
}

export class VaultLockedError extends Error {
  constructor(msg = 'The wallet vault is locked: the macOS Keychain did not return its password.') {
    super(msg);
    this.name = 'VaultLockedError';
  }
}

const N = 131072, R = 8, P = 1;
const MAXMEM = 256 * 1024 * 1024;

function key(password: string, salt: Buffer, n: number, r: number, p: number): Buffer {
  return scryptSync(password, salt, 32, { N: n, r, p, maxmem: MAXMEM });
}

export function encryptSeed(seed: string, password: string): VaultFile {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(password, salt, N, R, P), iv);
  const ct = Buffer.concat([cipher.update(seed, 'utf8'), cipher.final()]);
  return {
    v: 1, kdf: 'scrypt', N, r: R, p: P,
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64'),
  };
}

export function decryptSeed(v: VaultFile, password: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key(password, Buffer.from(v.salt, 'base64'), v.N, v.r, v.p), Buffer.from(v.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(v.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(v.ct, 'base64')), decipher.final()]).toString('utf8');
}

/** Writes with mode 0600; `wx` refuses to overwrite an existing vault. */
export function writeVault(path: string, v: VaultFile): void {
  writeFileSync(path, JSON.stringify(v) + '\n', { mode: 0o600, flag: 'wx' });
}

export function readVault(path: string): VaultFile {
  return JSON.parse(readFileSync(path, 'utf8')) as VaultFile;
}

export function newVaultPassword(): string {
  return randomBytes(32).toString('base64url');
}

export async function unlockSeed(home: string, store: SecretStore): Promise<string> {
  const pw = await store.get();
  if (!pw) throw new VaultLockedError();
  try {
    return decryptSeed(readVault(paths(home).vault), pw);
  } catch {
    throw new VaultLockedError('The wallet vault could not be decrypted with the Keychain password.');
  }
}
