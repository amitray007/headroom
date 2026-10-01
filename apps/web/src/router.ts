import { useEffect, useState } from "react";

export type Route =
  | { page: "connections" }
  | { page: "connect" }
  | { page: "reconnect"; id: string }
  | { page: "detail"; id: string }
  | { page: "account" };

/** Parse a location hash such as "#/connections/abc" into a route; unknown hashes list connections. */
export function parseRoute(hash: string): Route {
  const [, first, second] = hash.replace(/^#/, "").split("/");
  if (first === "connect") return { page: "connect" };
  if (first === "reconnect" && second) return { page: "reconnect", id: decodeURIComponent(second) };
  if (first === "connections" && second) return { page: "detail", id: decodeURIComponent(second) };
  if (first === "account") return { page: "account" };
  return { page: "connections" };
}

export function href(route: Route): string {
  switch (route.page) {
    case "connections":
      return "#/connections";
    case "connect":
      return "#/connect";
    case "reconnect":
      return `#/reconnect/${encodeURIComponent(route.id)}`;
    case "detail":
      return `#/connections/${encodeURIComponent(route.id)}`;
    case "account":
      return "#/account";
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
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
