import type { ReactNode } from "react";

import type { OverviewConnection } from "../../api.ts";
import { CellView, cellColumns } from "../../dashboard/cells.tsx";
import { awaitingFirstRefresh, providerName } from "@headroom/view-model/labels";
import { presentPanel } from "@headroom/view-model/present";
import { useNow } from "../../lib/now.ts";
import { href } from "../../router.ts";
import { BankedResets } from "../../ui/banked-resets.tsx";
import { ButtonLink } from "../../ui/button.tsx";

/** What the owner reads first on an account that is not being refreshed or has no figures yet. */
function noticeFor(connection: OverviewConnection, hasCells: boolean): ReactNode {
  if (connection.state === "reconnect_required") {
    return (
      <p className="d-note">
        The sign-in for this account has expired.{" "}
        <ButtonLink
          variant="primary"
          size="sm"
          href={href({ page: "reconnect", id: connection.id })}
        >
          Reconnect
        </ButtonLink>
      </p>
    );
  }
  if (connection.state === "paused") {
    return <p className="d-note">Paused. Headroom is not refreshing this account.</p>;
  }
  if (!hasCells && awaitingFirstRefresh(connection)) {
    return <p className="d-note">Connected just now. The first refresh is running.</p>;
  }
  if (connection.stale) {
    return (
      <p className="d-note">{`${providerName(connection.provider)} has not answered for a while. These numbers are from the last good refresh.`}</p>
    );
  }
  return null;
}

/** The expanded part of a row: the same figures the Overview panel shows, without its header and actions. */
export function RowDetail(props: { readonly connection: OverviewConnection }) {
  const { connection } = props;
  const now = useNow();
  const model = presentPanel(connection, now);
  const dim = connection.state === "paused" || connection.state === "reconnect_required";
  const notice = noticeFor(connection, model.cells.length > 0);
  return (
    <div className="d-body">
      {notice}
      {model.cells.length === 0 ? null : (
        <div className={dim ? "cells dim" : "cells"} data-cols={cellColumns(model.cells)}>
          {model.cells.map((cell, index) => (
            <CellView key={cell.key} cell={cell} index={index} />
          ))}
        </div>
      )}
      {model.banked === null && model.facts.length === 0 ? null : (
        <div className="facts">
          {model.banked === null ? null : (
            <span className="lead">
              <BankedResets {...model.banked} />
            </span>
          )}
          {model.facts.map((fact) => (
            <span className="kv" key={fact.key}>
              {fact.label} <b>{fact.value}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
