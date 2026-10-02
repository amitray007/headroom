import { useState } from "react";

import { api, ApiError, type ChannelView } from "../../api.ts";
import { BellIcon, DestinationMark } from "../../icons.tsx";
import { useNow } from "../../lib/now.ts";
import { ActionButton } from "../../ui/action-button.tsx";
import { Button } from "../../ui/button.tsx";
import { cx } from "../../ui/cx.ts";
import { Switch } from "../../ui/switch.tsx";
import { SwitchRow } from "../settings-rows.tsx";
import { Problem } from "./form-parts.tsx";
import { RemoveButton } from "./remove-button.tsx";
import { SecretRotation } from "./secret-rotation.tsx";
import { changeProblem, destinationName, statusLine, testProblem } from "./status.ts";

interface Change {
  readonly enabled?: boolean;
  readonly includeIdentity?: boolean;
}

type Instant = { readonly [Key in keyof Change]: Change[Key] | undefined };

/**
 * A set-up channel: its name, last result and On switch, then Include Account Email and the actions. A switch
 * moves at once and goes back if the server refuses. `onChange` opens the setup flow again.
 */
export function ChannelPanel(props: {
  readonly channel: ChannelView;
  readonly reload: () => void;
  readonly onChange: () => void;
}) {
  const { channel, reload } = props;
  const now = useNow();
  const line = statusLine(channel, now);
  const title = destinationName(channel.type);
  const webhook = channel.type === "webhook";
  const [error, setError] = useState<string | null>(null);
  const [testFailure, setTestFailure] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  // Values the owner just set, shown until the reload brings the server's own.
  const [instant, setInstant] = useState<Instant>({});
  const [seen, setSeen] = useState(channel);
  if (seen !== channel) {
    setSeen(channel);
    setInstant({});
  }
  const enabled = instant.enabled ?? channel.enabled;
  const includeIdentity = instant.includeIdentity ?? channel.includeIdentity;

  const patch = (change: Change): void => {
    setError(null);
    setInstant((current) => ({ ...current, ...change }));
    api
      .updateChannel(channel.id, change)
      .then(reload)
      .catch(() => {
        // Undo only what this change set.
        setInstant((current) => ({
          ...current,
          ...(change.enabled === undefined ? {} : { enabled: undefined }),
          ...(change.includeIdentity === undefined ? {} : { includeIdentity: undefined }),
        }));
        setError(changeProblem);
      });
  };
  const test = async (): Promise<void> => {
    setTestFailure(null);
    try {
      await api.testChannel(channel.id);
    } catch (cause) {
      setTestFailure(testProblem(channel.type, cause instanceof ApiError ? cause.code : null));
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
    <section className="dl-panel dl-manage" aria-label={`${title} Settings`}>
      <div className="srow">
        <span className="sbody">
          <b>
            <DestinationMark type={channel.type} size={24} />
            {title}
          </b>
          <span className="muted">{channel.label}</span>
          <span className={cx("muted", "dl-status", line.tone)}>{line.text}</span>
        </span>
        <Switch
          checked={enabled}
          label={`${title} On`}
          onChange={(next) => patch({ enabled: next })}
        />
      </div>
      <SwitchRow
        title="Include Account Email"
        note="Adds the email or login of each account."
        checked={includeIdentity}
        onChange={(next) => patch({ includeIdentity: next })}
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
        <Button size="sm" variant="quiet" onClick={props.onChange}>
          {webhook ? "Change URL" : "Set Up Again"}
        </Button>
        {webhook && !rotating ? (
          <Button size="sm" variant="quiet" onClick={() => setRotating(true)}>
            New Secret
          </Button>
        ) : null}
        <RemoveButton onRemove={remove} />
      </div>
      {webhook && rotating ? (
        <SecretRotation channelId={channel.id} onClose={() => setRotating(false)} />
      ) : null}
      <Problem>{testFailure}</Problem>
      <Problem>{error}</Problem>
    </section>
  );
}
