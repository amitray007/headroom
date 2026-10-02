import type { OverviewConnection } from "../../api.ts";
import { roomOf } from "@headroom/view-model/accounts";
import { formatNumber, type Cell } from "@headroom/view-model/present";
import { useSettings } from "../../lib/settings.tsx";
import { displayMeter } from "@headroom/view-model/tone";
import { ResetCaption } from "../../lib/reset-caption.tsx";
import { When } from "../../lib/when.tsx";
import { Bar } from "../../ui/bar.tsx";

type MeterCell = Extract<Cell, { kind: "meter" }>;
type AmountCell = Extract<Cell, { kind: "amount" }>;

/** What the row shows for the account's tightest limit: a meter, a balance, or nothing known. */
export type Headline =
  | { readonly kind: "meter"; readonly cell: MeterCell }
  | { readonly kind: "balance"; readonly cell: AmountCell }
  | { readonly kind: "unlimited"; readonly cell: MeterCell }
  | { readonly kind: "unknown" };

export function headlineOf(connection: OverviewConnection, cells: readonly Cell[]): Headline {
  const key = roomOf(connection).limiting?.key;
  const meters = cells.filter((cell): cell is MeterCell => cell.kind === "meter");
  const tight = key === undefined ? undefined : meters.find((cell) => cell.key === key);
  if (tight !== undefined) return { kind: "meter", cell: tight };
  const balance = cells.find(
    (cell): cell is AmountCell =>
      cell.kind === "amount" && cell.key === "credits.balance" && cell.value !== null,
  );
  if (balance !== undefined) return { kind: "balance", cell: balance };
  const unlimited = meters.find((cell) => cell.unlimited);
  return unlimited === undefined ? { kind: "unknown" } : { kind: "unlimited", cell: unlimited };
}

function windowName(cell: MeterCell | AmountCell): string {
  return cell.window === null ? cell.label : `${cell.label} · ${cell.window}`;
}

/** The limit column of a row: figure, window, bar, and the reset line. Unknown stays unknown, never zero. */
export function RowLimit(props: { readonly headline: Headline }) {
  const { headline } = props;
  const { settings } = useSettings();
  if (headline.kind === "meter") {
    const { cell } = headline;
    const shown = displayMeter(
      cell.used,
      settings.limitsView,
      settings.lowThresholdPercent,
      cell.decimals,
    );
    const name = windowName(cell);
    const known = shown.value !== null && shown.fill !== null;
    return (
      <span className="d-limit">
        <span className="d-limit-top">
          <b className={known ? undefined : "muted"}>
            {known ? `${shown.value}${shown.unit}` : "—"}
          </b>
          <span className="window">{known ? name : `${name} · Not reported`}</span>
          {shown.caption === null ? null : (
            <span className={`tone ${shown.caption === "Running Low" ? "warn" : "bad"}`}>
              {shown.caption}
            </span>
          )}
        </span>
        {known ? (
          <Bar
            thin
            percent={shown.fill}
            tone={shown.tone ?? "good"}
            {...(cell.used === null ? {} : { valueNow: cell.used })}
            label={`${name} ${cell.used ?? 0}% used`}
          />
        ) : (
          <Bar thin unknown label={`${name} · Not reported`} />
        )}
      </span>
    );
  }
  if (headline.kind === "balance") {
    const { cell } = headline;
    const value = cell.value ?? 0;
    const total = cell.of === null ? Number.NaN : Number(cell.of.replaceAll(",", ""));
    const hasBar = Number.isFinite(total) && total > 0;
    const prefix = cell.unit === "usd" ? "$" : "";
    const left = hasBar ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
    return (
      <span className="d-limit">
        <span className="d-limit-top">
          <b>
            {`${prefix}${formatNumber(value, cell.decimals)}`}
            {cell.of === null ? "" : ` of ${prefix}${cell.of}`}
          </b>
          <span className="window">{cell.label}</span>
        </span>
        {hasBar ? (
          <Bar
            thin
            percent={left}
            tone={left < 10 ? "bad" : left < settings.lowThresholdPercent ? "warn" : "good"}
            label={`${cell.label} ${formatNumber(value, cell.decimals)} left`}
          />
        ) : (
          <Bar thin unknown label={`${cell.label} total not reported`} />
        )}
      </span>
    );
  }
  const name = headline.kind === "unlimited" ? windowName(headline.cell) : "Not reported";
  return (
    <span className="d-limit">
      <span className="d-limit-top">
        <b className={headline.kind === "unlimited" ? undefined : "muted"}>
          {headline.kind === "unlimited" ? "Unlimited" : "—"}
        </b>
        <span className="window">{name}</span>
      </span>
      <Bar thin unknown label={name} />
    </span>
  );
}

/** The reset line of a row. An account that is not being read shows when it last updated instead. */
export function RowReset(props: {
  readonly headline: Headline;
  readonly live: boolean;
  readonly updatedAt: number | null;
}) {
  const { headline } = props;
  if (!props.live) {
    return (
      <span className="d-reset">
        {props.updatedAt === null ? (
          "Never refreshed"
        ) : (
          <>
            Updated <When at={props.updatedAt} kind="ago" />
          </>
        )}
      </span>
    );
  }
  return (
    <span className="d-reset">
      {headline.kind === "meter" ? (
        <ResetCaption resetWords={headline.cell.resetWords} resetsAt={headline.cell.resetsAt} />
      ) : null}
    </span>
  );
}
