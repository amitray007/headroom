/** How strong a new password is, scored on the device. Nothing is sent anywhere. */
export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

interface PasswordRule {
  readonly id: "length" | "plain" | "varied";
  readonly label: string;
  readonly met: boolean;
  /** Characters still missing, for the length rule only. */
  readonly remaining: number;
}

export interface PasswordScore {
  readonly level: StrengthLevel;
  /** Plain word for the level. Empty while nothing is typed. */
  readonly label: "" | "Too Short" | "Weak" | "Fair" | "Good" | "Strong";
  readonly rules: readonly PasswordRule[];
}

const words = [
  "password",
  "passw0rd",
  "qwerty",
  "asdfgh",
  "zxcvbn",
  "letmein",
  "welcome",
  "admin",
  "headroom",
  "iloveyou",
  "monkey",
  "dragon",
  "123456",
  "abcdef",
] as const;

const labels = ["", "Weak", "Fair", "Good", "Strong"] as const;

/** Lower bounds, in bits, of Fair, Good and Strong. */
const steps = [48, 64, 90] as const;

/** Share of characters that must not simply repeat or step on from the one before. */
const variedShare = 0.6;

function poolOf(chars: readonly string[]): number {
  const has = (test: RegExp): boolean => chars.some((char) => test.test(char));
  let pool = 0;
  if (has(/\p{Ll}/u)) pool += 26;
  if (has(/\p{Lu}/u)) pool += 26;
  if (has(/\p{N}/u)) pool += 10;
  if (has(/[\p{P}\p{S}]/u)) pool += 33;
  if (has(/[^\p{L}\p{N}\p{P}\p{S}]/u) || has(/[^\p{ASCII}]/u)) pool += 64;
  return Math.max(pool, 1);
}

/** Characters that add something: not the same as the one before, and not one step up or down from it. */
function usefulCount(chars: readonly string[]): number {
  let useful = 0;
  let previous: number | null = null;
  for (const char of chars) {
    const code = char.codePointAt(0) ?? 0;
    if (previous === null || Math.abs(code - previous) > 1) useful += 1;
    previous = code;
  }
  return useful;
}

/**
 * Score a new password against the server minimum. Below the minimum the level is 1 and the word is "Too Short".
 * From the minimum up, the level follows an estimate of guesses: characters that repeat or run in sequence count
 * once, and the character set sets the size of each guess. A common word or keyboard run caps it at Weak.
 */
export function scorePassword(password: string, minimum: number): PasswordScore {
  const chars = Array.from(password);
  const length = chars.length;
  const lower = password.toLowerCase();
  const useful = usefulCount(chars);
  const plain = !words.some((word) => lower.includes(word));
  const rules: PasswordRule[] = [
    {
      id: "length",
      label: `At least ${minimum} characters`,
      met: length >= minimum,
      remaining: Math.max(0, minimum - length),
    },
    { id: "plain", label: "No common word or keyboard run", met: plain, remaining: 0 },
    {
      id: "varied",
      label: "Not mostly repeated or sequential characters",
      met: length > 0 && useful / length >= variedShare,
      remaining: 0,
    },
  ];
  if (length === 0) return { level: 0, label: "", rules };
  if (length < minimum) return { level: 1, label: "Too Short", rules };
  const bits = useful * Math.log2(poolOf(chars));
  let level: StrengthLevel = 1;
  if (bits >= steps[0]) level = 2;
  if (bits >= steps[1]) level = 3;
  if (bits >= steps[2]) level = 4;
  if (!plain) level = 1;
  return { level, label: labels[level], rules };
}
