import { useEffect, useId, useState } from "react";

import { api, type ApiToken } from "../api.ts";
import { KeyIcon } from "../icons.tsx";
import { Button } from "../ui/button.tsx";
import { CopyButton } from "../ui/copy-button.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";
import { Segmented } from "../ui/segmented.tsx";
import { Section } from "./settings-rows.tsx";
import { TokenList } from "./token-list.tsx";
import "./devices.css";

/** Agent tokens list in the Agents tab. */
const devicesOf = (tokens: readonly ApiToken[]): ApiToken[] =>
  tokens.filter((token) => token.kind === "device");

/** Keys live only in this mounted tab and are discarded when it closes. The parent remounts it when Demo Mode changes. */
export function DevicesTab() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [refresh, setRefresh] = useState(false);
  const [created, setCreated] = useState<{
    readonly name: string;
    readonly key: string;
    readonly mcpUrl: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const reload = async (): Promise<void> => {
    setError(null);
    try {
      setTokens(devicesOf((await api.tokens()).tokens));
    } catch {
      setError("Headroom could not load your devices.");
    }
  };
  useEffect(() => {
    let active = true;
    void api
      .tokens()
      .then((result) => {
        if (active) setTokens(devicesOf(result.tokens));
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
      setCreated({
        name: token.name ?? name.trim(),
        key: token.key,
        // Agents send the token as a bearer header to this server's read-only MCP endpoint.
        mcpUrl: token.mcpUrl ?? `${window.location.origin}/api/mcp`,
      });
      setName("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Headroom could not create the token.");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await api.revokeToken(id);
      await reload();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Headroom could not revoke the token.");
      return false;
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
            <div className="device-head">
              <label htmlFor={nameId} className="sbody">
                <b>Device Name</b>
                <span className="muted">
                  {refresh
                    ? "A token lets Headroom for Mac or an AI agent read this server. The Mac app can also change its Refresh Every."
                    : "A token lets Headroom for Mac or an AI agent read this server."}
                </span>
              </label>
              <Segmented
                label="Access"
                value={refresh ? "write" : "read"}
                options={[
                  { value: "read", label: "Read Only" },
                  { value: "write", label: "Read & Write" },
                ]}
                onChange={(value) => setRefresh(value === "write")}
              />
            </div>
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
          </form>
        ) : (
          <div className="device-key">
            <span className="sbody">
              <b>Token for {created.name}</b>
              <span className="muted">
                Shown once. Paste it into Headroom for Mac with this server&apos;s address, or give
                it to an AI agent with the MCP address below.
              </span>
            </span>
            <div className="device-create">
              <div className="key-field">
                <code aria-label="Token">{created.key}</code>
                <CopyButton value={created.key} label="Copy Token" size="sm" iconOnly />
              </div>
              <Button onClick={() => setCreated(null)}>Done</Button>
            </div>
            <div className="key-field">
              <code aria-label="MCP address">{created.mcpUrl}</code>
              <CopyButton value={created.mcpUrl} label="Copy MCP Address" size="sm" iconOnly />
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
        <TokenList
          tokens={tokens}
          busy={busy}
          unnamed="Unnamed device"
          empty={{
            icon: <KeyIcon />,
            title: "No devices yet",
            body: "Create a token above, then add this server in Headroom for Mac or an MCP client.",
          }}
          onRevoke={revoke}
        />
      </Section>
    </>
  );
}
