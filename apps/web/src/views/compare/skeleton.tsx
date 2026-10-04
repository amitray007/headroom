import { LoadingNote, Sk } from "../../ui/skeleton.tsx";
// The skeleton is the Suspense fallback while this view's code loads, so its styles ship with the first screen.
import "./compare.css";

/** The Compare view before the overview loads: tabs, the recommended line, a matrix and single cards in final size. */
export function CompareSkeleton() {
  return (
    <div className="cmp" aria-busy="true">
      <LoadingNote>Loading accounts</LoadingNote>
      <div className="cmp-tools">
        <div className="cmp-sk-tabs">
          <Sk width={104} height={32} className="sk-pill" />
          <Sk width={96} height={32} className="sk-pill" />
        </div>
        <Sk width={112} height={32} className="sk-pill" />
      </div>
      <Sk kind="block" height={60} className="cmp-sk-best" />
      <div className="cmp-card cmp-sk-card">
        {[0, 1, 2].map((row) => (
          <div className="cmp-sk-row" key={row}>
            <Sk width={150} height={36} />
            <Sk width={130} height={36} />
            <Sk width={130} height={36} />
            <Sk width={130} height={36} />
          </div>
        ))}
      </div>
      <div className="cmp-singles-head">
        <Sk kind="title" width={140} />
      </div>
      <div className="cmp-singles">
        <Sk kind="block" height={150} />
        <Sk kind="block" height={150} />
      </div>
    </div>
  );
}
