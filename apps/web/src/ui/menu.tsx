import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cx } from "./cx.ts";
import { useFloatingLayer, type FloatingLayer } from "./floating.ts";
import { Switch } from "./switch.tsx";

/** Gap between trigger and panel: Arc's menu sits 8px away, its popover 6px. */
const menuGap = 8;
const popoverGap = 6;

const CloseContext = createContext<(returnFocus?: boolean) => void>(() => undefined);

interface LayerProps {
  /** Accessible name of the trigger button. */
  readonly label: string;
  /** Content of the trigger: an icon, an avatar, a count. */
  readonly trigger: ReactNode;
  readonly triggerClassName?: string | undefined;
  readonly children: ReactNode;
}

function Trigger({
  layer,
  triggerRef,
  popup,
  label,
  trigger,
  triggerClassName,
}: Omit<LayerProps, "children"> & {
  readonly layer: FloatingLayer;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly popup: "menu" | "dialog";
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      className={triggerClassName}
      aria-label={label}
      aria-haspopup={popup}
      aria-expanded={layer.open}
      aria-controls={layer.panelId}
      onClick={layer.toggle}
      onKeyDown={(event) => {
        if (popup === "menu" && event.key === "ArrowDown" && !layer.open) {
          event.preventDefault();
          layer.show();
        }
      }}
    >
      {trigger}
    </button>
  );
}

/** Rows the arrow keys visit: actions, switches, and the chosen option of a segmented control. */
const rowSelector =
  '[role="menuitem"]:not(:disabled), input[role="switch"]:not(:disabled), .seg button[aria-pressed="true"]';

function items(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(rowSelector)];
}

/** The row a pointer or focus target belongs to: the element itself, or the label that holds a switch. */
function rowOf(panel: HTMLElement, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest<HTMLElement>(".item");
  return row !== null && panel.contains(row) ? row : null;
}

/**
 * One highlight that glides between rows, for the pointer and the keyboard. It is the only hover treatment in the
 * menu. Placed with a transform from the row's offset; the first show lands in place instead of sliding in.
 */
function useRowHighlight(
  panel: RefObject<HTMLDivElement | null>,
  highlight: RefObject<HTMLSpanElement | null>,
) {
  const place = (row: HTMLElement | null): void => {
    const mark = highlight.current;
    if (mark === null) return;
    if (row === null) {
      mark.removeAttribute("data-on");
      return;
    }
    const arriving = !mark.hasAttribute("data-on");
    if (arriving) mark.setAttribute("data-snap", "");
    mark.style.setProperty("--hl-y", `${row.offsetTop}px`);
    mark.style.setProperty("--hl-h", `${row.offsetHeight}px`);
    mark.setAttribute("data-tone", row.classList.contains("danger") ? "danger" : "neutral");
    if (arriving) {
      mark.getBoundingClientRect();
      mark.removeAttribute("data-snap");
    }
    mark.setAttribute("data-on", "true");
  };
  return {
    onPointerOver: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "mouse" || panel.current === null) return;
      place(rowOf(panel.current, event.target));
    },
    onPointerLeave: () => place(null),
    onFocus: (event: FocusEvent<HTMLElement>) => {
      const current = panel.current;
      if (current === null || !event.target.matches(":focus-visible")) return;
      place(rowOf(current, event.target));
    },
    onBlur: () => place(null),
  };
}

/**
 * A button that opens a floating menu. Items are `MenuItem`s and `MenuSwitch`es; arrow keys, Home and End move
 * between rows (Left and Right change the appearance option), Escape closes and returns focus to the trigger.
 * `variant="row"` is the compact menu used in table rows. `variant="account"` rises as a bottom sheet on phones.
 */
