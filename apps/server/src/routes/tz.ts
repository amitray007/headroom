/** Minutes east of UTC as a plain integer in the real-world range, or null. */
export function parseTz(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  if (!/^-?\d{1,4}$/.test(raw)) return null;
  const tz = Number(raw);
  return tz >= -720 && tz <= 840 ? tz : null;
}
