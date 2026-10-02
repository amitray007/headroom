import { ResetIcon } from "../icons.tsx";
import { useNow } from "../lib/now.ts";
import { useSettings } from "../lib/settings.tsx";
import { exactFull } from "@headroom/view-model/time";
import { When } from "../lib/when.tsx";
import { InfoTip } from "./info-tip.tsx";

/**
 * A one-line, read-only summary of banked resets: "3 Reset Grants · Expires in 4 d". It is information, not a
 * control, and sits at the left of a panel's facts row.
 */
export function BankedResets(props: {
  readonly count: number;
  /** Singular noun, for example "Reset Grant". An "s" is added unless the count is 1. */
  readonly label: string;
  /** Expiry instants, soonest first. */
  readonly expiries: readonly number[];
}) {
  const { count, label, expiries } = props;
  const { settings } = useSettings();
  const now = useNow();
  const first = expiries[0];
  const noun = count === 1 ? label : `${label}s`;
  return (
    <span className="banked">
      <span className="banked-chip" aria-hidden="true">
        <ResetIcon />
      </span>
      <span className="banked-text">
        {count === 0 ? (
          <span className="banked-zero">{`No ${noun}`}</span>
        ) : (
          <>
            <b className="banked-count">{`${count} ${noun}`}</b>
            {first === undefined ? null : (
              <>
                <span className="banked-dot" aria-hidden="true">
                  ·
                </span>
                <span className="banked-when">
                  <When at={first} kind="until" prefix="Expires" />
                </span>
              </>
            )}
          </>
        )}
      </span>
      {expiries.length > 1 ? (
        <InfoTip label={`All ${label} expiry times`}>
          <b>{`Banked ${label}s`}</b>
          {expiries.map((at, index) => (
            <span
              key={at}
            >{`${label} ${index + 1} · expires ${exactFull(at, now, settings.clock)}`}</span>
          ))}
        </InfoTip>
      ) : null}
    </span>
  );
}
