import { useState } from "react";

import { BrandMark, ReorderIcon } from "../../icons.tsx";
import { AddAccountLink, LoadFailed, NoAccounts } from "../../dashboard/states.tsx";
import { providerName } from "../../lib/labels.ts";
import { useSettings } from "../../lib/settings.tsx";
import { useOpenSettings } from "../../shell/open-settings.ts";
import { Button } from "../../ui/button.tsx";
import { cx } from "../../ui/cx.ts";
import { Fold } from "../../ui/fold.tsx";
import { ProviderChips, type ProviderFilter } from "../../ui/provider-chips.tsx";
import { Segmented } from "../../ui/segmented.tsx";
import type { ViewProps } from "../props.ts";
import { arrange, matches, providerCounts, type DetailedOrder, type Section } from "./arrange.ts";
import { AccountRow } from "./row.tsx";
import { DetailedSkeleton } from "./skeleton.tsx";
import "./detailed.css";

const orders: readonly { readonly value: DetailedOrder; readonly label: string }[] = [
  { value: "urgency", label: "By Urgency" },
  { value: "provider", label: "By Provider" },
  { value: "custom", label: "Custom" },
];

const limitViews = [
  { value: "left", label: "Left" },
  { value: "used", label: "Used" },
] as const;

/** "3 Accounts". Keeps the last count while its group folds away, so the words do not change on the way out. */
function AccountCount(props: { readonly count: number }) {
  const [shown, setShown] = useState(props.count);
  if (props.count > 0 && props.count !== shown) setShown(props.count);
  return <span className="chip count">{`${shown} ${shown === 1 ? "Account" : "Accounts"}`}</span>;
}

function GroupHead(props: { readonly section: Section; readonly visible: number }) {
  const { section } = props;
  if (section.kind === "provider" && section.provider !== null) {
    return (
      <header className="d-group-head">
        <BrandMark provider={section.provider} size={24} />
        <h2>{providerName(section.provider)}</h2>
        {section.connections.length > 1 ? <AccountCount count={props.visible} /> : null}
      </header>
    );
  }
  return (
    <header className="d-group-head small">
      <h2>Inactive</h2>
      <AccountCount count={props.visible} />
    </header>
  );
}

/** Every account as one row, in the owner's order, with a provider filter and inline detail. */
export function DetailedPage(props: ViewProps) {
  const { connections, providerOrder, failed, stale, reload } = props.overview;
  const store = useSettings();
  const { settings, loaded, loadFailed } = store;
  const openSettings = useOpenSettings();
  const [filter, setFilter] = useState<ProviderFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  // The order is the saved Default Order, so this page and Settings always agree. If the settings never loaded,
  // saving is not safe, so the choice stays on this page until reload.
  const [localOrder, setLocalOrder] = useState<DetailedOrder | null>(null);
  const [retrying, setRetrying] = useState(false);

  const retry = (): void => {
    setRetrying(true);
    void reload().finally(() => setRetrying(false));
  };

  if (connections === null) {
    return failed ? (
      <LoadFailed stale={false} busy={retrying} onRetry={retry} />
    ) : (
      <DetailedSkeleton />
    );
  }
  if (!loaded) return <DetailedSkeleton />;
  if (connections.length === 0) {
    return (
      <div className="reveal">
        <NoAccounts />
      </div>
    );
  }

  const order = loadFailed ? (localOrder ?? settings.detailedOrder) : settings.detailedOrder;
  const counts = providerCounts(connections, providerOrder);
  // A filter on a provider that has no accounts any more is the same as All.
  const active = counts.some((entry) => entry.provider === filter) ? filter : "all";
  const sections = arrange(connections, {
    order,
    providerOrder,
    keepInactiveLast: settings.keepInactiveLast,
    lowThreshold: settings.lowThresholdPercent,
  });

  return (
    <div className="reveal d-page">
      {stale ? <LoadFailed stale busy={retrying} onRetry={retry} /> : null}
      <div className="d-tools">
        <ProviderChips
          label="Filter by provider"
          value={active}
          onChange={setFilter}
          total={connections.length}
          options={counts.map((entry) => ({
            provider: entry.provider,
            label: providerName(entry.provider),
            count: entry.count,
          }))}
        />
        <div className="d-segs">
          <Segmented
            label="Order"
            value={order}
            options={orders}
            onChange={(next) => {
              if (loadFailed) setLocalOrder(next);
              else void store.update({ detailedOrder: next });
            }}
          />
          <Segmented
            label="Show limits as"
            value={settings.limitsView}
            options={limitViews}
            onChange={(limitsView) => void store.update({ limitsView })}
          />
          <Button
            variant="quiet"
            size="sm"
            className="d-arrange"
            icon={<ReorderIcon />}
            onClick={() => openSettings("detailed")}
          >
            Arrange
          </Button>
        </div>
      </div>
      <div className="d-list">
        {sections.map((section) => {
          const visible = section.connections.filter((entry) => matches(entry, active)).length;
          return (
            <Fold
              key={section.key}
              closed={visible === 0}
              className={cx("d-group", section.kind === "provider" && "by-provider")}
            >
              {section.kind === "list" ? null : <GroupHead section={section} visible={visible} />}
              {section.connections.map((entry) => (
                <AccountRow
                  key={entry.id}
                  connection={entry}
                  hidden={!matches(entry, active)}
                  showProvider={section.kind !== "provider"}
                  open={openId === entry.id}
                  onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
                />
              ))}
            </Fold>
          );
        })}
      </div>
      <AddAccountLink />
    </div>
  );
}
