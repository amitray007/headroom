import "./compare.css";

import type { Provider } from "@headroom/core/contracts";
import { useId, useState } from "react";

import { LoadFailed, NoAccounts } from "../../dashboard/states.tsx";
import { groupByProvider, providerName } from "../../lib/labels.ts";
import { useSettings } from "../../lib/settings.tsx";
import { ProviderTabs } from "../../ui/provider-tabs.tsx";
import { Segmented } from "../../ui/segmented.tsx";
import type { ViewProps } from "../props.ts";
import {
  columnsOf,
  defaultSort,
  nextSort,
  pickBest,
  rowOf,
  sortRows,
  type Row,
  type Sort,
} from "./compare-model.ts";
import type { Look } from "./figure.ts";
import { Matrix } from "./matrix.tsx";
import { Recommended } from "./recommended.tsx";
import { SingleCard } from "./singles.tsx";
import { CompareSkeleton } from "./skeleton.tsx";

interface Group {
  readonly provider: Provider;
  readonly rows: Row[];
}

const limitOptions = [
  { value: "left", label: "Left" },
  { value: "used", label: "Used" },
] as const;

/** A sort choice belongs to the provider it was made on; another provider starts at the default. */
interface Chosen {
  readonly provider: Provider | null;
  readonly sort: Sort;
}

/**
 * Compare: for providers with two or more accounts, the account to use now and a matrix of every window side by
 * side; for providers with one account, a compact card below.
 */
export function ComparePage(props: ViewProps) {
  const { connections, providerOrder, failed, stale } = props.overview;
  const store = useSettings();
  const { settings, loaded } = store;
  const panelId = useId();
  const [chosen, setChosen] = useState<Chosen>({ provider: null, sort: defaultSort });
  const [retrying, setRetrying] = useState(false);

  const groups: Group[] = groupByProvider(connections ?? [], providerOrder).map((group) => ({
    provider: group.provider,
    rows: group.connections.map(rowOf),
  }));
  const multi = groups.filter((group) => group.rows.length >= 2);
  const singles = groups.flatMap((group) =>
    group.rows.length === 1 && group.rows[0] !== undefined
      ? [{ provider: group.provider, row: group.rows[0] }]
      : [],
  );
  const active = multi.find((group) => group.provider === chosen.provider) ?? multi[0];
  const sort =
    active !== undefined && chosen.provider === active.provider ? chosen.sort : defaultSort;
  const rows = active === undefined ? [] : sortRows(active.rows, sort);
  const pick = pickBest(active?.rows ?? []);

  const retry = (): void => {
    setRetrying(true);
    void props.overview.reload().finally(() => setRetrying(false));
  };

  if (connections === null) {
    return failed ? (
      <LoadFailed stale={false} busy={retrying} onRetry={retry} />
    ) : (
      <CompareSkeleton />
    );
  }
  // Figures wait for the settings, so Used or Left never flips after they show.
  if (!loaded) return <CompareSkeleton />;
  if (connections.length === 0) {
    return (
      <div className="reveal">
        <NoAccounts />
      </div>
    );
  }

  const look: Look = { view: settings.limitsView, threshold: settings.lowThresholdPercent };
  const name = active === undefined ? "" : providerName(active.provider);
  return (
    <div className="reveal cmp">
      {stale ? <LoadFailed stale busy={retrying} onRetry={retry} /> : null}
      <div className="cmp-tools">
        {active === undefined ? (
          <span />
        ) : (
          <ProviderTabs
            label="Provider"
            panelId={panelId}
            value={active.provider}
            tabs={multi.map((group) => ({
              provider: group.provider,
              name: providerName(group.provider),
              count: group.rows.length,
            }))}
            onChange={(provider) => setChosen({ provider, sort: defaultSort })}
          />
        )}
        <Segmented
          label="Show limits as"
          value={settings.limitsView}
          options={limitOptions}
          onChange={(limitsView) => void store.update({ limitsView })}
        />
      </div>
      {active === undefined ? (
        <p className="cmp-note muted">
          No provider has two or more accounts, so there is nothing to compare yet.
        </p>
      ) : (
        <div
          key={active.provider}
          id={panelId}
          role="tabpanel"
          aria-label={name}
          className="cmp-stage"
        >
          <Recommended pick={pick} providerName={name} total={active.rows.length} look={look} />
          <Matrix
            rows={rows}
            columns={columnsOf(active.rows)}
            sort={sort}
            onSort={(key) => setChosen({ provider: active.provider, sort: nextSort(sort, key) })}
            bestId={pick.best?.connection.id ?? null}
            look={look}
            caption={`${name} accounts and their limits`}
          />
        </div>
      )}
      {singles.length === 0 ? null : (
        <section aria-labelledby={`${panelId}-singles`}>
          <div className="cmp-singles-head">
            <h2 id={`${panelId}-singles`}>Single Accounts</h2>
            <span className="muted">One account each, so nothing to compare</span>
          </div>
          <div className="cmp-singles">
            {singles.map((group) => (
              <SingleCard key={group.provider} row={group.row} look={look} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
