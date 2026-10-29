import { useEffect, useId, useRef, useState } from "react";

import { api, type ApiToken } from "../api.ts";
import { useDevicePrefs } from "../lib/device-prefs.ts";
import { Button } from "../ui/button.tsx";
import { CopyButton } from "../ui/copy-button.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";
import { Section } from "./settings-rows.tsx";
import "./devices.css";

const when = (value: number | null): string =>
  value === null ? "Never" : new Date(value).toLocaleString();

/** Keys live only in this mounted tab and are discarded when it closes. */
export function DevicesTab() {
  const { demo } = useDevicePrefs();
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const keyRef = useRef<HTMLTextAreaElement>(null);
  const nameId = useId();
  const keyId = useId();
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
    void (demo ? Promise.resolve({ tokens: [] as ApiToken[] }) : api.tokens())
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
  }, [demo]);
  useEffect(() => {
    if (key) keyRef.current?.focus();
  }, [key]);
  const create = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await api.createToken(name.trim());
      setKey(token.key);
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
    <Section title="Devices">
      <p className="muted">Read-only tokens let Headroom for Mac read this server.</p>
      {error === null ? null : (
        <ErrorNotice inline onRetry={() => void reload()}>
          {error}
        </ErrorNotice>
      )}
      {key === null ? (
        <form
          className="device-form field"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label htmlFor={nameId}>Device Name</label>
          <div className="device-actions">
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
        </form>
      ) : (
        <div className="device-key field">
          <label htmlFor={keyId}>Copy Your Token Now</label>
          <p className="muted">Paste this into Headroom for Mac with this server's address.</p>
          <textarea
            id={keyId}
            ref={keyRef}
            readOnly
            value={key}
            rows={3}
            onFocus={(event) => event.target.select()}
          />
          <p className="muted">This token is shown once.</p>
          <div className="device-actions">
            <CopyButton value={key} label="Copy Token" />
            <Button onClick={() => setKey(null)}>Done</Button>
          </div>
        </div>
      )}
      {tokens === null ? (
        <output>Loading devices…</output>
      ) : tokens.length === 0 ? (
        <p className="muted">No devices linked.</p>
      ) : (
        <ul className="device-list">
          {tokens.map((token) => (
            <li key={token.id} className="device-entry">
              <b>{token.name}</b>
              <code>{token.start ?? token.prefix}…</code>
              <dl>
                <dt>Created</dt>
                <dd>{when(token.createdAt)}</dd>
                <dt>Last Used</dt>
                <dd>{when(token.lastUsedAt)}</dd>
                <dt>Expires</dt>
                <dd>{token.expiresAt === null ? "No expiry" : when(token.expiresAt)}</dd>
              </dl>
              {confirm === token.id ? (
                <div className="device-confirm">
                  <p>Revoke {token.name}? This device will lose access.</p>
                  <div className="device-actions">
                    <Button variant="danger" busy={busy} onClick={() => void revoke(token.id)}>
                      Confirm Revoke
                    </Button>
                    <Button disabled={busy} onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="quiet-danger" disabled={busy} onClick={() => setConfirm(token.id)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
