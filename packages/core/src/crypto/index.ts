import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM under a versioned keyring. The current key encrypts; any known
 * version decrypts, so rotation re-encrypts rows one version at a time.
 * See docs/architecture/deployment.md, Secrets.
 */

export const keyLength = 32;
const nonceLength = 12;
const tagLength = 16;

export interface Keyring {
  readonly currentVersion: number;
  readonly keys: ReadonlyMap<number, Uint8Array>;
}

export interface Sealed {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly keyVersion: number;
}

export function createKeyring(keys: Readonly<Record<number, Uint8Array>>): Keyring {
  const versions = Object.keys(keys).map(Number);
  if (versions.length === 0) throw new Error("keyring needs at least one key");
  for (const v of versions) {
    const key = keys[v];
    if (!Number.isInteger(v) || v < 1) throw new Error(`invalid key version ${v}`);
    if (key?.length !== keyLength) throw new Error(`key version ${v} must be ${keyLength} bytes`);
  }
  return {
    currentVersion: Math.max(...versions),
    keys: new Map(Object.entries(keys).map(([v, k]) => [Number(v), k])),
  };
}

/** Encrypt with the current key. `aad` binds the ciphertext to its row so it cannot be moved. */
export function seal(keyring: Keyring, plaintext: Uint8Array, aad: string): Sealed {
  const key = keyring.keys.get(keyring.currentVersion);
  if (!key) throw new Error("current key missing from keyring");
  const nonce = randomBytes(nonceLength);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: tagLength });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([body, tag]), nonce, keyVersion: keyring.currentVersion };
}

export function open(keyring: Keyring, sealed: Sealed, aad: string): Uint8Array {
  const key = keyring.keys.get(sealed.keyVersion);
  if (!key) throw new Error(`no key for version ${sealed.keyVersion}`);
  if (sealed.ciphertext.length < tagLength) throw new Error("ciphertext too short");
  const body = sealed.ciphertext.subarray(0, sealed.ciphertext.length - tagLength);
  const tag = sealed.ciphertext.subarray(sealed.ciphertext.length - tagLength);
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.nonce, { authTagLength: tagLength });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function sealJson(keyring: Keyring, value: unknown, aad: string): Sealed {
  return seal(keyring, Buffer.from(JSON.stringify(value), "utf8"), aad);
}

export function openJson(keyring: Keyring, sealed: Sealed, aad: string): unknown {
  return JSON.parse(Buffer.from(open(keyring, sealed, aad)).toString("utf8")) as unknown;
}

/** Parse a key file body: 64 hex characters, surrounding whitespace allowed. */
export function parseKeyHex(text: string): Uint8Array {
  const hex = text.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("master key must be 64 hex characters");
  return Buffer.from(hex, "hex");
}

export function generateKeyHex(): string {
  return randomBytes(keyLength).toString("hex");
}

/** Constant-time comparison for tokens and hashes of equal length. */
export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
