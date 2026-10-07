import type { ReactNode } from "react";

import { VerifiedSeal } from "../../ui/verified-seal.tsx";
import { LoadingNote, Sk } from "../../ui/skeleton.tsx";
// The skeleton is the Suspense fallback while this view's code loads, so its styles ship with the first screen.
import "./compare.css";

const windowColumns = ["first", "second"];
const accountRows = ["first", "second", "third"];

/** A matrix cell: figure, the real empty track and a line of words, in the real box. */
function MiniGhost(props: { readonly large?: boolean }) {
  return (
    <div className={props.large === true ? "cmp-mc lg" : "cmp-mc"}>
      <div className="top-line">
        <b>
          <Sk kind="text" width={36} />
        </b>
      </div>
      <div className="bar thin" aria-hidden="true" />
      <div className="cap">
        <Sk kind="text" width={props.large === true ? 110 : 88} />
      </div>
    </div>
  );
}

/** One window of a single-account card. */
function LineGhost() {
  return (
    <div className="line-row">
      <div className="top-line">
        <b>
          <Sk kind="text" width={32} />
        </b>
        <span className="window">
          <Sk kind="text" width={88} />
        </span>
      </div>
      <div className="bar thin" aria-hidden="true" />
      <div className="cap">
        <Sk kind="text" width={120} />
      </div>
    </div>
  );
}

/** A column heading in the real heading's box, without the sort button. */
function HeadGhost(props: { readonly children: ReactNode }) {
  return (
    <th scope="col">
      <span className="cmp-sort">{props.children}</span>
    </th>
  );
}

function AccountGhost() {
  return (
    <div className="cmp-acct">
      <div className="line">
        <span className="name">
          <Sk kind="text" width={96} />
        </span>
      </div>
      <span className="sub">
        <Sk kind="text" width={112} />
      </span>
    </div>
  );
}

/**
 * The Compare view before the overview loads, as a ghost of the real page. The words that do not depend on data
 * show for real; tabs, accounts, figures and window names are placeholders in the real boxes.
 */
export function CompareSkeleton() {
  return (
    <div className="cmp cmp-sk" aria-busy="true">
      <LoadingNote>Loading accounts</LoadingNote>
      <div className="cmp-tools" aria-hidden="true">
        <div className="ptokens">
          <Sk width={104} height={32} className="sk-pill" />
          <Sk width={96} height={32} className="sk-pill" />
        </div>
        <fieldset className="seg" inert>
          <button type="button" tabIndex={-1}>
            Left
          </button>
          <button type="button" tabIndex={-1}>
            Used
          </button>
        </fieldset>
      </div>
      <div aria-hidden="true">
        <section className="cmp-best">
          <VerifiedSeal tone="muted" />
          <span className="lead off">Recommended</span>
          <span className="acct">
            <Sk kind="text" width={150} />
          </span>
          <span className="why">
            <Sk kind="text" width={190} />
          </span>
          <span className="cmp-chips">
            <Sk width={96} height={28} className="sk-pill" />
          </span>
        </section>
        <div className="cmp-card">
          <div className="cmp-scroll">
            <table className="cmp-matrix">
              <thead>
                <tr>
                  <HeadGhost>
                    <b>Account</b>
                  </HeadGhost>
                  <HeadGhost>
                    <b>Room Left</b>
                  </HeadGhost>
                  {windowColumns.map((column) => (
                    <HeadGhost key={column}>
                      <b>
                        <Sk kind="text" width={56} />
                      </b>
                      <span className="window">
                        <Sk kind="text" width={52} />
                      </span>
                    </HeadGhost>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accountRows.map((row) => (
                  <tr key={row}>
                    <th scope="row">
                      <AccountGhost />
                    </th>
                    <td className="overall">
                      <MiniGhost large />
                    </td>
                    {windowColumns.map((column) => (
                      <td key={column}>
                        <MiniGhost />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="cmp-singles-head" aria-hidden="true">
        <h2>More Accounts</h2>
      </div>
      <div className="cmp-singles" aria-hidden="true">
        {[0, 1].map((card) => (
          <article className="cmp-single" key={card}>
            <header>
              <Sk width={24} height={24} className="sk-pill" />
              <span className="titles">
                <span className="pname">
                  <Sk kind="text" width={72} />
                </span>
                <span className="sub">
                  <Sk kind="text" width={110} />
                </span>
              </span>
              <Sk width={68} height={26} className="sk-pill" />
            </header>
            <div className="rows">
              <LineGhost />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
