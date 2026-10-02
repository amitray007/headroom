import { useEffect, useId, useRef, useState } from "react";

import type { OverviewConnection } from "../api.ts";
import { BrandMark } from "../icons.tsx";
import { providerName } from "@headroom/view-model/labels";
import { cx } from "../ui/cx.ts";
import { AccountPanel } from "./account-panel.tsx";

/** Time for a leaving panel to collapse before the overview reloads without it. */
const collapseMs = 520;

/** One provider: its mark and name, then one panel per account. */
export function ProviderSection(props: {
  readonly provider: OverviewConnection["provider"];
  readonly connections: readonly OverviewConnection[];
  readonly onChanged: () => Promise<void>;
}) {
  const { provider, connections, onChanged } = props;
  const headingId = useId();
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);
  const gone = (id: string): void => {
    setLeaving((current) => new Set(current).add(id));
    timers.current.push(setTimeout(() => void onChanged(), collapseMs));
  };
  const left = connections.filter((connection) => !leaving.has(connection.id)).length;
  return (
    <div className={cx("collapse", left === 0 && "closed")}>
      <section className="provider" data-accent={provider} aria-labelledby={headingId}>
        <header>
          <BrandMark provider={provider} />
          <h2 id={headingId}>{providerName(provider)}</h2>
          {left > 1 ? <span className="chip count">{left} Accounts</span> : null}
        </header>
        <div className="stack">
          {connections.map((connection) => (
            <AccountPanel
              key={connection.id}
              connection={connection}
              closed={leaving.has(connection.id)}
              onChanged={onChanged}
              onDisconnected={gone}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
