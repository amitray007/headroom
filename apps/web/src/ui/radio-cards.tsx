/* oxlint-disable jsx-a11y/prefer-tag-over-role -- a card holds a label, description and price, which a native radio input cannot */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import "./fields.css";

export interface RadioCard<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
  /** Right-aligned extra, such as a price. */
  readonly meta?: ReactNode;
  readonly icon?: ReactNode;
}

/**
 * Arc's radio cards, built natively: selectable cards in a radiogroup, each with a label and description, the
 * selection shown by a ring and a filled dot. `list` stacks one per row; `grid` fills columns.
 */
export function RadioCards<T extends string>(props: {
  readonly label: string;
  readonly hideLabel?: boolean;
  readonly value: T;
  readonly options: readonly RadioCard<T>[];
  readonly onChange: (value: T) => void;
  readonly layout?: "list" | "grid";
}) {
  const id = useId();
  const { options, value, onChange } = props;
  const layout = props.layout ?? "list";
  const rootRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const selected = options.findIndex((option) => option.value === value);
  // One tab stop: the chosen card, or the first when nothing is chosen.
  const tabStop = selected >= 0 ? selected : 0;

  /** Put the ring over the chosen card. `glide` lets it travel from the last card; otherwise it snaps in place. */
  const place = useCallback(
    (glide: boolean): void => {
      const ring = ringRef.current;
      const card = rootRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
      if (ring === null) return;
      if (card === null || card === undefined) {
        ring.removeAttribute("data-on");
        placed.current = false;
        return;
      }
      const snap = !glide || !placed.current;
      if (snap) ring.setAttribute("data-snap", "");
      ring.style.setProperty("--rc-x", `${card.offsetLeft}px`);
      ring.style.setProperty("--rc-y", `${card.offsetTop}px`);
      ring.style.setProperty("--rc-w", `${card.offsetWidth}px`);
      ring.style.setProperty("--rc-h", `${card.offsetHeight}px`);
      ring.setAttribute("data-on", "");
      if (snap) {
        ring.getBoundingClientRect();
        ring.removeAttribute("data-snap");
      }
      placed.current = true;
    },
    [selected],
  );

  useLayoutEffect(() => {
    place(true);
  }, [place]);

  // A resize only snaps the ring to the new layout; it never replays the glide.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place(false));
    observer.observe(root);
    return () => observer.disconnect();
  }, [place]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number): void => {
    const last = options.length - 1;
    let to: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      to = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      to = index === 0 ? last : index - 1;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = last;
    else return;
    event.preventDefault();
    const option = options[to];
    if (option === undefined) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-index="${to}"]`)?.focus();
    onChange(option.value);
  };

  return (
    <div className="field fld">
      <span id={`${id}-label`} className={props.hideLabel === true ? "sr" : "fld-label"}>
        {props.label}
      </span>
      <div
        ref={rootRef}
        className="rc"
        data-layout={layout}
        role="radiogroup"
        aria-labelledby={`${id}-label`}
      >
        <span ref={ringRef} className="rc-ring" aria-hidden="true" />
        {options.map((option, index) => {
          const checked = index === selected;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              className="rc-card"
              data-index={index}
              aria-checked={checked}
              aria-labelledby={`${id}-${index}-label`}
              aria-describedby={
                option.description === undefined ? undefined : `${id}-${index}-desc`
              }
              tabIndex={index === tabStop ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span className="rc-indicator" aria-hidden="true">
                <span className="rc-dot" />
              </span>
              <span className="rc-body">
                <span id={`${id}-${index}-label`} className="rc-label">
                  {option.icon === undefined ? null : (
                    <span className="rc-icon">{option.icon}</span>
                  )}
                  <span className="rc-label-text">{option.label}</span>
                </span>
                {option.description === undefined ? null : (
                  <span id={`${id}-${index}-desc`} className="rc-desc">
                    {option.description}
                  </span>
                )}
              </span>
              {option.meta === undefined ? null : <span className="rc-meta">{option.meta}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
