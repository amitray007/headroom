import { LoadingNote, Sk } from "../ui/skeleton.tsx";

/** One figure in its final layout: label, value, bar and caption, with the real cell's spacing. */
function SkeletonCell(props: { readonly labelWidth: string; readonly captionWidth: string }) {
  return (
    <div className="cell" aria-hidden="true">
      <div className="label sk-slot">
        <Sk width={props.labelWidth} />
      </div>
      <div className="value sk-slot">
        <Sk kind="big" />
      </div>
      <Sk kind="bar" />
      <div className="caption sk-slot">
        <Sk width={props.captionWidth} />
      </div>
    </div>
  );
}

const labelWidths = ["40%", "34%", "46%"] as const;
const captionWidths = ["60%", "52%", "66%"] as const;

/** The figures of a panel before they are known. Also the placeholder for an account without a refresh yet. */
export function SkeletonCells(props: { readonly count: number }) {
  return (
    <div className="cells" aria-hidden="true">
      {Array.from({ length: props.count }, (_, index) => (
        <SkeletonCell
          key={index}
          labelWidth={labelWidths[index % labelWidths.length] ?? "40%"}
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
          <div className="sk-slot sk-name">
            <Sk kind="title" width={150} />
          </div>
          <div className="sk-slot sk-ident">
            <Sk width={190} />
          </div>
        </div>
        <div className="right">
          <div className="sk-slot sk-status">
            <Sk width={96} height={24} className="sk-pill" />
          </div>
        </div>
      </header>
      <SkeletonCells count={props.cells} />
      <div className="facts sk-facts">
        <Sk width={110} />
        <Sk width={90} />
        <Sk width={130} />
        <span className="sk-acts">
          <Sk width={104} height={28} className="sk-pill" />
        </span>
      </div>
    </section>
  );
}

function SkeletonProvider(props: { readonly cells: number }) {
  return (
    <section className="provider" aria-hidden="true">
      <header className="sk-head">
        <Sk width={20} height={20} className="sk-pill" />
        <Sk kind="title" width={96} />
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
