/** Whole hours: "13 h" under a day, "1 day 18 h" and "2 days" from 24 h on. */
export function hoursText(hours: number): string {
  const whole = Math.round(hours);
  if (whole < 24) return `${whole} h`;
  const days = Math.floor(whole / 24);
  const rest = whole - days * 24;
  const unit = days === 1 ? "day" : "days";
  return rest === 0 ? `${days} ${unit}` : `${days} ${unit} ${rest} h`;
}

/** Dollars for a price: whole when it is whole, else cents. */
export function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}
