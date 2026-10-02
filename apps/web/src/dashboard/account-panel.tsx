import { useId, type ReactNode } from "react";

import { api, type OverviewConnection } from "../api.ts";
import { AlertIcon, ClockIcon, PauseIcon, PlayIcon, RetryIcon } from "../icons.tsx";
import {
  accountName,
  planLabel,
  providerName,
  refreshFailed,
  statusOf,
} from "@headroom/view-model/labels";
import { useNow } from "../lib/now.ts";
import { presentPanel } from "@headroom/view-model/present";
import { useSettings } from "../lib/settings.tsx";
import { When } from "../lib/when.tsx";
import { ActionButton } from "../ui/action-button.tsx";
import { BankedResets } from "../ui/banked-resets.tsx";
import { ButtonLink } from "../ui/button.tsx";
import { cx } from "../ui/cx.ts";
import { HoldButton } from "../ui/hold-button.tsx";
import { HealthyStatus, StatusPill, StatusSlot, statusKindOf } from "../ui/pill.tsx";
import { href } from "../router.ts";
import { PanelActions } from "./actions.tsx";
import { AccountTitle } from "./account-title.tsx";
import { CellView } from "./cells.tsx";
import { SkeletonCells } from "./skeletons.tsx";

const resetReloadMs = 2400;

const reconnectWords: Record<NonNullable<OverviewConnection["reconnectReason"]>, string> = {
  refresh_rejected: "The sign-in for this account has expired. Reconnect to keep tracking it.",
  token_rejected: "The sign-in for this account has expired. Reconnect to keep tracking it.",
  identity_changed:
    "This sign-in now belongs to a different account. Reconnect to keep tracking it.",
  revoked_by_owner: "Access to this account was revoked. Reconnect to keep tracking it.",
};

function Notice(props: {
  readonly tone: "bad" | "warn" | "neutral";
  readonly icon: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className={cx("notice", props.tone)}>
      <span className="text">
        {props.icon}
        {props.children}
      </span>
      {props.action}
    </div>
  );
}

/** One account: header, a notice when it needs attention, its figures, and its facts and actions. */
export function AccountPanel(props: {
  readonly connection: OverviewConnection;
  readonly closed: boolean;
  readonly onChanged: () => Promise<void>;
  readonly onDisconnected: (id: string) => void;
}) {
  const { connection, onChanged } = props;
  const headingId = useId();
  const { actionsEnabled } = useSettings();
  const status = statusOf(connection);
  const now = useNow();
  const model = presentPanel(connection, now);
  const disconnected = connection.state === "reconnect_required";
  const paused = connection.state === "paused";
  const waiting = connection.snapshot === null && !disconnected && !paused;
  const hold = model.hold;
  const banked = model.banked;

  const resume = async (): Promise<void> => {
    try {
      await api.pause(connection.id, false);
    } finally {
      await onChanged();
    }
  };

  let notice: ReactNode = null;
  if (disconnected) {
    notice = (
      <Notice
        tone="bad"
        icon={<AlertIcon />}
        action={
          <ButtonLink
            variant="primary"
            size="sm"
            href={href({ page: "reconnect", id: connection.id })}
          >
            Reconnect
          </ButtonLink>
        }
      >
        {reconnectWords[connection.reconnectReason ?? "refresh_rejected"]}
      </Notice>
    );
  } else if (paused) {
    notice = (
      <Notice
        tone="neutral"
        icon={<PauseIcon />}
        action={
          <ActionButton
            size="sm"
            icon={<PlayIcon />}
            label="Resume"
            pendingLabel="Resuming"
            successLabel="Resumed"
            failedLabel="Failed"
            onAction={resume}
          />
        }
      >
        Paused. Headroom is not refreshing this account.
      </Notice>
    );
  } else if (waiting) {
    notice = (
      <Notice tone="neutral" icon={<ClockIcon />}>
        Connected just now. The first refresh is running.
      </Notice>
    );
  } else if (refreshFailed(connection.latestRun)) {
    notice = (
      <Notice tone="neutral" icon={<RetryIcon />}>
        Headroom could not refresh this account. It will try again in a few minutes.
      </Notice>
    );
  } else if (connection.stale) {
    notice = (
      <Notice tone="warn" icon={<ClockIcon />}>
        {`${providerName(connection.provider)} has not answered for a while. The numbers below are from the last good refresh.`}
      </Notice>
    );
  }

  let right: ReactNode;
  let statusKey: string = status.word;
  if (waiting) {
    statusKey = "waiting";
    right = <StatusPill kind="waiting" />;
  } else if (status.word === "Active" && connection.lastSuccessAt !== null) {
    right = <HealthyStatus age={<When at={connection.lastSuccessAt} kind="ago" />} />;
  } else {
    right = <StatusPill kind={statusKindOf(status.word)} />;
  }

  const showFacts = model.facts.length > 0 || hold !== null || banked !== null || !waiting;
  return (
    <div className={cx("collapse", props.closed && "closed")}>
      <section
        className={cx("panel", (disconnected || paused) && "dim", paused && "paused")}
        aria-labelledby={headingId}
      >
        <header>
          <AccountTitle
            id={connection.id}
            headingId={headingId}
            name={accountName(connection)}
            custom={connection.name?.trim() ? connection.name.trim() : null}
            plan={planLabel(connection.plan)}
            identity={connection.identity}
            onRenamed={onChanged}
          />
          <div className="right">
            <StatusSlot statusKey={statusKey}>{right}</StatusSlot>
          </div>
        </header>
        {notice}
        {waiting && model.cells.length === 0 ? <SkeletonCells count={2} /> : null}
        {model.cells.length === 0 ? null : (
          <div className="cells">
            {model.cells.map((cell, index) => (
              <CellView key={cell.key} cell={cell} index={index} />
            ))}
          </div>
        )}
        {showFacts ? (
          <div className="facts">
            {hold === null && banked === null ? null : (
              <span className="lead">
                {hold === null ? null : (
                  <HoldButton
                    size="sm"
                    label="Hold to Reset Limits"
                    // Follows the Settings switch directly; the server refuses the action whenever the saved setting is off.
                    off={!actionsEnabled}
                    onConfirm={async () => {
                      try {
                        const outcome = await api.consumeResetCredit(connection.id, hold.creditId);
                        setTimeout(() => void onChanged(), resetReloadMs);
                        return outcome.action.state === "succeeded" ? "ok" : "failed";
                      } catch {
                        return "failed";
                      }
                    }}
                  />
                )}
                {banked === null ? null : <BankedResets {...banked} />}
              </span>
            )}
            {model.facts.map((fact) => (
              <span className="kv" key={fact.key}>
                {fact.label} <b>{fact.value}</b>
              </span>
            ))}
            {waiting ? null : (
              <PanelActions
                id={connection.id}
                paused={paused}
                signedIn={!disconnected}
                onChanged={onChanged}
                onDisconnected={() => props.onDisconnected(connection.id)}
              />
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
