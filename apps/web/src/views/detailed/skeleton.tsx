import { ChevronDownIcon, ReorderIcon } from "../../icons.tsx";
import { buttonClass } from "../../ui/button.tsx";
import { LoadingNote, Sk } from "../../ui/skeleton.tsx";
// The skeleton is the Suspense fallback while this view's code loads, so its styles ship with the first screen.
import "./detailed.css";

/** One account row in its final layout: the real card and columns, with placeholders for the data. */
function SkeletonRow() {
  return (
    <article className="d-card" aria-hidden="true">
      <div className="d-head">
        <span className="d-who">
          <Sk kind="block" width={20} height={20} className="sk-pill" />
          <span className="d-titles">
            <span className="d-name">
              <Sk kind="text" width={140} />
            </span>
            <span className="d-sub">
              <Sk kind="text" width={170} />
            </span>
          </span>
        </span>
        <span className="d-limit">
          <span className="d-limit-top">
            <b>
              <Sk kind="text" width={36} />
            </b>
            <span className="window">
              <Sk kind="text" width={110} />
            </span>
          </span>
          <div className="bar thin" aria-hidden="true" />
        </span>
        <span className="d-reset">
          <Sk kind="text" width={96} />
        </span>
        <span className="d-state">
          <span className="status">
            <Sk kind="block" width={7} height={7} />
            <span className="age">
              <Sk kind="text" width={56} />
            </span>
          </span>
        </span>
        <span className="d-chev">
          <ChevronDownIcon />
        </span>
      </div>
    </article>
  );
}

const orders = ["By Urgency", "By Provider", "Custom"] as const;
const limitViews = ["Left", "Used"] as const;
const chipNames = [64, 52, 76, 58, 70] as const;

/** An inert segmented control. The chosen segment comes from saved settings, so none shows as chosen. */
function SkeletonSegmented(props: { readonly labels: readonly string[] }) {
  return (
    <fieldset className="seg" inert>
      {props.labels.map((label) => (
        <button key={label} type="button" tabIndex={-1}>
          {label}
        </button>
      ))}
    </fieldset>
  );
}

/** The Detailed view before the first load: toolbar and rows in their final layout. */
export function DetailedSkeleton() {
  return (
    <div aria-busy="true">
      <LoadingNote>Loading accounts</LoadingNote>
      <div className="d-tools" aria-hidden="true">
        <div className="ptokens">
          <span className="ptoken">
            <Sk kind="text" width={32} />
          </span>
          {chipNames.map((width) => (
            <span key={width} className="ptoken">
              <Sk kind="block" width={16} height={16} className="sk-pill" />
              <Sk kind="text" width={width} />
            </span>
          ))}
        </div>
        <div className="d-segs">
          <SkeletonSegmented labels={orders} />
          <SkeletonSegmented labels={limitViews} />
          <button
            className={buttonClass("quiet", "sm", "d-arrange")}
            type="button"
            tabIndex={-1}
            inert
          >
            <ReorderIcon />
            Arrange
          </button>
        </div>
      </div>
      <div className="d-list">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="d-item">
            <SkeletonRow />
          </div>
        ))}
      </div>
    </div>
  );
}
