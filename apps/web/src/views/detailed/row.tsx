import { useId, useState } from "react";

import type { OverviewConnection } from "../../api.ts";
import { BrandMark, ChevronDownIcon } from "../../icons.tsx";
import { isInactive } from "@headroom/view-model/accounts";
import {
  accountName,
  awaitingFirstRefresh,
  planLabel,
  providerName,
  statusOf,
} from "@headroom/view-model/labels";
import { useNow } from "../../lib/now.ts";
import { presentPanel } from "@headroom/view-model/present";
import { When } from "../../lib/when.tsx";
import { cx } from "../../ui/cx.ts";
import { Fold } from "../../ui/fold.tsx";
import { HealthyStatus, StatusPill, statusKindOf } from "../../ui/pill.tsx";
import { RowDetail } from "./detail.tsx";
import { headlineOf, RowLimit, RowReset } from "./limit.tsx";

function RowStatus(props: { readonly connection: OverviewConnection }) {
  const { connection } = props;
  const status = statusOf(connection);
  if (awaitingFirstRefresh(connection)) return <StatusPill kind="waiting" label="Waiting" />;
  if (status.word === "Active" && connection.lastSuccessAt !== null) {
    return <HealthyStatus age={<When at={connection.lastSuccessAt} kind="ago" />} />;
  }
  return <StatusPill kind={statusKindOf(status.word)} />;
}

/** One account as a row: its tightest limit and status, opening inline into the full figures. */
export function AccountRow(props: {
  readonly connection: OverviewConnection;
  /** Hidden by the provider filter: the row folds to zero height. */
  readonly hidden: boolean;
  /** Show the provider's name under the account name; a provider group's header makes it redundant. */
  readonly showProvider: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const { connection, open } = props;
  const drawerId = useId();
  const now = useNow();
  const model = presentPanel(connection, now);
  const inactive = isInactive(connection);
  const headline = headlineOf(connection, model.cells);
  const plan = planLabel(connection.plan);
  // The figures count up the first time a row opens, so a closed row does not render them at all.
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return (
    <Fold closed={props.hidden} className="d-item">
      <article className={cx("d-card", open && "open", inactive && "dim")}>
        <button
          className="d-head"
          type="button"
          aria-expanded={open}
          aria-controls={drawerId}
          onClick={props.onToggle}
        >
          <span className="d-who">
            <BrandMark provider={connection.provider} />
            <span className="d-titles">
              <span className="d-name">
                {accountName(connection)}
                {plan === null ? null : (
                  <span className="plan">
                    <span className="sep" aria-hidden="true">
                      ·
                    </span>
                    {plan}
                  </span>
                )}
              </span>
              {props.showProvider || connection.identity !== null ? (
                <span className="d-sub">
                  {props.showProvider ? providerName(connection.provider) : null}
                  {props.showProvider && connection.identity !== null ? " · " : null}
                  {connection.identity === null ? null : (
                    <span className="who">{connection.identity}</span>
                  )}
                </span>
              ) : null}
            </span>
          </span>
          <RowLimit headline={headline} />
          <RowReset headline={headline} live={!inactive} updatedAt={connection.lastSuccessAt} />
          <span className="d-state">
            <RowStatus connection={connection} />
          </span>
          <span className="d-chev">
            <ChevronDownIcon />
          </span>
        </button>
        <Fold closed={!open} id={drawerId} className="d-drawer">
          {seen ? <RowDetail connection={connection} /> : null}
        </Fold>
      </article>
    </Fold>
  );
}
