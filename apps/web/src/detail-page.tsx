import { useState } from "react";

import { type ActionOutcome, api, type ConnectionDetail } from "./api.ts";
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
  const { connection, capabilities, snapshot, latestRun, actions } = detail.data;
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
            <ResetCredits
              connectionId={connection.id}
              credits={snapshot.resetCredits}
              actions={actions}
              onChanged={detail.reload}
            />
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

/**
 * Reset credits with their own expiry each, and the Consume action when the connector supports
 * it. Consuming spends a real credit on the owner's account, so the button asks for confirmation
 * naming the credit and its expiry, and the server refuses unless actions are switched on.
 */
function ResetCredits(props: {
  readonly connectionId: string;
  readonly credits: NonNullable<ConnectionDetail["snapshot"]>["resetCredits"];
  readonly actions: ConnectionDetail["actions"];
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canConsume = props.actions.supported.includes("consume_reset_credit");

  async function consume(credit: (typeof props.credits)[number]): Promise<void> {
    const name = credit.rawLabel ?? credit.providerCreditId;
    const expiry =
      credit.expiresAt === null ? "no expiry" : `expires ${formatDateTime(credit.expiresAt)}`;
    const ok = window.confirm(
      `Consume this reset credit now?\n\n${name} (${expiry})\n\nThis spends the credit on your account and cannot be undone.`,
    );
    if (!ok) return;
    setBusy(credit.providerCreditId);
    setError(null);
    try {
      setOutcome(await api.consumeResetCredit(props.connectionId, credit.providerCreditId));
      props.onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h2>Reset credits</h2>
      {canConsume && !props.actions.enabled ? (
        <p className="muted">
          Consuming a credit is switched off. Start Headroom with HEADROOM_ENABLE_ACTIONS=true to
          allow it.
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th scope="col">Credit</th>
            <th scope="col">Eligible</th>
            <th scope="col">Usable</th>
            <th scope="col">Expires</th>
            <th scope="col">Cooldown until</th>
            {canConsume ? <th scope="col">Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {props.credits.map((credit) => (
            <tr key={credit.providerCreditId}>
              <th scope="row">{credit.rawLabel ?? credit.providerCreditId}</th>
              <td>{credit.eligible ? "yes" : "no"}</td>
              <td>{credit.usable ? "yes" : "no"}</td>
              <td>{formatDateTime(credit.expiresAt)}</td>
              <td>{formatDateTime(credit.cooldownUntil)}</td>
              {canConsume ? (
                <td>
                  <button
                    type="button"
                    disabled={!props.actions.enabled || !credit.usable || busy !== null}
                    onClick={() => void consume(credit)}
                  >
                    {busy === credit.providerCreditId ? "Consuming..." : "Consume"}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {outcome === null ? null : (
        <output>
          Consume {outcome.action.state}
          {outcome.action.sanitizedError === null ? "" : `: ${outcome.action.sanitizedError}`}
          {outcome.action.state === "uncertain"
            ? " The provider gave no clear answer; check the metrics above before trying again."
            : ""}
        </output>
      )}
      <ErrorText message={error} />
    </>
  );
}
