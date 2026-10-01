import { useState } from "react";

import type { ConnectionState, ReconnectReason } from "@headroom/core/contracts";

import { api, type Revocation } from "./api.ts";
import { messageOf } from "./hooks.ts";
import { connectionStateLabel } from "./labels.ts";
import { href } from "./router.ts";

export function StateBadge(props: { readonly state: ConnectionState }) {
  return <span className={`badge badge-${props.state}`}>{connectionStateLabel(props.state)}</span>;
}

export function ErrorText(props: { readonly message: string | null }) {
  if (props.message === null) return null;
  return (
    <p role="alert" className="error">
      {props.message}
    </p>
  );
}

const reasonText: Record<ReconnectReason, string> = {
  refresh_rejected: "The provider rejected the saved sign-in.",
  token_rejected: "The provider rejected the access token.",
  identity_changed: "The account behind this sign-in changed.",
  revoked_by_owner: "Access was revoked at the provider.",
};

export function revocationText(revocation: Revocation): string {
  switch (revocation) {
    case "revoked":
      return "Disconnected. Access was revoked at the provider.";
    case "local_only":
      return "Disconnected locally. The provider offers no revocation, so revoke access there yourself.";
    case "failed":
      return "Disconnected locally, but revoking at the provider failed. Revoke access there yourself.";
  }
}

interface ActionTarget {
  readonly id: string;
  readonly state: ConnectionState;
  readonly reconnectReason: ReconnectReason | null;
}

/** Reconnect, pause or resume, disconnect with confirmation, and the small refresh link. */
export function ConnectionActions(props: {
  readonly connection: ActionTarget;
  readonly onChanged: () => void;
  readonly onDisconnected: (revocation: Revocation) => void;
}) {
  const { connection } = props;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="actions">
      {connection.state === "reconnect_required" ? (
        <p className="notice">
          {connection.reconnectReason === null
            ? "This connection needs to sign in again."
            : reasonText[connection.reconnectReason]}{" "}
          <a className="button" href={href({ page: "reconnect", id: connection.id })}>
            Reconnect
          </a>
        </p>
      ) : null}
      <div className="row">
        {connection.state === "paused" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.pause(connection.id, false);
                props.onChanged();
              })
            }
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.pause(connection.id, true);
                props.onChanged();
              })
            }
          >
            Pause
          </button>
        )}
        {confirming ? (
          <span className="row">
            <span>Disconnect and delete saved credentials?</span>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api.disconnect(connection.id);
                  props.onDisconnected(result.revocation);
                })
              }
            >
              Yes, disconnect
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" disabled={busy} onClick={() => setConfirming(true)}>
            Disconnect
          </button>
        )}
        <button
          type="button"
          className="link small"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api.refresh(connection.id);
              props.onChanged();
            })
          }
        >
          Refresh now
        </button>
      </div>
      <ErrorText message={error} />
    </div>
  );
}
