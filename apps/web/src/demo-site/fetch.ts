import { handleDemoRequest } from "./api.ts";

async function bodyOf(
  input: Request | string | URL,
  init: RequestInit | undefined,
): Promise<unknown> {
  const text =
    typeof init?.body === "string"
      ? init.body
      : input instanceof Request && init?.body === undefined
        ? await input.clone().text()
        : "";
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * A `fetch` that answers every same-origin `/api/` request in memory and sends everything else to `passthrough`.
 * Under GitHub Pages an absolute `/api/...` path would reach github.io, so none of them may leave the page.
 */
export function createDemoFetch(passthrough: typeof fetch, origin: string): typeof fetch {
  const demoFetch = async (
    input: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const raw = input instanceof Request ? input.url : String(input);
    let target: URL;
    try {
      target = new URL(raw, origin);
    } catch {
      return passthrough(input, init);
    }
    if (target.origin !== origin || !target.pathname.startsWith("/api/")) {
      return passthrough(input, init);
    }
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    return handleDemoRequest(method, target.pathname, await bodyOf(input, init));
  };
  return Object.assign(demoFetch, { preconnect: passthrough.preconnect });
}
