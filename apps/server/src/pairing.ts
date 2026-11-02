import { createHash, randomBytes } from "node:crypto";

import type { AppPairingStatus } from "@headroom/core";

/** No 0, 1, I, L or O: a person reads this code off one screen and types it on another. */
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const codeLength = 6;
/** Largest multiple of the alphabet size in a byte; higher bytes are skipped so every letter is equally likely. */
const unbiasedLimit = 248;

export const pairingTtlSeconds = 600;
export const pairingPollSeconds = 2;
const startsPerClient = 10;
const startWindowMs = 10 * 60_000;
const livePairingLimit = 100;
/** Bound on remembered client addresses. Past it, expired windows are swept first. */
const clientLimit = 10_000;

interface Pairing {
  readonly name: string;
  readonly code: string;
  readonly expiresAt: number;
  status: Exclude<AppPairingStatus, "expired">;
  approvedBy?: string;
}

interface PairingStart {
  readonly code: string;
  readonly deviceCode: string;
}

export type PairingStartResult =
  | ({ readonly ok: true } & PairingStart)
  | { readonly ok: false; readonly retryAfterSeconds: number };

export type PairingPoll =
  | { readonly status: "unknown" }
  | { readonly status: "pending" | "denied" | "expired" }
  | { readonly status: "approved"; readonly name: string; readonly userId: string };

export interface PairingView {
  readonly name: string;
  readonly status: AppPairingStatus;
  readonly expiresAt: number;
}

export type PairingDecision = "decided" | "not_pending" | "unknown";

/** "k7p-qx4" and "K7PQX4" are the same code; anything else is not a code. */
export function normalizeCode(input: string): string | null {
  const code = input.replaceAll("-", "").toUpperCase();
  return code.length === codeLength && Array.from(code).every((letter) => alphabet.includes(letter))
    ? code
    : null;
}

export const formatCode = (code: string): string => `${code.slice(0, 3)}-${code.slice(3)}`;

const hashOf = (deviceCode: string): string =>
  createHash("sha256").update(deviceCode).digest("hex");

/**
 * Device pairings for Headroom for Mac (D48). They live in memory for ten minutes and never reach the
 * database; a restart simply ends them. The device code is kept only as its SHA-256.
 */
export class PairingService {
  private readonly byDevice = new Map<string, Pairing>();
  private readonly byCode = new Map<string, string>();
  private readonly starts = new Map<string, number[]>();

  constructor(
    private readonly now: () => Date,
    private readonly random: (size: number) => Uint8Array = randomBytes,
  ) {}

  start(name: string, client: string): PairingStartResult {
    const now = this.now().getTime();
    this.sweep(now);
    const recent = (this.starts.get(client) ?? []).filter((at) => at > now - startWindowMs);
    const oldest = recent[0];
    if (oldest !== undefined && recent.length >= startsPerClient) {
      return { ok: false, retryAfterSeconds: secondsUntil(oldest + startWindowMs, now) };
    }
    if (this.byDevice.size >= livePairingLimit) {
      const soonest = Math.min(...[...this.byDevice.values()].map((p) => p.expiresAt));
      return { ok: false, retryAfterSeconds: secondsUntil(soonest, now) };
    }
    if (!this.starts.has(client) && this.starts.size >= clientLimit) this.forgetOldWindows(now);
    this.starts.set(client, [...recent, now]);
    const code = this.freshCode();
    const deviceCode = Buffer.from(this.random(32)).toString("base64url");
    this.byDevice.set(hashOf(deviceCode), {
      name,
      code,
      expiresAt: now + pairingTtlSeconds * 1000,
      status: "pending",
    });
    this.byCode.set(code, hashOf(deviceCode));
    return { ok: true, code: formatCode(code), deviceCode };
  }

  /** The app's poll. A decided or expired pairing is reported once, then forgotten. */
  poll(deviceCode: string): PairingPoll {
    const now = this.now().getTime();
    const key = hashOf(deviceCode);
    const pairing = this.byDevice.get(key);
    if (!pairing) return { status: "unknown" };
    if (pairing.expiresAt <= now) {
      this.forget(key, pairing);
      return { status: "expired" };
    }
    if (pairing.status === "pending") return { status: "pending" };
    this.forget(key, pairing);
    if (pairing.status === "denied" || pairing.approvedBy === undefined)
      return { status: "denied" };
    return { status: "approved", name: pairing.name, userId: pairing.approvedBy };
  }

  /** The dashboard's lookup by the code on the Mac's screen. Unknown and expired codes give null. */
  find(input: string): PairingView | null {
    const found = this.live(input);
    return found ? { name: found.name, status: found.status, expiresAt: found.expiresAt } : null;
  }

  approve(input: string, userId: string): PairingDecision {
    return this.decide(input, (pairing) => {
      pairing.status = "approved";
      pairing.approvedBy = userId;
    });
  }

  deny(input: string): PairingDecision {
    return this.decide(input, (pairing) => {
      pairing.status = "denied";
    });
  }

  private decide(input: string, change: (pairing: Pairing) => void): PairingDecision {
    const found = this.live(input);
    if (!found) return "unknown";
    if (found.status !== "pending") return "not_pending";
    change(found);
    return "decided";
  }

  private live(input: string): Pairing | null {
    const code = normalizeCode(input);
    const key = code === null ? undefined : this.byCode.get(code);
    const pairing = key === undefined ? undefined : this.byDevice.get(key);
    return pairing && pairing.expiresAt > this.now().getTime() ? pairing : null;
  }

  private freshCode(): string {
    for (;;) {
      let code = "";
      while (code.length < codeLength) {
        for (const byte of this.random(16)) {
          if (byte < unbiasedLimit && code.length < codeLength)
            code += alphabet[byte % alphabet.length];
        }
      }
      if (!this.byCode.has(code)) return code;
    }
  }

  private forget(key: string, pairing: Pairing): void {
    this.byDevice.delete(key);
    this.byCode.delete(pairing.code);
  }

  private sweep(now: number): void {
    for (const [key, pairing] of this.byDevice)
      if (pairing.expiresAt <= now) this.forget(key, pairing);
  }

  private forgetOldWindows(now: number): void {
    for (const [client, times] of this.starts) {
      if ((times.at(-1) ?? 0) <= now - startWindowMs) this.starts.delete(client);
    }
  }
}

const secondsUntil = (at: number, now: number): number => Math.max(1, Math.ceil((at - now) / 1000));
