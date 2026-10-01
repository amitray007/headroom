import { useState } from "react";

import { api } from "./api.ts";
import { ConnectionActions, ErrorText, revocationText, StateBadge } from "./components.tsx";
import { formatAge, formatDateTime, formatMetricValue } from "./format.ts";
import { useLoad, useNow } from "./hooks.ts";
import { href } from "./router.ts";

export function DetailPage(props: { readonly id: string }) {
  const detail = useLoad(() => api.connection(props.id), `detail:${props.id}`);
  const now = useNow(30_000);
  const [removed, setRemoved] = useState<string | null>(null);

  if (removed !== null) {
    return (
      <main>
        <output>{removed}</output>
        <a href={href({ page: "connections" })}>Back to connections</a>
      </main>
    );
  }
  if (detail.data === null) {
    return (
      <main>
        <ErrorText message={detail.error} />
        {detail.error === null ? <p aria-busy="true">Loading...</p> : null}
      </main>
    );
  }
  const { connection, capabilities, snapshot, latestRun } = detail.data;
  return (
    <main>
      <p>
        <a href={href({ page: "connections" })}>Connections</a>
      </p>
      <div className="row spread">
        <h1>
          {connection.provider} - {connection.label}
        </h1>
        <span className="row">
          {connection.interface === "private" ? (
            <span className="tag">private interface</span>
          ) : null}
          <StateBadge state={connection.state} />
        </span>
      </div>
      <p>
        Scope {connection.scope}, signed in by {connection.authMethod}.
        {connection.lastSuccessAt === null
          ? " No successful collection yet."
          : ` Last success ${formatAge(connection.lastSuccessAt, now)}.`}
      </p>
      <ConnectionActions
        connection={connection}
        onChanged={detail.reload}
        onDisconnected={(revocation) => setRemoved(revocationText(revocation))}
      />
      <ErrorText message={detail.error} />

      <h2>Latest run</h2>
      {latestRun === null ? (
        <p>No collection has run yet.</p>
      ) : (
        <p>
          {formatDateTime(latestRun.startedAt)}: {latestRun.outcome ?? "in progress"}
          {latestRun.sanitizedError === null ? "" : ` - ${latestRun.sanitizedError}`}
        </p>
      )}

      <h2>Metrics</h2>
      {snapshot === null ? (
        <p>No snapshot yet.</p>
      ) : (
        <>
          <p>
            Observed {formatDateTime(snapshot.observedAt)}, received{" "}
            {formatDateTime(snapshot.receivedAt)}, connector {snapshot.connectorVersion}.
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Kind</th>
                <th scope="col">Scope</th>
                <th scope="col">Value</th>
                <th scope="col">Availability</th>
                <th scope="col">Resets at</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.metrics.map((metric) => (
                <tr key={`${metric.providerMetricKey}:${metric.scope}`}>
                  <th scope="row">{metric.providerMetricKey}</th>
                  <td>{metric.kind}</td>
                  <td>{metric.scope}</td>
                  <td>{formatMetricValue(metric)}</td>
                  <td>{metric.availability}</td>
                  <td>{formatDateTime(metric.resetsAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {snapshot.resetCredits.length === 0 ? null : (
            <>
              <h2>Reset credits</h2>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Credit</th>
                    <th scope="col">Eligible</th>
                    <th scope="col">Usable</th>
                    <th scope="col">Expires</th>
                    <th scope="col">Cooldown until</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.resetCredits.map((credit) => (
                    <tr key={credit.providerCreditId}>
                      <th scope="row">{credit.rawLabel ?? credit.providerCreditId}</th>
                      <td>{credit.eligible ? "yes" : "no"}</td>
                      <td>{credit.usable ? "yes" : "no"}</td>
                      <td>{formatDateTime(credit.expiresAt)}</td>
                      <td>{formatDateTime(credit.cooldownUntil)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      <h2>Capabilities</h2>
      {capabilities.length === 0 ? (
        <p>None recorded.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Metric or action</th>
              <th scope="col">Availability</th>
              <th scope="col">Interface</th>
              <th scope="col">Evidence</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {capabilities.map((capability) => (
              <tr key={capability.metricOrAction}>
                <th scope="row">{capability.metricOrAction}</th>
                <td>{capability.availability}</td>
                <td>{capability.interface}</td>
                <td>{capability.evidenceLevel}</td>
                <td>{capability.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
