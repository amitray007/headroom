import { useState } from "react";

import { api, type ConnectionSummary } from "./api.ts";
import { ConnectionActions, ErrorText, revocationText, StateBadge } from "./components.tsx";
import { formatAge } from "./format.ts";
import { useLoad, useNow } from "./hooks.ts";
import { href } from "./router.ts";

function ConnectionCard(props: {
  readonly connection: ConnectionSummary;
  readonly now: number;
  readonly onChanged: () => void;
  readonly onDisconnected: (text: string) => void;
}) {
  const { connection, now } = props;
  return (
    <li className="card">
      <div className="row spread">
        <h2>
          <a href={href({ page: "detail", id: connection.id })}>
            {connection.provider} - {connection.label}
          </a>
        </h2>
        <span className="row">
          {connection.interface === "private" ? (
            <span className="tag">private interface</span>
          ) : null}
          <StateBadge state={connection.state} />
        </span>
      </div>
      <p>
        {connection.lastSuccessAt === null
          ? "No successful collection yet."
          : `Data from ${formatAge(connection.lastSuccessAt, now)}.`}
        {connection.stale ? <strong className="stale"> This data is stale.</strong> : null}
      </p>
      <ConnectionActions
        connection={connection}
        onChanged={props.onChanged}
        onDisconnected={(revocation) => props.onDisconnected(revocationText(revocation))}
      />
    </li>
  );
}

export function ConnectionsPage() {
  const list = useLoad(() => api.connections(), "connections");
  const now = useNow(30_000);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <main>
      <div className="row spread">
        <h1>Connections</h1>
        <a className="button" href={href({ page: "connect" })}>
          Connect an account
        </a>
      </div>
      {notice === null ? null : <output>{notice}</output>}
      <ErrorText message={list.error} />
      {list.data === null ? (
        list.error === null ? (
          <p aria-busy="true">Loading...</p>
        ) : null
      ) : list.data.connections.length === 0 ? (
        <p>
          No accounts connected yet. <a href={href({ page: "connect" })}>Connect one</a>.
        </p>
      ) : (
        <ul className="cards">
          {list.data.connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              now={now}
              onChanged={list.reload}
              onDisconnected={(text) => {
                setNotice(text);
                list.reload();
              }}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
