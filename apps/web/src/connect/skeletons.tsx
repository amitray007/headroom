import { DotsIcon } from "../icons.tsx";
import { LoadingNote, Sk } from "../ui/skeleton.tsx";
// The skeleton is the Suspense fallback while the connect page loads, so its styles ship with the first screen.
import "./connect.css";

const nameWidths = [72, 96, 64, 84];

/** Provider cards while the provider list loads. Seven is the full set; fewer may be enabled. */
export function CardsSkeleton(props: { readonly announce?: boolean }) {
  const { announce = true } = props;
  return (
    <div className="cards" aria-busy={announce ? "true" : undefined}>
      {announce ? <LoadingNote>Loading providers</LoadingNote> : null}
      {nameWidths.map((width) => (
        <div key={width} className="card sk-card" aria-hidden="true">
          <span className="head">
            <Sk width={24} height={24} className="sk-pill" />
            <span>
              <Sk kind="text" width={width} />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

const columnHeadings = ["Account", "Limits", "Status", "Last Refreshed"] as const;

function SkeletonRow(props: { readonly wide: boolean }) {
  return (
    <tr>
      <td className="tname">
        <span className="name">
          <Sk kind="text" width={props.wide ? 120 : 92} />
        </span>
        <span className="twho">
          <Sk kind="text" width={160} />
        </span>
      </td>
      <td className="troom">
        <span className="rtop">
          <span className="rnum">
            <Sk kind="text" width={56} />
          </span>
          <span className="rwin">
            <Sk kind="text" width={44} />
          </span>
        </span>
        <Sk kind="bar" height={5} />
        <span className="rsub">
          <Sk kind="text" width={96} />
        </span>
      </td>
      <td className="tstatus">
        <span className="status-slot">
          <Sk width={88} height={26} className="sk-pill" />
        </span>
      </td>
      <td className="tlast">
        <Sk kind="text" width={64} />
      </td>
      <td className="tacts" aria-hidden="true">
        <span className="acts">
          <span className="btn quiet sm kebab">
            <DotsIcon />
          </span>
        </span>
      </td>
    </tr>
  );
}

/** The accounts table while the overview loads: real column headings, placeholder rows. */
export function TableSkeleton(props: { readonly announce?: boolean }) {
  const { announce = true } = props;
  return (
    <div className="tscroll" aria-busy={announce ? "true" : undefined}>
      {announce ? <LoadingNote>Loading accounts</LoadingNote> : null}
      <table className="accounts" aria-hidden="true">
        <thead>
          <tr>
            {columnHeadings.map((heading) => (
              <th key={heading} scope="col">
                {heading}
              </th>
            ))}
            <th scope="col">
              <span className="sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="tgroup">
          <tr className="tgroup-row">
            <th scope="rowgroup" colSpan={5}>
              <span className="brand">
                <Sk width={20} height={20} className="sk-pill" />
              </span>
              <Sk kind="text" width={72} />
            </th>
          </tr>
          <SkeletonRow wide />
          <SkeletonRow wide={false} />
        </tbody>
      </table>
    </div>
  );
}

/** The connect page before anything has loaded: its own heading and note, then cards and table placeholders. */
export function ConnectSkeleton() {
  return (
    <div className="connect-page" aria-busy="true">
      <LoadingNote>Loading</LoadingNote>
      <div className="intro">
        <h1>Connect an Account</h1>
        <p>Choose a provider. You only sign in once.</p>
      </div>
      <CardsSkeleton announce={false} />
      <section className="panel tablecard">
        <div className="thead-row">
          <h2>Connected Accounts</h2>
        </div>
        <TableSkeleton announce={false} />
      </section>
    </div>
  );
}
