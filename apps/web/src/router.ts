import { useEffect, useState } from "react";

/** The dashboard views, in switcher order. */
export const views = [
  { id: "overview", label: "Overview" },
  { id: "detailed", label: "Detailed" },
  { id: "compare", label: "Compare" },
  { id: "timeline", label: "Timeline" },
  { id: "wallet", label: "Wallet" },
] as const;

export type ViewId = (typeof views)[number]["id"];

export type Route =
  | { page: ViewId }
  | { page: "connect" }
  | { page: "reconnect"; id: string }
  | { page: "gallery" };

function isView(name: string | undefined): name is ViewId {
  return views.some((view) => view.id === name);
}

/** True for a view page, as opposed to connect, reconnect or the gallery. */
export function viewOf(route: Route): ViewId | null {
  return isView(route.page) ? route.page : null;
}

/** Parse a location hash such as "#/reconnect/abc" into a route; unknown hashes show the Overview. */
export function parseRoute(hash: string): Route {
  const [, first, second] = hash.replace(/^#/, "").split("/");
  if (first === "connect") return { page: "connect" };
  if (first === "reconnect" && second) return { page: "reconnect", id: decodeURIComponent(second) };
  if (first === "dev" && second === "ui") return { page: "gallery" };
  return { page: isView(first) ? first : "overview" };
}

/** The bare root: no view was chosen in the address. */
export function isBareRoot(hash: string): boolean {
  return /^#?\/?$/.test(hash);
}

export function href(route: Route): string {
  switch (route.page) {
    case "overview":
      return "#/";
    case "detailed":
    case "compare":
    case "timeline":
    case "wallet":
      return `#/${route.page}`;
    case "connect":
      return "#/connect";
    case "reconnect":
      return `#/reconnect/${encodeURIComponent(route.id)}`;
    case "gallery":
      return "#/dev/ui";
  }
}

export function useRoute(): Route {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parseRoute(hash);
}

/**
 * Open at the bare root on the view this device used last. Only the bare root is redirected, once, before the
 * first render; every explicit address, and every click on the switcher, goes where it says.
 */
export function restoreView(
  location: Pick<Location, "hash" | "pathname" | "search">,
  history: Pick<History, "replaceState">,
  remembered: ViewId | null,
): void {
  if (remembered === null || remembered === "overview" || !isBareRoot(location.hash)) return;
  history.replaceState(
    null,
    "",
    `${location.pathname}${location.search}${href({ page: remembered })}`,
  );
}
