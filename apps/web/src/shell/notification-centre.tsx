import type { CSSProperties, ReactNode } from "react";

import { AlertIcon, BellIcon, CheckIcon, ClockIcon, ResetIcon } from "../icons.tsx";
import { When } from "../lib/when.tsx";
import type { NotificationsView } from "../lib/use-notifications.ts";
import { Button } from "../ui/button.tsx";
import { cx } from "../ui/cx.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { Popover } from "../ui/menu.tsx";
import { LoadingNote, Sk } from "../ui/skeleton.tsx";

const icons: Record<string, ReactNode> = {
  bad: <AlertIcon />,
  warn: <ClockIcon />,
  info: <ResetIcon />,
};

function indexStyle(index: number): CSSProperties {
  const style: CSSProperties & Record<string, string> = {};
  style["--index"] = String(index);
  return style;
}

/** Two rows in the final layout while the first load runs. */
function NotificationsSkeleton() {
  return (
    <>
      <LoadingNote>Loading notifications</LoadingNote>
      <ul className="nlist" aria-busy="true">
        {[0, 1].map((index) => (
          <li key={index} className="nrow sk-item" aria-hidden="true">
            <Sk width={32} height={32} className="sk-pill" />
            <span className="nbody">
              <Sk width={index === 0 ? "70%" : "58%"} />
              <Sk width="90%" />
            </span>
            <Sk width={36} />
          </li>
        ))}
      </ul>
    </>
  );
}

function subline(view: NotificationsView): string {
  if (view.status === "loading") return "Checking for updates";
  if (view.status === "unavailable") return "Could not check";
  if (view.items.length === 0) return "Nothing to report";
  if (view.unread === 0) return "You are all caught up";
  return `${view.unread} ${view.unread === 1 ? "update" : "updates"} waiting for you`;
}

/** The bell with its unread badge and the list it opens. Unread rows are tinted. */
export function NotificationCentre(props: { readonly notifications: NotificationsView }) {
  const { items, unread, status } = props.notifications;
  const sub = subline(props.notifications);
  return (
    <Popover
      label={unread === 0 ? "Notifications" : `Notifications, ${unread} unread`}
      triggerClassName="bell"
      panelLabel="Notifications"
      openOnHover
      trigger={
        <>
          <BellIcon />
          <span className={cx("badge", "num", unread === 0 && "zero")} aria-hidden="true">
            {unread === 0 ? "" : unread}
          </span>
        </>
      }
    >
      <div className="nhead">
        <div>
          <h2>Notifications</h2>
          <p className="nsub">{sub}</p>
        </div>
        <Button
          variant="quiet"
          size="sm"
          disabled={unread === 0}
          onClick={props.notifications.markAllRead}
        >
          Mark All as Read
        </Button>
      </div>
      {status === "loading" ? <NotificationsSkeleton /> : null}
      {status === "unavailable" ? (
        <EmptyState compact icon={<AlertIcon />} title="Updates Unavailable">
          Headroom could not load your accounts, so there is nothing to report yet.
        </EmptyState>
      ) : null}
      {status === "ready" && items.length === 0 ? (
        <EmptyState compact icon={<CheckIcon />} title="You Are All Caught Up">
          Limits, resets and refresh problems show up here.
        </EmptyState>
      ) : null}
      {status === "ready" && items.length > 0 ? (
        <ul className="nlist">
          {items.map((item, index) => (
            <li
              key={item.id}
              className={cx("nrow", !item.read && "unread")}
              data-tone={item.tone}
              style={indexStyle(index)}
            >
              <span className="nicon">{icons[item.tone]}</span>
              <span className="nbody">
                <span className="ntitle">{item.title}</span>
                <span className="ndesc">{item.description}</span>
              </span>
              <span className="ntime">
                <When at={item.at} kind="ago" />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Popover>
  );
}
