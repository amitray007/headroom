import { useEffect, useRef, useState, type ReactNode } from "react";

import { api, ApiError, type ChannelView } from "../../api.ts";
import { BellIcon } from "../../icons.tsx";
import { useNow } from "../../lib/now.ts";
import { ActionButton } from "../../ui/action-button.tsx";
import { Button } from "../../ui/button.tsx";
import { cx } from "../../ui/cx.ts";
import { Switch } from "../../ui/switch.tsx";
import { SwitchRow } from "../settings-rows.tsx";
import { changeProblem, statusLine, testProblem } from "./status.ts";

/** Remove, in two steps: the first press asks, the second confirms. The question lapses after a few seconds. */
function RemoveButton(props: { readonly onRemove: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const press = (): void => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    clearTimeout(timer.current);
    setBusy(true);
    void props.onRemove().finally(() => {
      setBusy(false);
      setArmed(false);
    });
  };
  return (
    <Button
      size="sm"
      variant="quiet-danger"
      busy={busy}
      busyLabel="Removing"
      onClick={press}
      onBlur={() => {
        if (!busy) setArmed(false);
      }}
    >
      {armed ? "Confirm Remove" : "Remove"}
    </Button>
  );
}

/**
 * A set-up channel: its name, last result and On switch, then Include Account Email and the actions. The
 * owner's own buttons (Change, New Secret) arrive as `actions`. Every change goes to the server and the list
 * reloads, so the server stays the source of truth.
 */
export function ChannelPanel(props: {
  readonly channel: ChannelView;
  readonly title: string;
  readonly actions: ReactNode;
  readonly reload: () => void;
}) {
  const { channel, reload } = props;
  const now = useNow();
  const line = statusLine(channel, now);
  const [error, setError] = useState<string | null>(null);
  const [testFailure, setTestFailure] = useState<string | null>(null);

  const patch = (change: { enabled?: boolean; includeIdentity?: boolean }): void => {
    setError(null);
    api
      .updateChannel(channel.id, change)
      .catch(() => setError(changeProblem))
      .finally(reload);
  };
  const test = async (): Promise<void> => {
    setTestFailure(null);
    try {
      await api.testChannel(channel.id);
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : null;
      setTestFailure(testProblem(channel.type, code));
      throw cause;
    } finally {
      reload();
    }
  };
  const remove = async (): Promise<void> => {
    try {
      await api.deleteChannel(channel.id);
    } catch {
      setError(changeProblem);
    }
    reload();
  };

  return (
    <>
      <div className="srow">
        <span className="sbody">
          <b>{props.title}</b>
          <span className="muted">{channel.label}</span>
          <span className={cx("muted", "dl-status", line.tone)}>{line.text}</span>
        </span>
        <Switch
          checked={channel.enabled}
          label={`${props.title} On`}
          onChange={(enabled) => patch({ enabled })}
        />
      </div>
      <SwitchRow
        title="Include Account Email"
        note="Adds the email or login of each account."
        checked={channel.includeIdentity}
        onChange={(includeIdentity) => patch({ includeIdentity })}
      />
      <div className="dl-actions">
        <ActionButton
          size="sm"
          variant="quiet"
          icon={<BellIcon />}
          label="Send Test"
          pendingLabel="Sending"
          successLabel="Sent"
          failedLabel="Not Sent"
          onAction={test}
        />
        {props.actions}
        <RemoveButton onRemove={remove} />
      </div>
      {testFailure === null ? null : (
        <p className="form-error dl-problem" role="alert">
          {testFailure}
        </p>
      )}
      {error === null ? null : (
        <p className="form-error dl-problem" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
