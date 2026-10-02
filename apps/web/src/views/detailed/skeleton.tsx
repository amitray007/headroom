import { LoadingNote, Sk } from "../../ui/skeleton.tsx";

function SkeletonRow() {
  return (
    <article className="d-card" aria-hidden="true">
      <div className="d-head">
        <span className="d-who">
          <Sk width={20} height={20} className="sk-pill" />
          <span className="d-titles">
            <Sk kind="title" width={140} />
            <Sk width={170} />
          </span>
        </span>
        <span className="d-limit">
          <Sk width="55%" />
          <Sk kind="bar" />
        </span>
        <span className="d-reset">
          <Sk width={90} />
        </span>
        <span className="d-state">
          <Sk width={86} height={24} className="sk-pill" />
        </span>
        <span className="d-chev" />
      </div>
    </article>
  );
}

/** The Detailed view before the first load: toolbar and rows in their final layout. */
export function DetailedSkeleton() {
  return (
    <div aria-busy="true">
      <LoadingNote>Loading accounts</LoadingNote>
      <div className="d-tools" aria-hidden="true">
        <div className="ptokens">
          <Sk width={64} height={32} className="sk-pill" />
          <Sk width={110} height={32} className="sk-pill" />
          <Sk width={104} height={32} className="sk-pill" />
          <Sk width={96} height={32} className="sk-pill" />
        </div>
        <div className="d-segs">
          <Sk width={236} height={30} className="sk-pill" />
          <Sk width={104} height={30} className="sk-pill" />
          <Sk width={88} height={32} className="sk-pill" />
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
