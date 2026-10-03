import { formatMoney } from "@headroom/view-model/wallet-money";
import type { Amount } from "@headroom/view-model/wallet";

/** The figure to show for an amount: the converted one, or the original when there is no rate. */
export function figureText(amount: Amount): string {
  const money = amount.shown ?? amount.original;
  return money === null ? "—" : formatMoney(money);
}

/**
 * The muted line under a figure: the amount as entered when it was converted ("₹1,999 billed"), or "No rate for
 * INR" when it could not be. Null when the figure is already what was entered. `suffix` follows the original.
 */
export function originalNote(amount: Amount, suffix = ""): string | null {
  if (amount.shown === null) return amount.noRate === null ? null : `No rate for ${amount.noRate}`;
  return amount.original === null ? null : `${formatMoney(amount.original)}${suffix}`;
}
