import type { Provider } from "./enums.ts";

/**
 * Connectors store one label per connection: `<identity> (<plan>)`, or only the identity, or
 * a generic product name when the provider gave no identity. The overview shows the parts
 * separately, so this splits the label without asking the provider again.
 */

/**
 * The label a connector falls back to when it has no email or login. It doubles as the product
 * name: Copilot labels read `<login> (Copilot)`, where the parentheses hold the product, not a plan.
 */
const fallbackLabels: Readonly<Record<Provider, string>> = {
  codex: "Codex",
  claude: "Claude",
  grok: "Grok",
  antigravity: "Antigravity",
  copilot: "Copilot",
  cursor: "Cursor",
  vercel_ai_gateway: "Vercel AI Gateway",
};

export interface SplitLabel {
  /** Text before a trailing parenthesis group; null when empty or only the generic fallback. */
  readonly identity: string | null;
  /** Text inside the trailing parentheses; null when absent or only the product name. */
  readonly plan: string | null;
}

export function splitLabel(provider: Provider, label: string): SplitLabel {
  const trimmed = label.trim();
  const match = /^(.*?)\s*\(([^()]*)\)$/.exec(trimmed);
  const head = (match ? (match[1] ?? "") : trimmed).trim();
  const tail = (match?.[2] ?? "").trim();
  const identity = head === "" || head === fallbackLabels[provider] ? null : head;
  // "Antigravity Starter Quota" repeats the product name; the plan is "Starter Quota".
  const product = fallbackLabels[provider];
  const bare = tail.startsWith(`${product} `) ? tail.slice(product.length + 1).trim() : tail;
  const plan = bare === "" || bare === product ? null : bare;
  return { identity, plan };
}
