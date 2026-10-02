import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { Provider } from "@headroom/core/contracts";

import { api, type OverviewConnection } from "../api.ts";
import { BrandMark, UserIcon } from "../icons.tsx";
import { accountName, groupByProvider, planLabel, providerName, statusOf } from "../lib/labels.ts";
import { messageOf } from "../lib/load.ts";
import { When } from "../lib/when.tsx";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";
import { StatusPill, type StatusKind } from "../ui/pill.tsx";
import { LimitsCell } from "./limits.tsx";
import { TableSkeleton } from "./skeletons.tsx";
import { RowActions, type RowHandlers } from "./row-actions.tsx";

const statusKinds: Record<ReturnType<typeof statusOf>["word"], StatusKind> = {
  Active: "active",
  Paused: "paused",
  Disconnected: "disconnected",
  "Refresh Failed": "refresh_failed",
  "Out of Date": "out_of_date",
};

function Tally(props: { readonly connections: readonly OverviewConnection[] }) {
  const { connections } = props;
  const paused = connections.filter((entry) => entry.state === "paused").length;
  const disconnected = connections.filter((entry) => entry.state === "reconnect_required").length;
  const active = connections.length - paused - disconnected;
  const total = connections.length;
  const spoken = [
    `${active} active`,
    paused > 0 ? `${paused} paused` : null,
    disconnected > 0 ? `${disconnected} disconnected` : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
  return (
    <span className="tally" aria-label={`${total} accounts: ${spoken}`}>
      {active > 0 ? (
        <span className="tally-item">
          <span className="tdot good" />
          {active} Active
        </span>
      ) : null}
      {paused > 0 ? (
        <span className="tally-item">
          <span className="tdot quiet" />
          {paused} Paused
        </span>
      ) : null}
      {disconnected > 0 ? (
        <span className="tally-item">
          <span className="tdot bad" />
          {disconnected} Disconnected
        </span>
      ) : null}
      <span className="tally-sep" aria-hidden="true" />
      <span className="tally-item total">
        {total} {total === 1 ? "Account" : "Accounts"}
      </span>
    </span>
  );
}

/** The name as a field. Enter saves, Escape cancels, leaving the field saves. */
function RenameInput(props: {
  readonly initial: string;
  readonly onDone: (name: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(props.initial);
  useEffect(() => {
    // The menu returns focus to its button as it closes; take it back afterwards.
    const timer = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const finish = (save: boolean): void => {
    if (finished.current) return;
    finished.current = true;
    const next = value.trim();
    props.onDone(save && next !== "" && next !== props.initial ? next : null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };
  return (
    <input
      ref={ref}
      className="name-edit"
      aria-label="Account name"
      maxLength={40}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  );
}

function AccountRow(props: {
  readonly connection: OverviewConnection;
  readonly editing: boolean;
  readonly busy: boolean;
  readonly handlers: RowHandlers;
  readonly onRenamed: (name: string | null) => void;
}) {
  const { connection } = props;
  const name = accountName(connection);
  const plan = planLabel(connection.plan);
  const status = statusOf(connection);
  return (
    <tr>
      <td className="tname">
        {props.editing ? (
          <RenameInput initial={name} onDone={props.onRenamed} />
        ) : (
          <span className="name">{name}</span>
        )}
        {plan === null || props.editing ? null : (
          <span className="plan">
            <span className="sep" aria-hidden="true">
              ·
            </span>
            {plan}
          </span>
        )}
        <span className="twho">
          {connection.identity === null || connection.identity === "" ? (
            <span className="muted">No identity reported</span>
          ) : (
            <span className="who">{connection.identity}</span>
          )}
        </span>
      </td>
      <LimitsCell connection={connection} />
      <td className="tstatus">
        <span className="status-slot">
          <StatusPill kind={statusKinds[status.word]} />
        </span>
      </td>
      <td className="tlast">
        {connection.lastSuccessAt === null ? (
          "Not yet"
        ) : (
          <When at={connection.lastSuccessAt} kind="ago" />
        )}
      </td>
      <td className="tacts">
        <RowActions
          connection={connection}
          name={name}
          busy={props.busy}
          handlers={props.handlers}
        />
      </td>
    </tr>
  );
}

function ProviderGroup(props: {
  readonly provider: Provider;
  readonly connections: readonly OverviewConnection[];
  readonly editingId: string | null;
  readonly busyId: string | null;
  readonly handlers: RowHandlers;
  readonly onRenamed: (connection: OverviewConnection, name: string | null) => void;
}) {
  const count = props.connections.length;
  return (
    <tbody className="tgroup">
      <tr className="tgroup-row">
        <th scope="rowgroup" colSpan={5}>
          <BrandMark provider={props.provider} />
          {providerName(props.provider)}
          {count > 1 ? <span className="muted">{count} accounts</span> : null}
        </th>
      </tr>
      {props.connections.map((connection) => (
        <AccountRow
          key={connection.id}
          connection={connection}
          editing={props.editingId === connection.id}
          busy={props.busyId === connection.id}
          handlers={props.handlers}
          onRenamed={(name) => props.onRenamed(connection, name)}
        />
      ))}
    </tbody>
  );
}

const revocationNotice = {
  revoked: null,
  local_only: "Removed from Headroom. The provider has no way to revoke its sign-in.",
  failed: "Removed from Headroom. The provider could not be told to revoke its sign-in.",
} as const;

/** The Connected Accounts table with its row actions. `reload` loads the overview again. */
export function AccountsTable(props: {
  readonly connections: readonly OverviewConnection[];
  /** Loading shows placeholder rows; failed shows a notice with Try Again; ready shows the accounts or the empty state. */
  readonly status: "loading" | "failed" | "ready";
  /** The overview is loading again, so Try Again shows its busy state. */
  readonly retrying: boolean;
  readonly reload: () => void;
}) {
  const { connections, reload, status } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<OverviewConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(id: string, work: () => Promise<void>): Promise<boolean> {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await work();
      reload();
      return true;
    } catch (cause) {
      setError(messageOf(cause));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  const handlers: RowHandlers = {
    onPause: (connection, paused) =>
      void run(connection.id, () => api.pause(connection.id, paused).then(() => undefined)),
    onRename: (connection) => setEditingId(connection.id),
    onRemove: (connection) => setConfirming(connection),
  };

  function renamed(connection: OverviewConnection, name: string | null): void {
    setEditingId(null);
    if (name === null) return;
    void run(connection.id, () => api.rename(connection.id, name).then(() => undefined));
  }

  async function confirmRemove(): Promise<void> {
    const connection = confirming;
    if (connection === null) return;
    const done = await run(connection.id, async () => {
      const result = await api.disconnect(connection.id);
      setNotice(revocationNotice[result.revocation]);
    });
    if (done) setConfirming(null);
  }

  const removing = confirming?.state === "reconnect_required";
  const confirmName = confirming === null ? "" : accountName(confirming);
  const groups = groupByProvider(connections);
  return (
    <section className="panel tablecard" aria-labelledby="connected-title">
      <div className="thead-row">
        <h2 id="connected-title">Connected Accounts</h2>
        {status !== "ready" || connections.length === 0 ? null : (
          <Tally connections={connections} />
        )}
      </div>
      {error === null && notice === null ? null : (
        <output className="table-note">{error ?? notice}</output>
      )}
      {status === "loading" ? <TableSkeleton /> : null}
      {status === "failed" ? (
        <div className="table-state">
          <ErrorNotice inline busy={props.retrying} onRetry={reload}>
            Headroom could not load your accounts. Check that it is running and try again.
          </ErrorNotice>
        </div>
      ) : null}
      {status === "ready" && groups.length === 0 ? (
        <EmptyState compact icon={<UserIcon />} title="No Accounts Yet">
          Accounts you connect appear here, with their limits and status.
        </EmptyState>
      ) : null}
      {status === "ready" && groups.length > 0 ? (
        <div className="tscroll">
          <table className="accounts">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Limits</th>
                <th scope="col">Status</th>
                <th scope="col">Last Refreshed</th>
                <th scope="col">
                  <span className="sr">Actions</span>
                </th>
              </tr>
            </thead>
            {groups.map((group) => (
              <ProviderGroup
                key={group.provider}
                provider={group.provider}
                connections={group.connections}
                editingId={editingId}
                busyId={busyId}
                handlers={handlers}
                onRenamed={renamed}
              />
            ))}
          </table>
        </div>
      ) : null}
      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={removing ? `Remove ${confirmName}?` : `Disconnect ${confirmName}?`}
      >
        <section className="dsec">
          <p className="secondary" style={{ margin: 0 }}>
            {removing
              ? "Headroom forgets this account and its saved data."
              : "Its saved sign-in is deleted and Headroom stops tracking it."}
          </p>
          <div className="row">
            <Button variant="quiet" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              busy={confirming !== null && busyId === confirming.id}
              busyLabel={removing ? "Removing" : "Disconnecting"}
              onClick={() => void confirmRemove()}
            >
              {removing ? "Remove" : "Disconnect"}
            </Button>
          </div>
        </section>
      </Dialog>
    </section>
  );
}
