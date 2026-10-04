/** A new signing secret: `whsec_` plus base64 of 24 random bytes, the form the server accepts. */
export function generateSecret(
  fill: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = fill(new Uint8Array(24));
  return `whsec_${btoa(String.fromCharCode(...bytes))}`;
}
