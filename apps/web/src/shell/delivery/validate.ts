/** Checks on what the owner types into the delivery flows. All pure; the server checks again. */

const botTokenShape = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const chatIdShape = /^-?\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/;
const maxUrlLength = 2048;

export const botTokenProblem = "That does not look like a bot token. It looks like 123456789:AAH…";
export const chatIdProblem = "Use a number like 123456789, or @channelname.";
export const urlProblem = "Enter a full URL, starting with https://.";
export const urlCredentialsProblem = "Remove the user name and password from the URL.";
export const insecureWarning =
  "This address is not encrypted. Use https:// unless it is on your own network.";

/** True when `text` has the shape of a Telegram bot token. */
export function isBotToken(text: string): boolean {
  return botTokenShape.test(text.trim());
}

/** True when `text` is a numeric chat id or an @channel name. */
export function isChatId(text: string): boolean {
  return chatIdShape.test(text.trim());
}

/** True for a host on the owner's own network: localhost, .local, .ts.net or a private IPv4 address. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    host.endsWith(".ts.net")
  )
    return true;
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  const [a = 0, b = 0] = parts.map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export type UrlCheck =
  | { readonly ok: true; readonly warning: string | null }
  | { readonly ok: false; readonly problem: string };

/** Checks a webhook URL. An http: address that is not on a private network passes with a warning. */
export function checkWebhookUrl(text: string): UrlCheck {
  const clean = text.trim();
  if (clean.length > maxUrlLength || !/^https?:\/\//i.test(clean)) {
    return { ok: false, problem: urlProblem };
  }
  let url: URL;
  try {
    url = new URL(clean);
  } catch {
    return { ok: false, problem: urlProblem };
  }
  if (url.hostname === "") return { ok: false, problem: urlProblem };
  if (url.username !== "" || url.password !== "") {
    return { ok: false, problem: urlCredentialsProblem };
  }
  const exposed = url.protocol === "http:" && !isLocalHost(url.hostname);
  return { ok: true, warning: exposed ? insecureWarning : null };
}

/** The host of a webhook URL, for display. Falls back to the text itself. */
export function hostOf(text: string): string {
  try {
    return new URL(text.trim()).host;
  } catch {
    return text.trim();
  }
}
