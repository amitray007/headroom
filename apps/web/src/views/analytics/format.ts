/**
 * Whole hours: "13 h" under a day, "1 day 18 h" and "2 days" from 24 h on. A no-break space joins each number to
 * its unit, so a wrapped line never starts with a lone "h".
 */
export function hoursText(hours: number): string {
  const whole = Math.round(hours);
  if (whole < 24) return `${whole}\u00a0h`;
  const days = Math.floor(whole / 24);
  const rest = whole - days * 24;
  const unit = days === 1 ? "day" : "days";
  return rest === 0 ? `${days}\u00a0${unit}` : `${days}\u00a0${unit} ${rest}\u00a0h`;
}

/** Dollars for a price: whole when it is whole, else cents. */
export function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}
