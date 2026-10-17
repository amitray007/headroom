import type { Connector, Identity } from "../connector.ts";
import type { CredentialStore, StoredCredential } from "../credentials.ts";
import type { ConnectionRow, ConnectionStore } from "../lifecycle.ts";
import type { ConnectorRegistry } from "./connect.ts";

export interface IdentityUpgradeOptions {
  readonly registry: ConnectorRegistry;
  readonly connections: ConnectionStore;
  readonly credentials: CredentialStore;
  readonly log: (level: "info" | "warn", message: string) => void;
}

/**
 * Move one connection to the key its connector derives from `credential`, in place. Skips a key
 * another connection already holds. Startup and a bound Reconnect both call it.
 */
export function upgradeConnection(
  connections: ConnectionStore,
  connector: Connector,
  row: ConnectionRow,
  credential: StoredCredential,
): "upgraded" | "unchanged" | "key_in_use" {
  if (!connector.upgradeIdentity) return "unchanged";
  // The row holds no assurance; a connector compares only the two key fields.
  const stored: Identity = {
    providerAccountId: row.providerAccountId,
    workspaceId: row.workspaceId,
    label: row.label,
    assurance: "strong",
  };
  const next = connector.upgradeIdentity(credential, stored);
  if (!next) return "unchanged";
  const taken = connections.findByIdentity(row.provider, next, row.scope);
  if (taken && taken.id !== row.id) return "key_in_use";
  connections.rekey(row.id, next);
  return "upgraded";
}

/**
 * Move connections stored under an older identity key to the key their connector uses now, in
 * place, so each keeps its id, credential and history. Offline and idempotent; returns the count.
 */
export function upgradeIdentities(options: IdentityUpgradeOptions): number {
  let upgraded = 0;
  for (const row of options.connections.list()) {
    const connector = options.registry.get(row.provider);
    if (!connector?.upgradeIdentity) continue;
    let outcome: ReturnType<typeof upgradeConnection>;
    try {
      const record = options.credentials.get(row.id);
      // A connection without a credential is re-keyed by its next Reconnect instead.
      if (!record) continue;
      outcome = upgradeConnection(options.connections, connector, row, {
        secret: record.secret,
        expiresAt: record.expiresAt,
      });
    } catch {
      // The next collection or Reconnect reports the problem; startup goes on.
      options.log("warn", `identity upgrade skipped for connection ${row.id}`);
      continue;
    }
    if (outcome === "key_in_use") {
      options.log("warn", `identity upgrade skipped for connection ${row.id}: key in use`);
    } else if (outcome === "upgraded") {
      upgraded++;
    }
  }
  if (upgraded > 0) options.log("info", `upgraded the identity key of ${upgraded} connection(s)`);
  return upgraded;
}
