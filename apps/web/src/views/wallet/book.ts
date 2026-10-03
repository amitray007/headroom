import type { Cost, TopUp, WalletBook } from "@headroom/view-model/wallet";
import type { Currency } from "@headroom/view-model/wallet-money";

/** Pure edits to the owner's book for the Wallet view. Every edit returns a new book. */

/** Set a cost, or clear it back to Not set with null. */
export function withCost(book: WalletBook, connectionId: string, cost: Cost | null): WalletBook {
  const costs = Object.fromEntries(
    Object.entries(book.costs).filter(([id]) => id !== connectionId),
  );
  return { ...book, costs: cost === null ? costs : { ...costs, [connectionId]: cost } };
}

export function withTopUp(book: WalletBook, topUp: TopUp): WalletBook {
  return { ...book, topUps: [...book.topUps, topUp] };
}

export function withoutTopUp(book: WalletBook, id: string): WalletBook {
  return { ...book, topUps: book.topUps.filter((topUp) => topUp.id !== id) };
}

export function withDisplay(book: WalletBook, displayCurrency: Currency): WalletBook {
  return { ...book, displayCurrency };
}

/** An id for a new top-up. `randomUUID` needs a secure page, and this app may be opened over plain HTTP. */
export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
