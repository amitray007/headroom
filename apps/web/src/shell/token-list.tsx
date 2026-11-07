import { useState, type ReactNode } from "react";

import { shortDate } from "@headroom/view-model/time";

import { type ApiToken } from "../api.ts";
import { When } from "../lib/when.tsx";
import { Button } from "../ui/button.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Sk } from "../ui/skeleton.tsx";
import "./devices.css";

/** The token's visible start, what it may do, its last use and, when set, its expiry. */
function TokenNote(props: { readonly token: ApiToken }) {
  const { token } = props;
  return (
    <span className="muted">
      <code>{token.start ?? token.prefix}…</code>
      {token.scopes.includes("refresh") ? " · Read & Write" : " · Read Only"}
      {" · "}
      {token.lastUsedAt === null ? (
        "Never used"
      ) : (
        <>
          Used <When at={token.lastUsedAt} kind="ago" />
        </>
      )}
      {" · Added "}
      {shortDate(token.createdAt)}
      {token.expiresAt === null ? null : ` · Expires ${shortDate(token.expiresAt)}`}
    </span>
  );
}

/** Token rows with a two-step Revoke; a skeleton while loading, `empty` when none. Devices and Agents share it. */
export function TokenList(props: {
  readonly tokens: readonly ApiToken[] | null;
  readonly busy: boolean;
  readonly unnamed: string;
  readonly empty: { readonly icon: ReactNode; readonly title: string; readonly body: string };
  /** Resolves true once the token is gone, so the confirm closes. */
  readonly onRevoke: (id: string) => Promise<boolean>;
}) {
  const { tokens, busy, unnamed, empty, onRevoke } = props;
  const [confirm, setConfirm] = useState<string | null>(null);
  if (tokens === null) {
    return (
      <div className="srow" aria-busy="true">
        <span className="sbody">
          <Sk width={120} height={14} />
          <Sk width={220} height={12} />
        </span>
        <Sk width={76} height={30} className="sk-pill" />
      </div>
    );
  }
  if (tokens.length === 0) {
    return (
      <EmptyState compact icon={empty.icon} title={empty.title}>
        {empty.body}
      </EmptyState>
    );
  }
  return tokens.map((token) => {
    const label = token.name ?? unnamed;
    const confirming = confirm === token.id;
    return (
      <div key={token.id} className="srow device-row">
        {confirming ? (
          <span className="sbody">
            <b>Revoke {label}?</b>
            <span className="muted">It loses access to this server at once.</span>
          </span>
        ) : (
          <span className="sbody">
            <b>{label}</b>
            <TokenNote token={token} />
          </span>
        )}
        {confirming ? (
          <span className="device-actions">
            <Button size="sm" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              busy={busy}
              onClick={() =>
                void onRevoke(token.id).then((gone) => {
                  if (gone) setConfirm(null);
                  return undefined;
                })
              }
            >
              Revoke
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="quiet-danger"
            disabled={busy}
            onClick={() => setConfirm(token.id)}
          >
            Revoke
          </Button>
        )}
      </div>
    );
  });
}
