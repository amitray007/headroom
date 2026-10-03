import { LoadingNote, Sk } from "../../ui/skeleton.tsx";

function SkeletonRow() {
  return (
    <li className="w-row" aria-hidden="true">
      <div className="w-who">
        <Sk kind="title" width={140} />
        <Sk width={170} />
      </div>
      <div className="w-col w-c-cost">
        <Sk width={90} height={20} />
      </div>
      <div className="w-col w-c-renew">
        <Sk width={100} />
      </div>
      <div className="w-col w-c-spend" />
      <div className="w-act">
        <Sk width={30} height={30} className="sk-pill" />
      </div>
    </li>
  );
}

/** The Wallet before the first load: toolbar, summary band and one provider in their final layout. */
export function WalletSkeleton() {
  return (
    <div aria-busy="true" className="w-page">
      <LoadingNote>Loading wallet</LoadingNote>
      <div className="w-tools">
        <h1 className="w-title">Wallet</h1>
        <div className="w-segs" aria-hidden="true">
          <Sk width={92} height={30} className="sk-pill" />
          <Sk width={120} height={30} className="sk-pill" />
          <Sk width={104} height={36} className="sk-pill" />
        </div>
      </div>
      <div className="w-band" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="w-stat">
            <Sk width="50%" />
            <Sk kind="big" />
            <Sk width="70%" />
          </div>
        ))}
      </div>
      <section className="provider" aria-hidden="true">
        <header className="sk-head">
          <Sk width={20} height={20} className="sk-pill" />
          <Sk kind="title" width={110} />
        </header>
        <div className="w-card">
          <div className="w-colhead">
            <Sk width={60} />
            <Sk width={80} />
            <Sk width={50} />
            <Sk width={80} />
            <span />
          </div>
          <ul className="w-rows">
            {Array.from({ length: 3 }, (_, index) => (
              <SkeletonRow key={index} />
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
