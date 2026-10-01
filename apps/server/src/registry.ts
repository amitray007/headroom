import type { Connector, ConnectorRegistry, Provider } from "@headroom/core";

/** Connectors the owner enabled, keyed by provider. Disabled connectors are invisible to the API. */
export function createRegistry(
  available: readonly Connector[],
  enabled: readonly Provider[],
): ConnectorRegistry {
  const map = new Map<Provider, Connector>();
  for (const connector of available) {
    if (enabled.includes(connector.provider)) map.set(connector.provider, connector);
  }
  return {
    get: (provider) => map.get(provider),
    list: () => [...map.values()],
  };
}
