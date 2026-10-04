import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/** React.lazy for a named export, so code-split modules keep their named exports. */
export function lazyNamed<K extends string, P extends object>(
  load: () => Promise<Record<K, ComponentType<P>>>,
  name: K,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(async () => ({ default: (await load())[name] }));
}
