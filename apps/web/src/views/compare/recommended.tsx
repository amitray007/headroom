import { formatNumber } from "@headroom/view-model/present";
import { InfoTip } from "../../ui/info-tip.tsx";
import { VerifiedSeal } from "../../ui/verified-seal.tsx";
import { driversOf, type Pick, type Row } from "./compare-model.ts";
import { figureOfRoom, figureOfWindow, type Look } from "./figure.ts";
import { LimitTag } from "./parts.tsx";

function Chip(props: {
  readonly name: string;
  readonly body: string;
  readonly limiting: boolean;
  readonly showTag: boolean;
}) {
  return (
    <span className={props.limiting ? "cmp-chip limit" : "cmp-chip"}>
      {props.name} <b>{props.body}</b>
      {props.limiting && props.showTag ? <LimitTag /> : null}
    </span>
  );
}

/** The chips for the windows that set the account's room, or its credit balance. */
function Chips(props: { readonly row: Row; readonly look: Look }) {
  const { row, look } = props;
  const provider = row.connection.provider;
  if (row.balance !== null) {
    const { value, total, decimals } = row.balance;
    const body =
      total === null
        ? `${formatNumber(value, decimals)} credits`
        : `${formatNumber(value, decimals)} of ${formatNumber(total, decimals)}`;
    return (
      <span className="cmp-chips">
        <Chip name="Credit Balance" body={body} limiting={false} showTag={false} />
      </span>
    );
  }
  const drivers = driversOf(row.room);
  return (
    <span className="cmp-chips">
      {drivers.map((driver) => {
        const figure = figureOfWindow(driver.ref, provider, look);
        const body =
          figure.kind === "known"
            ? figure.text
            : figure.kind === "not_started"
              ? "Not Started"
              : "Unlimited";
        return (
          <Chip
            key={driver.ref.key}
            name={driver.name}
            body={body}
            limiting={driver.limiting}
            showTag={drivers.length > 1}
          />
        );
      })}
    </span>
  );
}

/** How much room the runner-up has, in words for the tooltip. */
function nextWords(next: Row, look: Look): string {
  const left = next.room.left;
  if (left === null) return "";
  if (next.room.unit === "credits") return `${formatNumber(left, 2)} credits left`;
  const figure = figureOfRoom(left, next.connection.provider, look);
  if (figure.kind !== "known") return "";
  return look.view === "left" ? figure.text : `${figure.text} used`;
}

function whyNone(pick: Pick, total: number, provider: string): string {
  if (pick.inactive === total) {
    return `No account is ready. Every ${provider} account is paused or needs a new sign-in.`;
  }
  return "No account reports how much room it has left yet.";
}

/**
 * One slim line that names the account to use now and why: the active account with the most room. Inactive
 * accounts are never named. With no candidate it says so, calmly.
 */
export function Recommended(props: {
  readonly pick: Pick;
  readonly providerName: string;
  readonly total: number;
  readonly look: Look;
}) {
  const { pick, look } = props;
  const { best, next } = pick;
  if (best === null) {
    return (
      <section className="cmp-best" aria-label="Recommended">
        <VerifiedSeal tone="muted" />
        <span className="lead off">Recommended</span>
        <span className="why">{whyNone(pick, props.total, props.providerName)}</span>
      </section>
    );
  }
  const nextLine = next === null ? "" : nextWords(next, look);
  return (
    <section className="cmp-best" aria-label="Recommended">
      <VerifiedSeal />
      <span className="lead">Recommended</span>
      <span className="acct">
        <b>{best.name}</b>
        {best.plan === null ? null : (
          <span className="plan">
            <span className="sep" aria-hidden="true">
              ·
            </span>
            {best.plan}
          </span>
        )}
      </span>
      <span className="why">
        {pick.counted > 1
          ? `Most headroom of ${pick.counted} active accounts`
          : "Only active account"}
      </span>
      <span className="cmp-best-tip">
        <InfoTip label="More about this pick">
          <b>Why this account</b>
          {next !== null && nextLine !== "" ? (
            <span>{`Next best: ${next.name}, ${nextLine}.`}</span>
          ) : null}
          <span>
            Percentages ignore plan size, so a bigger plan with the same share left has more to
            give.
          </span>
        </InfoTip>
      </span>
      <Chips row={best} look={look} />
    </section>
  );
}
