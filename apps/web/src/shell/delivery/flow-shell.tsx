import type { ReactNode } from "react";

import type { NotificationChannelType } from "@headroom/core/contracts";

import { DestinationMark } from "../../icons.tsx";
import { Stepper, type StepState } from "../../ui/stepper.tsx";
import { destinationName } from "./status.ts";

/** The frame of a setup flow: title, stepper and the current stage, which fades in when `stage` changes. */
export function FlowShell(props: {
  readonly type: NotificationChannelType;
  readonly words: readonly string[];
  readonly step: number;
  readonly state: StepState;
  readonly stage: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="dl-panel step" aria-label={`${destinationName(props.type)} Setup`}>
      <div className="title">
        <h2>
          <DestinationMark type={props.type} size={24} />
          {destinationName(props.type)}
        </h2>
      </div>
      <Stepper words={props.words} step={props.step} state={props.state} />
      <div key={props.stage} className="stage">
        {props.children}
      </div>
    </section>
  );
}
