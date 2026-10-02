import type { Cell } from "../lib/present.ts";
import { formatNumber } from "../lib/present.ts";
import { useSettings } from "../lib/settings.tsx";
import { exactFull } from "../lib/time.ts";
import { displayMeter, toneOf } from "../lib/tone.ts";
import { useNow } from "../lib/now.ts";
import { When } from "../lib/when.tsx";
import { Bar } from "../ui/bar.tsx";
import { CountUp } from "../ui/count-up.tsx";
import { InfoTip } from "../ui/info-tip.tsx";

function Label(props: { readonly label: string; readonly window: string | null }) {
  return (
    <div className="label">
      <span>{props.label}</span>
      {props.window === null ? null : <span className="window">{props.window}</span>}
    </div>
  );
}

function Unknown() {
  return (
    <div className="value unknown" aria-hidden="true">
      —
    </div>
  );
}

function Unlimited() {
  return <div className="value">Unlimited</div>;
}

function MeterCell(props: {
  readonly cell: Extract<Cell, { kind: "meter" }>;
  readonly index: number;
}) {
  const { cell } = props;
  const { settings } = useSettings();
  const shown = displayMeter(
    cell.used,
    settings.limitsView,
    settings.lowThresholdPercent,
    cell.decimals,
  );
  const name = cell.window === null ? cell.label : `${cell.label} ${cell.window}`;
  if (cell.unlimited) {
    return (
      <div className="cell">
        <Label label={cell.label} window={cell.window} />
        <Unlimited />
        <div className="caption">No limit on this account</div>
      </div>
    );
  }
  if (shown.value === null || shown.fill === null) {
    return (
      <div className="cell">
        <Label label={cell.label} window={cell.window} />
        <Unknown />
        <Bar unknown label={`${name} not reported`} />
        <div className="caption">Not reported in the last refresh</div>
      </div>
    );
  }
  const toneWord = shown.caption === null ? null : shown.caption;
  return (
    <div className="cell">
      <Label label={cell.label} window={cell.window} />
      <div className="value">
        <CountUp value={shown.value} decimals={cell.decimals} delay={props.index * 60} />
        <span className="unit">{shown.unit}</span>
      </div>
      <Bar
        percent={shown.fill}
        tone={shown.tone ?? "good"}
        {...(cell.used === null ? {} : { valueNow: cell.used })}
        label={`${name} ${cell.used ?? 0}% used`}
      />
      <div className="caption">
        {toneWord === null ? null : (
          <>
            <span className={`tone ${toneWord === "Running Low" ? "warn" : "bad"}`}>
              {toneWord}
            </span>
            {" · "}
          </>
        )}
        {cell.resetWords === "with_cycle" ? (
          "Resets with the cycle"
        ) : cell.resetWords === "not_started" ? (
          "Not Started"
        ) : cell.resetsAt === null ? (
          "No reset time"
        ) : (
          <When
            at={cell.resetsAt}
            kind="until"
            prefix={cell.resetWords === "cycle_end" ? "Cycle ends" : "Resets"}
          />
        )}
      </div>
    </div>
  );
}

const unitWords = { credits: "credits", usd: "", count: "", requests: "requests" } as const;

function AmountCell(props: { readonly cell: Extract<Cell, { kind: "amount" }> }) {
  const { cell } = props;
  const { settings } = useSettings();
  if (cell.unlimited) {
    return (
      <div className="cell fact">
        <Label label={cell.label} window={cell.window} />
        <Unlimited />
        {cell.note === null ? null : <div className="caption">{cell.note}</div>}
      </div>
    );
  }
  if (cell.value === null) {
    return (
      <div className="cell fact">
        <Label label={cell.label} window={cell.window} />
        <Unknown />
        <div className="caption">Not reported in the last refresh</div>
      </div>
    );
  }
  const total = cell.of === null ? Number.NaN : Number(cell.of.replaceAll(",", ""));
  const hasBar = Number.isFinite(total) && total > 0;
  const usedPercent = hasBar ? Math.min(100, Math.max(0, ((total - cell.value) / total) * 100)) : 0;
  const unitWord = unitWords[cell.unit];
  const tone = hasBar ? (toneOf(usedPercent, settings.lowThresholdPercent) ?? "good") : "good";
  return (
    <div className={hasBar ? "cell" : "cell fact"}>
      <Label label={cell.label} window={cell.window} />
      <div className="value">
        <CountUp
          value={cell.value}
          decimals={cell.decimals}
          {...(cell.unit === "usd" ? { prefix: "$" } : {})}
        />
        {unitWord === "" ? null : <span className="unit">{unitWord}</span>}
      </div>
      {hasBar ? (
        <Bar
          thin
          percent={100 - usedPercent}
          tone={tone}
          label={`${cell.label} ${formatNumber(cell.value, cell.decimals)} left of ${cell.of}`}
        />
      ) : null}
      {cell.note === null ? null : <div className="caption">{cell.note}</div>}
    </div>
  );
}

function ResetsCell(props: { readonly cell: Extract<Cell, { kind: "resets" }> }) {
  const { cell } = props;
  const { settings } = useSettings();
  const now = useNow();
  const first = cell.expiries[0];
  if (cell.count === null) {
    return (
      <div className="cell fact">
        <Label label={cell.label} window={cell.window} />
        <Unknown />
        <div className="caption">Not reported in the last refresh</div>
      </div>
    );
  }
  return (
    <div className="cell fact">
      <Label label={cell.label} window={cell.window} />
      <div className="value">
        <CountUp value={cell.count} />
        <span className="of">{cell.count === 1 ? "full reset" : "full resets"}</span>
      </div>
      <div className="caption">
        {first === undefined ? (
          "No expiry reported"
        ) : (
          <>
            <When at={first} kind="until" prefix="First expires" />
            <InfoTip label="All reset expiry times">
              <b>Banked Resets</b>
              {cell.expiries.map((at, index) => (
                <span key={at}>
                  {`Reset ${index + 1} · expires ${exactFull(at, now, settings.clock)}`}
                </span>
              ))}
            </InfoTip>
          </>
        )}
      </div>
    </div>
  );
}

/** One figure of an account panel. Unknown values show a dash, never zero. */
export function CellView(props: { readonly cell: Cell; readonly index: number }) {
  const { cell } = props;
  switch (cell.kind) {
    case "meter":
      return <MeterCell cell={cell} index={props.index} />;
    case "amount":
      return <AmountCell cell={cell} />;
    case "resets":
      return <ResetsCell cell={cell} />;
  }
}
