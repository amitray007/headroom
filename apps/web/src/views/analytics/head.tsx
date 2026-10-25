import type { ReactNode } from "react";

/**
 * The page header and the face of a report tab, shared by the page and its skeleton so the two cannot drift.
 * This file has no chart code, so the skeleton can draw both before the charts load.
 */

/** The page header: the title and status line, then the tools every report shares. */
export function Head(props: { readonly status: ReactNode; readonly children?: ReactNode }) {
  return (
    <div className="an-head">
      <div className="an-titles">
        <h1 className="an-title">Analytics</h1>
        <p className="an-status">{props.status}</p>
      </div>
      {props.children}
    </div>
  );
}

/** What a report tab shows: the report's name and time span, then its answer in two lines. */
export function TabFace(props: {
  readonly label: string;
  readonly span: string;
  readonly big: ReactNode;
  readonly cap: ReactNode;
}) {
  return (
    <>
      <span className="an-tab-name">
        <span>{props.label}</span>
        <span className="an-tab-span">{props.span}</span>
      </span>
      <span className="an-tab-big">{props.big}</span>
      <span className="an-tab-cap">{props.cap}</span>
    </>
  );
}
