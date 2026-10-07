import { shortMonth } from "./range.ts";

/** "Sep 30". On a narrow chart the month shows only on the 1st; the range title above names the months. */
export function DayLabel(props: { readonly t: number }) {
  const day = new Date(props.t).getDate();
  const keep = day === 1;
  return (
    <>
      <span className={keep ? "tl-mon keep" : "tl-mon"}>{shortMonth(props.t)} </span>
      {day}
    </>
  );
}
