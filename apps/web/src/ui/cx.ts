/** Join class names, skipping falsy parts. */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter((part) => typeof part === "string" && part !== "").join(" ");
}
