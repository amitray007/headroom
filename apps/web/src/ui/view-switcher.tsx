import { useLayoutEffect, useRef, useState } from "react";

import { href, views, type ViewId } from "../router.ts";

interface Pill {
  readonly x: number;
  readonly width: number;
  /** False for the first placement, so the pill appears in place and only later moves slide. */
  readonly slide: boolean;
}

/**
 * The view switcher: one link per dashboard view, the active one marked with aria-current="page". A pill sits
 * behind the links and slides to the active one. Links are plain anchors, so Tab, Enter, middle-click and the
 * back button all work. Own row and horizontal scroll on a phone come from the CSS.
 */
export function ViewSwitcher(props: { readonly active: ViewId }) {
  const root = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<Pill | null>(null);

  useLayoutEffect(() => {
    const nav = root.current;
    if (nav === null) return;
    const place = (): void => {
      const link = nav.querySelector<HTMLElement>(`[data-view="${props.active}"]`);
      if (link === null) return;
      const next = { x: link.offsetLeft, width: link.offsetWidth };
      setPill((current) =>
        current?.x === next.x && current.width === next.width
          ? current
          : { ...next, slide: current !== null },
      );
    };
    place();
    // Fonts and the viewport change the link widths after the first paint.
    const watcher = new ResizeObserver(place);
    watcher.observe(nav);
    return () => watcher.disconnect();
  }, [props.active]);

  return (
    <nav ref={root} className="seg view-switch" aria-label="View">
      {pill === null ? null : (
        <span
          className="view-pill"
          data-slide={pill.slide}
          style={{ translate: `${pill.x}px 0`, width: pill.width }}
          aria-hidden="true"
        />
      )}
      {views.map((view) => (
        <a
          key={view.id}
          data-view={view.id}
          href={href({ page: view.id })}
          aria-current={view.id === props.active ? "page" : undefined}
        >
          {view.label}
        </a>
      ))}
    </nav>
  );
}
