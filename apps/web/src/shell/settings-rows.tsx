import { createContext, useContext, type ReactNode } from "react";

import type { Provider } from "@headroom/core/contracts";

import { BrandMark } from "../icons.tsx";
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

export function Body(props: {
  readonly title: string;
  readonly note: string;
  /** A provider whose brand mark leads the title. */
  readonly mark?: Provider | undefined;
}) {
  return (
    <span className="sbody">
      <b>
        {props.mark === undefined ? null : <BrandMark provider={props.mark} />}
        {props.title}
      </b>
      {props.note === "" ? null : <span className="muted">{props.note}</span>}
    </span>
  );
}

export function SwitchRow(props: {
  readonly title: string;
  readonly note: string;
  readonly mark?: Provider | undefined;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const waiting = useContext(WaitingContext);
  if (waiting) {
    return (
      <div className="srow">
        <Body title={props.title} note={props.note} mark={props.mark} />
        <Sk width={42} height={24} className="sk-pill sk-control" />
      </div>
    );
  }
  return (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the Switch component renders the input
    <label className="srow">
      <Body title={props.title} note={props.note} mark={props.mark} />
      <Switch
        checked={props.checked}
        disabled={props.disabled === true}
        onChange={props.onChange}
      />
    </label>
  );
}
