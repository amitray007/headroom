import { useEffect, useState, type ReactNode } from "react";

import { api, type ApiToken } from "../api.ts";
import { AgentIcon, BrandMark, CheckIcon, PlugIcon } from "../icons.tsx";
import { Button } from "../ui/button.tsx";
import { CopyButton } from "../ui/copy-button.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";
import { Segmented } from "../ui/segmented.tsx";
import {
  type AgentClient,
  agentLabels,
  headerFor,
  setupFor,
  tokenPlaceholder,
} from "./agent-setup.ts";
import { Section } from "./settings-rows.tsx";
import { TokenList } from "./token-list.tsx";
import "./agents.css";

const clients: readonly AgentClient[] = ["claude", "codex", "cursor", "other"];

function clientIcon(client: AgentClient): ReactNode {
  if (client === "other") return <PlugIcon />;
  return (
    <span className={`agent-mark ${client}`}>
      <BrandMark provider={client} size={16} />
    </span>
  );
}

/** Token names say which agent holds the token, so the list shows who to revoke. */
function tokenName(client: AgentClient): string {
  return client === "other" ? "Agent" : agentLabels[client];
}

/** The token's spot in the text: a dim chip for the placeholder, a faint tint for the real one. */
function withToken(text: string, token: string | null): ReactNode {
  const shown = token ?? tokenPlaceholder;
  const [before = "", ...rest] = text.split(shown);
  return (
    <>
      {before}
      <span className={token === null ? "agent-token placeholder" : "agent-token"}>{shown}</span>
      {rest.join(shown)}
    </>
  );
}

const agentsOf = (tokens: readonly ApiToken[]): ApiToken[] =>
  tokens.filter((token) => token.kind === "agent");

/** Connect an AI agent: pick the client, create a read-only token, copy the setup; revoke agents below. The key lives only in this mounted tab. */
export function AgentsTab() {
  const [client, setClient] = useState<AgentClient>("claude");
  const [mcpUrl, setMcpUrl] = useState(`${window.location.origin}/api/mcp`);
  const [made, setMade] = useState<{
    readonly id: string;
    readonly key: string;
    readonly client: AgentClient;
  } | null>(null);
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = async (): Promise<void> => {
    setListError(null);
    try {
      setTokens(agentsOf((await api.tokens()).tokens));
    } catch {
      setListError("Headroom could not load your agents.");
    }
  };
  useEffect(() => {
    let active = true;
    void api
      .tokens()
      .then((result) => {
        if (!active) return undefined;
        setTokens(agentsOf(result.tokens));
        if (result.mcpUrl !== null) setMcpUrl(result.mcpUrl);
        return undefined;
      })
      .catch(() => {
        if (active) setListError("Headroom could not load your agents.");
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
      const token = await api.createToken(tokenName(client), false, "agent");
      setMade({ id: token.id, key: token.key, client });
      if (token.mcpUrl !== null) setMcpUrl(token.mcpUrl);
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
    setListError(null);
    try {
      await api.revokeToken(id);
      // A revoked key must not stay in the setup as if it still worked.
      if (made?.id === id) setMade(null);
      await reload();
      return true;
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "Headroom could not revoke the token.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const token = made?.key ?? null;
  const setup = client === "other" ? null : setupFor(client, mcpUrl, token);
  return (
    <>
      <Section title="Connect an Agent">
        <div className="agents">
          <Segmented
            full
            label="Client"
            value={client}
            options={clients.map((value) => ({
              value,
              label: agentLabels[value],
              icon: clientIcon(value),
            }))}
            onChange={setClient}
          />
          <div className="agent-stage" key={client}>
            {setup === null ? (
              <div className="agent-fields">
                <div className="agent-field">
                  <span className="muted">MCP address</span>
                  <div className="key-field">
                    <code aria-label="MCP address">{mcpUrl}</code>
                    <CopyButton value={mcpUrl} label="Copy MCP Address" size="sm" iconOnly />
                  </div>
                </div>
                <div className="agent-field">
                  <span className="muted">Header</span>
                  <div className="key-field">
                    <code aria-label="Header">{headerFor(token)}</code>
                    <CopyButton value={headerFor(token)} label="Copy Header" size="sm" iconOnly />
                  </div>
                </div>
              </div>
            ) : (
              <div className="agent-card">
                <div className="agent-bar">
                  <span className="agent-where">{setup.where}</span>
                  <CopyButton value={setup.code} label="Copy" size="sm" />
                </div>
                <pre>
                  <code>{withToken(setup.code, token)}</code>
                </pre>
              </div>
            )}
          </div>
          {error === null ? null : <ErrorNotice inline>{error}</ErrorNotice>}
          {made === null ? (
            <div className="agent-token-row">
              <Button variant="primary" busy={busy} onClick={() => void create()}>
                Create Token
              </Button>
              <span className="muted">Read only. Revoke anytime below.</span>
            </div>
          ) : (
            <div className="agent-token-row">
              <p className="agent-done">
                <CheckIcon />
                Token created. Copy the setup now; it isn&apos;t shown again.
              </p>
              {made.client === client ? null : (
                <Button variant="quiet" size="sm" busy={busy} onClick={() => void create()}>
                  New Token for {agentLabels[client]}
                </Button>
              )}
            </div>
          )}
        </div>
      </Section>
      <Section title="Connected Agents">
        {listError === null ? null : (
          <ErrorNotice inline onRetry={() => void reload()}>
            {listError}
          </ErrorNotice>
        )}
        <TokenList
          tokens={tokens}
          busy={busy}
          unnamed="Unnamed agent"
          empty={{
            icon: <AgentIcon />,
            title: "No agents yet",
            body: "Create a token above and paste the setup into your agent.",
          }}
          onRevoke={revoke}
        />
      </Section>
    </>
  );
}
