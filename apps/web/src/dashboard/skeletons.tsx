import { buttonClass } from "../ui/button.tsx";
import { LoadingNote, Sk } from "../ui/skeleton.tsx";

/** One figure in its final layout: the real cell, with a placeholder for each word and number and the empty bar track. */
function SkeletonCell(props: { readonly labelWidth: string; readonly captionWidth: string }) {
  return (
    <div className="cell" aria-hidden="true">
      <div className="label">
        <span>
          <Sk kind="text" width={props.labelWidth} />
        </span>
      </div>
      <div className="value">
        <Sk kind="text" width="42%" />
      </div>
      <div className="bar" aria-hidden="true" />
      <div className="caption">
        <Sk kind="text" width={props.captionWidth} />
      </div>
    </div>
  );
}

const labelWidths = ["96px", "80px", "110px"] as const;
const captionWidths = ["60%", "52%", "66%"] as const;

/** The figures of a panel before they are known. Also the placeholder for an account without a refresh yet. */
export function SkeletonCells(props: { readonly count: number }) {
  return (
    <div className="cells" aria-hidden="true">
      {Array.from({ length: props.count }, (_, index) => (
        <SkeletonCell
          key={index}
          labelWidth={labelWidths[index % labelWidths.length] ?? "96px"}
          captionWidth={captionWidths[index % captionWidths.length] ?? "60%"}
        />
      ))}
    </div>
  );
}

function SkeletonPanel(props: { readonly cells: number }) {
  return (
    <section className="panel" aria-hidden="true">
      <header>
        <div className="titles">
          <h3>
            <span className="name">
              <Sk kind="text" width={112} />
            </span>
            <span className="rename" />
          </h3>
          <div className="ident">
            <span className="who">
              <Sk kind="text" width={150} />
            </span>
          </div>
        </div>
        <div className="right">
          <span className="status-slot">
            <span className="status">
              <Sk kind="block" width={7} height={7} />
              <span className="age">
                <Sk kind="text" width={64} />
              </span>
            </span>
          </span>
        </div>
      </header>
      <SkeletonCells count={props.cells} />
      <div className="facts">
        <span className="kv">
          <Sk kind="text" width={110} />
        </span>
        <span className="kv">
          <Sk kind="text" width={130} />
        </span>
        <span className="acts">
          {[44, 56, 76].map((width) => (
            <span key={width} className={buttonClass("quiet", "sm")}>
              <Sk kind="text" width={width} />
            </span>
          ))}
        </span>
      </div>
    </section>
  );
}

function SkeletonProvider(props: { readonly cells: number }) {
  return (
    <section className="provider" aria-hidden="true">
      <header>
        <Sk kind="block" width={20} height={20} className="sk-pill" />
        <h2>
          <Sk kind="text" width={96} />
        </h2>
        <span className="chip count">
          <Sk kind="text" width={52} />
        </span>
      </header>
      <div className="stack">
        <SkeletonPanel cells={props.cells} />
      </div>
    </section>
  );
}

/** The dashboard before the first load: provider headers and panels in their final layout. */
export function DashboardSkeleton() {
  return (
    <div aria-busy="true">
      <LoadingNote>Loading accounts</LoadingNote>
      <SkeletonProvider cells={3} />
      <SkeletonProvider cells={2} />
    </div>
  );
}
