import { LoadingNote, Sk } from "../../ui/skeleton.tsx";
// The skeleton is the Suspense fallback while this view's code loads, so its styles ship with the first screen.
import "./timeline.css";

/** The Timeline before the overview loads: the range tools and four lanes in final size. */
export function TimelineSkeleton() {
  return (
    <div className="tl-view" aria-busy="true">
      <LoadingNote>Loading timeline</LoadingNote>
      <div className="tl-tools">
        <Sk width={190} height={20} />
        <Sk width={300} height={32} className="sk-pill" />
      </div>
      <div className="tl-chart tl-skeleton">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="tl-skeleton-row">
            <Sk width="55%" />
            <Sk kind="bar" width={`${40 + row * 12}%`} />
          </div>
        ))}
      </div>
    </div>
  );
}
