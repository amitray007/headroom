import { useEffect, useId, useState } from "react";

import { shortDate } from "@headroom/view-model/time";

import { api, type ApiToken } from "../api.ts";
import { KeyIcon } from "../icons.tsx";
import { When } from "../lib/when.tsx";
import { Button } from "../ui/button.tsx";
import { CopyButton } from "../ui/copy-button.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";
import { Sk } from "../ui/skeleton.tsx";
import { Switch } from "../ui/switch.tsx";
import { Body, Section } from "./settings-rows.tsx";
import "./devices.css";

/** The token's visible start, what it may do, its last use and, when set, its expiry. */
function DeviceNote(props: { readonly token: ApiToken }) {
  const { token } = props;
  return (
    <span className="muted">
      <code>{token.start ?? token.prefix}…</code>
      {token.scopes.includes("refresh") ? " · Can change Refresh Every" : " · Read only"}
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

/** Keys live only in this mounted tab and are discarded when it closes. The parent remounts it when Demo Mode changes. */
export function DevicesTab() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [refresh, setRefresh] = useState(false);
  const [created, setCreated] = useState<{ readonly name: string; readonly key: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const nameId = useId();
  const reload = async (): Promise<void> => {
    setError(null);
    try {
      setTokens((await api.tokens()).tokens);
    } catch {
      setError("Headroom could not load your devices.");
    }
  };
  useEffect(() => {
    let active = true;
    void api
      .tokens()
      .then((result) => {
        if (active) setTokens(result.tokens);
        return undefined;
      })
      .catch(() => {
        if (active) setError("Headroom could not load your devices.");
      });
    return () => {
      active = false;
    };
  }, []);
  const create = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await api.createToken(name.trim(), refresh);
      setCreated({ name: token.name ?? name.trim(), key: token.key });
      setName("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Headroom could not create the token.");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.revokeToken(id);
      setConfirm(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Headroom could not revoke the token.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Section title="New Device">
        {created === null ? (
          <form
            className="device-form"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label htmlFor={nameId} className="sbody">
              <b>Device Name</b>
              <span className="muted">A token lets Headroom for Mac read this server.</span>
            </label>
            <div className="device-create">
              <input
                id={nameId}
                value={name}
                maxLength={40}
                required
                placeholder="My Mac"
                onChange={(event) => setName(event.target.value)}
              />
              <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>
                Create Token
              </Button>
            </div>
            {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the Switch component renders the input */}
            <label className="srow device-scope">
              <Body
                title="Can Change Refresh Every"
                note="The Mac can set how often this server refreshes. It can change nothing else."
              />
              <Switch checked={refresh} onChange={setRefresh} />
            </label>
          </form>
        ) : (
          <div className="device-key">
            <span className="sbody">
              <b>Token for {created.name}</b>
              <span className="muted">
                Shown once. Paste it into Headroom for Mac with this server&apos;s address.
              </span>
            </span>
            <div className="device-create">
              <div className="key-field">
                <code aria-label="Token">{created.key}</code>
                <CopyButton value={created.key} label="Copy Token" size="sm" iconOnly />
              </div>
              <Button onClick={() => setCreated(null)}>Done</Button>
            </div>
          </div>
        )}
      </Section>
      <Section title="Linked Devices">
        {error === null ? null : (
          <ErrorNotice inline onRetry={() => void reload()}>
            {error}
          </ErrorNotice>
        )}
        {tokens === null ? (
          <div className="srow" aria-busy="true">
            <span className="sbody">
              <Sk width={120} height={14} />
              <Sk width={220} height={12} />
            </span>
            <Sk width={76} height={30} className="sk-pill" />
          </div>
        ) : tokens.length === 0 ? (
          <EmptyState compact icon={<KeyIcon />} title="No devices yet">
            Create a token above, then add this server in Headroom for Mac.
          </EmptyState>
        ) : (
          tokens.map((token) => {
            const label = token.name ?? "Unnamed device";
            return (
              <div key={token.id} className="srow device-row">
                {confirm === token.id ? (
                  <span className="sbody">
                    <b>Revoke {label}?</b>
                    <span className="muted">It loses access to this server at once.</span>
                  </span>
                ) : (
                  <span className="sbody">
                    <b>{label}</b>
                    <DeviceNote token={token} />
                  </span>
                )}
                {confirm === token.id ? (
                  <span className="device-actions">
                    <Button size="sm" disabled={busy} onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      busy={busy}
                      onClick={() => void revoke(token.id)}
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
          })
        )}
      </Section>
    </>
  );
}
