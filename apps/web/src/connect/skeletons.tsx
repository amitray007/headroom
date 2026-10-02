import { LoadingNote, Sk } from "../ui/skeleton.tsx";

/** Provider cards while the provider list loads. Seven is the full set; fewer may be enabled. */
export function CardsSkeleton() {
  return (
    <div className="cards" aria-busy="true">
      <LoadingNote>Loading providers</LoadingNote>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="card sk-card" aria-hidden="true">
          <span className="head">
            <Sk width={24} height={24} className="sk-pill" />
            <Sk width={index % 2 === 0 ? 72 : 96} />
          </span>
        </div>
      ))}
    </div>
  );
}

const columnHeadings = ["Account", "Limits", "Status", "Last Refreshed"] as const;

function SkeletonRow(props: { readonly wide: boolean }) {
  return (
    <tr className="sk-row">
      <td className="tname">
        <div className="stack-sk">
          <Sk width={props.wide ? 130 : 100} />
          <Sk width={160} />
        </div>
      </td>
      <td>
        <div className="stack-sk">
          <Sk width={90} />
          <Sk kind="bar" height={6} />
        </div>
      </td>
      <td>
        <Sk width={84} height={24} className="sk-pill" />
      </td>
      <td>
        <Sk width={72} />
      </td>
      <td className="tacts">
        <Sk width={32} height={28} className="sk-pill" />
      </td>
    </tr>
  );
}

/** The accounts table while the overview loads: real column headings, placeholder rows. */
export function TableSkeleton() {
  return (
    <div className="tscroll" aria-busy="true">
      <LoadingNote>Loading accounts</LoadingNote>
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
              <span className="sk-slot">
                <Sk width={20} height={20} className="sk-pill" />
                <Sk width={72} />
              </span>
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
    <div className="connect-page">
      <div className="intro">
        <h1>Connect an Account</h1>
        <p>Choose a provider. You only sign in once.</p>
      </div>
      <CardsSkeleton />
      <section className="panel tablecard">
        <div className="thead-row">
          <h2>Connected Accounts</h2>
        </div>
        <TableSkeleton />
      </section>
    </div>
  );
}
