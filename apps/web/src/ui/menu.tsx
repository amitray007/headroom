import {
  createContext,
  useContext,
  useEffect,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cx } from "./cx.ts";
import { useFloatingLayer, type FloatingLayer } from "./floating.ts";
import { Switch } from "./switch.tsx";

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

function items(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
}

/**
 * A button that opens a floating menu. Items are `MenuItem`s; arrow keys, Home and End move between them,
 * Escape closes and returns focus to the trigger. `variant="row"` is the compact menu used in table rows.
 */
export function Menu(props: LayerProps & { readonly variant?: "account" | "row" }) {
  const { layer, triggerRef, panelRef } = useFloatingLayer();
  const { open } = layer;
  useEffect(() => {
    if (open && panelRef.current !== null) items(panelRef.current)[0]?.focus();
  }, [open, panelRef]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const panel = panelRef.current;
    if (panel === null) return;
    if (event.key === "Tab") {
      layer.hide(false);
      return;
    }
    const list = items(panel);
    if (list.length === 0) return;
    const at = list.findIndex((item) => item === document.activeElement);
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
    <span className={cx("menu-anchor", props.variant === "row" && "rowmenu")}>
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
          className={cx("menu", layer.above && "above")}
          role="menu"
          tabIndex={-1}
          popover="manual"
          style={layer.style}
          onKeyDown={onKeyDown}
        >
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
  const { layer, triggerRef, panelRef } = useFloatingLayer();
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

/** The "Signed in as" header of the account menu. */
export function MenuWho(props: { readonly lead: string; readonly name: string }) {
  return (
    <div className="who">
      {props.lead}
      <b>{props.name}</b>
    </div>
  );
}

/** A full-width block inside a menu, for a control such as the appearance segments. */
export function MenuBlock(props: { readonly children: ReactNode }) {
  return <div className="theme">{props.children}</div>;
}