export function Menu(props: LayerProps & { readonly variant?: "account" | "row" }) {
  const { layer, triggerRef, panelRef } = useFloatingLayer(menuGap);
  const { open } = layer;
  const row = props.variant === "row";
  const highlight = useRef<HTMLSpanElement>(null);
  const rowEvents = useRowHighlight(panelRef, highlight);
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || panel === null) return;
    // Rows fade in one after another; the index only sets the delay.
    items(panel).forEach((item, index) =>
      item.closest<HTMLElement>(".item, .theme")?.style.setProperty("--i", String(index)),
    );
    items(panel)[0]?.focus();
  }, [open, panelRef]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const panel = panelRef.current;
    if (panel === null) return;
    if (event.key === "Tab") {
      layer.hide(false);
      return;
    }
    const active = document.activeElement;
    const segment = active instanceof HTMLElement ? active.closest(".seg") : null;
    if (segment !== null && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      const options = [...segment.querySelectorAll<HTMLButtonElement>("button")];
      const at = options.findIndex((option) => option === active);
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = options[(at + step + options.length) % options.length];
      event.preventDefault();
      next?.click();
      // The chosen option is the only one in the list, so focus follows it after the click renders.
      requestAnimationFrame(() =>
        segment.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus(),
      );
      return;
    }
    const list = items(panel);
    if (list.length === 0) return;
    const at = list.findIndex((item) => item === active);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (at + 1) % list.length;
    else if (event.key === "ArrowUp") next = (at <= 0 ? list.length : at) - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    if (next === null) return;
    event.preventDefault();
    list[next]?.focus();
  };
  return (
    <span className={cx("menu-anchor", row && "rowmenu")}>
      <Trigger
        label={props.label}
        trigger={props.trigger}
        triggerClassName={props.triggerClassName}
        layer={layer}
        triggerRef={triggerRef}
        popup="menu"
      />
      <CloseContext value={layer.hide}>
        <div
          ref={panelRef}
          id={layer.panelId}
          className={cx("menu", row ? "menu-row" : "menu-account", layer.above && "above")}
          role="menu"
          tabIndex={-1}
          popover="manual"
          style={layer.style}
          onKeyDown={onKeyDown}
          {...rowEvents}
          onPointerDown={(event) => {
            // On a phone the sheet has a scrim. A press on it lands on the panel itself, outside its box.
            if (event.target !== event.currentTarget) return;
            const box = event.currentTarget.getBoundingClientRect();
            const inside =
              event.clientX >= box.left &&
              event.clientX <= box.right &&
              event.clientY >= box.top &&
              event.clientY <= box.bottom;
            if (!inside) layer.hide();
          }}
        >
          <span ref={highlight} className="menu-highlight" aria-hidden="true" />
          {props.children}
        </div>
      </CloseContext>
    </span>
  );
}

/**
 * A button that opens a floating non-modal dialog, for example the notification panel. Escape closes it and
 * returns focus to the trigger.
 */
export function Popover(
  props: LayerProps & {
    /** Name of the panel for assistive tech. */
    readonly panelLabel: string;
    readonly panelClassName?: string;
  },
) {
  const { layer, triggerRef, panelRef } = useFloatingLayer(popoverGap);
  const { open } = layer;
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open, panelRef]);
  return (
    <span className="menu-anchor">
      <Trigger
        label={props.label}
        trigger={props.trigger}
        triggerClassName={props.triggerClassName}
        layer={layer}
        triggerRef={triggerRef}
        popup="dialog"
      />
      <CloseContext value={layer.hide}>
        <div
          ref={panelRef}
          id={layer.panelId}
          className={cx(props.panelClassName ?? "notif", layer.above && "above")}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a <dialog popover> is not reliably shown, so the role is set on a div
          role="dialog"
          aria-label={props.panelLabel}
          popover="manual"
          tabIndex={-1}
          style={layer.style}
        >
          {props.children}
        </div>
      </CloseContext>
    </span>
  );
}

/** Close the surrounding Menu or Popover from inside it. */
function useCloseLayer(): () => void {
  return useContext(CloseContext);
}

/** One action in a menu. Selecting it runs `onSelect`, then closes the menu and returns focus to the trigger. */
export function MenuItem(props: {
  readonly icon?: ReactNode;
  readonly danger?: boolean;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}) {
  const close = useCloseLayer();
  return (
    <button
      type="button"
      role="menuitem"
      className={cx("item", props.danger === true && "danger")}
      onClick={() => {
        props.onSelect();
        close();
      }}
    >
      {props.icon}
      {props.children}
    </button>
  );
}

/** A switch row inside a menu. Toggling it leaves the menu open. */
export function MenuSwitch(props: {
  readonly icon?: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly children: ReactNode;
}) {
  return (
    <label className="item switchrow">
      <span className="lbl">
        {props.icon}
        {props.children}
      </span>
      <Switch checked={props.checked} onChange={props.onChange} />
    </label>
  );
}

/** The header of the account menu: a face, then "Signed in as" and the name on one line. Long names ellipsize. */
export function MenuWho(props: {
  readonly lead: string;
  readonly name: string;
  readonly face?: ReactNode;
}) {
  return (
    <div className="menu-who">
      {props.face === undefined ? null : <span className="menu-who-face">{props.face}</span>}
      <span className="menu-who-line">
        {props.lead} <b>{props.name}</b>
      </span>
    </div>
  );
}

/** A hairline between groups of rows. */
export function MenuSeparator() {
  return <hr className="menu-sep" />;
}

/** A full-width block inside a menu, for a control such as the appearance segments. */
export function MenuBlock(props: { readonly children: ReactNode }) {
  return <div className="theme">{props.children}</div>;
}
