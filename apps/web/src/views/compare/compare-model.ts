import type { OverviewConnection } from "../../api.ts";
import {
  isInactive,
  leftOf,
  meterWindows,
  roomOf,
  type MeterRef,
  type MeterWindow,
  type Room,
} from "@headroom/view-model/accounts";
import { accountName, planLabel } from "@headroom/view-model/labels";
import { presentPanel } from "@headroom/view-model/present";

/**
 * The facts the Compare view needs, as pure functions: one row per account, the columns a provider's accounts
 * share, which account to recommend, and how rows sort. An unknown value stays null and sorts last.
 */

/** The column key of a balance-only account's credit balance. */
export const balanceKey = "credits.balance";

/** A credit balance, for providers that report no meters. `total` is null when the grant is unknown. */
interface Balance {
  readonly value: number;
  readonly total: number | null;
  readonly decimals: number;
}

/** One account, with everything the view derives from it computed once. */
export interface Row {
  readonly connection: OverviewConnection;
  /** The owner's name for the account, else a word for its scope. */
  readonly name: string;
  /** The plan in words, such as "Pro"; null when unknown. */
  readonly plan: string | null;
  readonly inactive: boolean;
  readonly room: Room;
  readonly windows: readonly MeterWindow[];
  readonly balance: Balance | null;
}

function balanceOf(connection: OverviewConnection): Balance | null {
  const amounts = presentPanel(connection).cells.filter((cell) => cell.kind === "amount");
  const balance = amounts.find((cell) => cell.key === balanceKey);
  if (balance === undefined || balance.value === null) return null;
  const parsed = balance.of === null ? Number.NaN : Number(balance.of.replaceAll(",", ""));
  return {
    value: balance.value,
    total: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
    decimals: balance.decimals,
  };
}

export function rowOf(connection: OverviewConnection): Row {
  const windows = meterWindows(connection);
  return {
    connection,
    name: accountName(connection),
    plan: planLabel(connection.plan),
    inactive: isInactive(connection),
    room: roomOf(connection),
    windows,
    balance: windows.length === 0 ? balanceOf(connection) : null,
  };
}

/** One column of the matrix: a window every account of the provider may report. */
export interface Column {
  readonly key: string;
  readonly label: string;
  readonly window: string | null;
}

/**
 * The column a window belongs in: what it measures and over how long, not the provider's metric key. Codex
 * reports a Pro account's weekly limit in the slot a Plus account uses for its 5-hour session, so keying by
 * metric would put a weekly figure under "Session".
 */
export function slotOf(window: MeterWindow): string {
  return `${window.label}|${window.window ?? ""}`;
}

/** Every window any of the accounts reports, session windows first, then in the order first seen. */
export function columnsOf(rows: readonly Row[]): Column[] {
  const seen = new Map<string, Column & { readonly session: boolean }>();
  for (const row of rows) {
    for (const window of row.windows) {
      const slot = slotOf(window);
      if (!seen.has(slot)) {
        seen.set(slot, {
          key: slot,
          label: window.label,
          window: window.window,
          session: window.kind === "session",
        });
      }
    }
    if (row.balance !== null && !seen.has(balanceKey)) {
      seen.set(balanceKey, {
        key: balanceKey,
        label: "Credit Balance",
        window: null,
        session: false,
      });
    }
  }
  const all = [...seen.values()];
  const ordered = [
    ...all.filter((column) => column.session),
    ...all.filter((column) => !column.session),
  ];
  return ordered.map(({ key, label, window }) => ({ key, label, window }));
}

/** The room an account has in one column; null when unknown, unlimited or not reported. */
export function columnLeft(row: Row, key: string): number | null {
  if (key === balanceKey) return row.balance === null ? null : row.room.left;
  const window = row.windows.find((entry) => slotOf(entry) === key);
  return window === undefined || window.unlimited ? null : leftOf(window);
}

// ---------- sorting ----------

export interface Sort {
  readonly key: string;
  readonly dir: "asc" | "desc";
}

export const defaultSort: Sort = { key: "room", dir: "desc" };

/** Names read A to Z first; room reads most first. */
function firstDirection(key: string): Sort["dir"] {
  return key === "name" ? "asc" : "desc";
}

/** A header was pressed: the same column flips its direction, another starts in its natural one. */
export function nextSort(sort: Sort, key: string): Sort {
  if (sort.key !== key) return { key, dir: firstDirection(key) };
  return { key, dir: sort.dir === "asc" ? "desc" : "asc" };
}

/**
 * Rows by a column. Inactive accounts always come last, and an unknown value comes after every known one, in
 * either direction. Equal values keep the saved order.
 */
export function sortRows(rows: readonly Row[], sort: Sort): Row[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const number = (row: Row): number | null =>
    sort.key === "room" ? row.room.left : columnLeft(row, sort.key);
  return rows.toSorted((a, b) => {
    if (a.inactive !== b.inactive) return a.inactive ? 1 : -1;
    if (sort.key === "name")
      return sign * a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    const x = number(a);
    const y = number(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * (x - y);
  });
}

// ---------- the recommendation ----------

export interface Pick {
  /** The active account with the most room, or null when none can be told. */
  readonly best: Row | null;
  /** The runner-up, for the tooltip. */
  readonly next: Row | null;
  /** How many active accounts have a known room. */
  readonly counted: number;
  /** Accounts that were not counted because they are paused or need a new sign-in. */
  readonly inactive: number;
}

/**
 * The account to use now: the active one with the most room left. Inactive accounts are never picked, and an
 * account with no known room is not ranked. Plans differ in size, so this compares shares, not amounts.
 */
export function pickBest(rows: readonly Row[]): Pick {
  const ranked = rows
    .filter((row) => !row.inactive && row.room.left !== null)
    .toSorted((a, b) => (b.room.left ?? 0) - (a.room.left ?? 0));
  return {
    best: ranked[0] ?? null,
    next: ranked[1] ?? null,
    counted: ranked.length,
    inactive: rows.filter((row) => row.inactive).length,
  };
}

/** A window that every account of the provider has, such as Session or Weekly (all models). */
function isCommon(ref: MeterRef): boolean {
  return ref.window === null || /^(\d+\s*(hours?|days?)|all models)$/i.test(ref.window);
}

/** A window a chip shows, with the label to show it under. */
export interface Driver {
  readonly ref: MeterRef;
  readonly name: string;
  readonly limiting: boolean;
}

/**
 * The windows that set an account's room. A model-specific window counts toward the room but is shown only when it
 * is the one that limits.
 */
export function driversOf(room: Room): Driver[] {
  return room.windows
    .filter((ref) => leftOf(ref) !== null && (isCommon(ref) || ref.key === room.limiting?.key))
    .map((ref) => ({
      ref,
      name: isCommon(ref) || ref.window === null ? ref.label : `${ref.label} (${ref.window})`,
      limiting: ref.key === room.limiting?.key,
    }));
}

/** The name of the window an account is limited by, for "Limited by Weekly". */
export function limitingName(room: Room): string | null {
  const ref = room.limiting;
  if (ref === null) return null;
  return isCommon(ref) || ref.window === null ? ref.label : `${ref.label} (${ref.window})`;
}
