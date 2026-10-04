/**
 * Pure helpers for `MoneyInput`. An amount lives in integer minor units (cents, paise, yen). While you type, the
 * field keeps a "draft": digits with at most one ".", such as "1999.5". The draft is shown with grouping and read
 * back as minor units. Decimals, symbols and names come from `@headroom/view-model/wallet-money`, the one home
 * for currency facts.
 */

/** The longest whole part the field accepts, so minor units stay inside a safe integer. */
const maxWholeDigits = 12;

/** The locale whose digit grouping the field uses: lakh and crore for INR, thousands for the rest. */
export function groupingLocale(currency: string): string {
  return currency === "INR" ? "en-IN" : "en-US";
}

/**
 * Read typed or pasted text as a draft. Keeps digits and the first ".", drops everything else (symbols, commas,
 * spaces, letters), cuts the fraction to `digits` places and the whole part to `maxWholeDigits`. With no decimals
 * (`digits` 0) a "." and anything after it is dropped. "1,999.50" gives "1999.50"; "$20" gives "20".
 */
export function parseDraft(text: string, digits: number): string {
  let whole = "";
  let fraction = "";
  let dot = false;
  for (const char of text) {
    if (char >= "0" && char <= "9") {
      if (dot) fraction += char;
      else whole += char;
    } else if (char === "." && !dot) {
      if (digits === 0) break;
      dot = true;
    }
  }
  whole = whole.replace(/^0+(?=\d)/, "").slice(0, maxWholeDigits);
  if (!dot) return whole;
  return `${whole === "" ? "0" : whole}.${fraction.slice(0, digits)}`;
}

/** A draft as integer minor units. Empty gives null. A missing fraction counts as zero: "12" is 1200 for USD. */
export function draftToMinor(draft: string, digits: number): number | null {
  if (draft === "") return null;
  const [whole = "", fraction = ""] = draft.split(".");
  const wholeUnits = whole === "" ? 0 : Number(whole);
  const fractionUnits =
    digits === 0 ? 0 : Number(fraction.padEnd(digits, "0").slice(0, digits) || "0");
  return wholeUnits * 10 ** digits + fractionUnits;
}

/** Minor units as a full draft with every decimal place: 199950 gives "1999.50"; 1500 for JPY gives "1500". */
export function minorToDraft(minor: number | null, digits: number): string {
  if (minor === null || !Number.isFinite(minor)) return "";
  const text = String(Math.round(Math.abs(minor))).padStart(digits + 1, "0");
  return digits === 0
    ? text
    : `${text.slice(0, text.length - digits)}.${text.slice(text.length - digits)}`;
}

/** Carry an amount between currencies with different minor units, keeping the major amount. Extra places are cut. */
export function rescaleMinor(
  minor: number | null,
  fromDigits: number,
  toDigits: number,
): number | null {
  if (minor === null) return null;
  if (toDigits >= fromDigits) return minor * 10 ** (toDigits - fromDigits);
  return Math.trunc(minor / 10 ** (fromDigits - toDigits));
}

/** A draft with digit grouping for display: "1999.5" gives "1,999.5" (en-US) or "1,999.5" / "12,34,567" (en-IN). */
export function formatDraft(draft: string, locale: string): string {
  if (draft === "") return "";
  const [whole = "", fraction] = draft.split(".");
  const grouped = new Intl.NumberFormat(locale, { useGrouping: true }).format(
    BigInt(whole === "" ? "0" : whole),
  );
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** How many of the typed characters before the caret carry meaning: digits and the decimal point. */
export function significantBefore(text: string, caret: number, digits: number): number {
  return parseDraft(text.slice(0, caret), digits).length;
}

/** The caret position in `display` that sits after `count` digits or decimal points. */
export function caretAfter(display: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < display.length; index++) {
    const char = display.charAt(index);
    if ((char >= "0" && char <= "9") || char === ".") seen += 1;
    if (seen === count) return index + 1;
  }
  return display.length;
}

/** The hint shown in an empty field: "0.00", or "0" for a currency without decimals. */
export function placeholderFor(digits: number): string {
  return digits === 0 ? "0" : `0.${"0".repeat(digits)}`;
}
