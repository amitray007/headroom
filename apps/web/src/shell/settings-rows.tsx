import { createContext, useContext, type ReactNode } from "react";

import { Sk } from "../ui/skeleton.tsx";
import { Switch } from "../ui/switch.tsx";

/** True while the settings load: each row keeps its words and shows a placeholder where the control goes. */
export const WaitingContext = createContext(false);

export function Section(props: { readonly title?: string; readonly children: ReactNode }) {
  return (
    <section className="dsec">
      {props.title === undefined ? null : (
        <div className="dsec-head">
          <h3>{props.title}</h3>
        </div>
      )}
      {props.children}
    </section>
  );
}

export function Body(props: { readonly title: string; readonly note: string }) {
  return (
    <span className="sbody">
      <b>{props.title}</b>
      {props.note === "" ? null : <span className="muted">{props.note}</span>}
    </span>
  );
}

export function SwitchRow(props: {
  readonly title: string;
  readonly note: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  /** Saved on this device, not in the server settings, so it never waits for them to load. */
  readonly device?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const waiting = useContext(WaitingContext) && props.device !== true;
  if (waiting) {
    return (
      <div className="srow">
        <Body title={props.title} note={props.note} />
        <Sk width={42} height={24} className="sk-pill sk-control" />
      </div>
    );
  }
  return (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the Switch component renders the input
    <label className="srow">
      <Body title={props.title} note={props.note} />
      <Switch
        checked={props.checked}
        disabled={props.disabled === true}
        onChange={props.onChange}
      />
    </label>
  );
}
