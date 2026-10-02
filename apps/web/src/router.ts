import { useEffect, useState } from "react";

export type Route =
  | { page: "connections" }
  | { page: "connect" }
  | { page: "reconnect"; id: string }
  | { page: "gallery" };

/** Parse a location hash such as "#/reconnect/abc" into a route; unknown hashes show the dashboard. */
export function parseRoute(hash: string): Route {
  const [, first, second] = hash.replace(/^#/, "").split("/");
  if (first === "connect") return { page: "connect" };
  if (first === "reconnect" && second) return { page: "reconnect", id: decodeURIComponent(second) };
  if (first === "dev" && second === "ui") return { page: "gallery" };
  return { page: "connections" };
}

export function href(route: Route): string {
  switch (route.page) {
    case "connections":
      return "#/";
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
