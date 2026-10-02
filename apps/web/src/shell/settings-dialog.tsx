import { createContext, useContext, useState, type ReactNode } from "react";

import type { Settings } from "../api.ts";
import { useSettings } from "../lib/settings.tsx";
import type { SettingsPatch } from "../lib/settings-store.ts";
import { Dialog } from "../ui/dialog.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";
import { Segmented } from "../ui/segmented.tsx";
import { Sk } from "../ui/skeleton.tsx";
import { Switch } from "../ui/switch.tsx";

/** True while the settings load: each row keeps its words and shows a placeholder where the control goes. */
const WaitingContext = createContext(false);

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="dsec">
      <div className="dsec-head">
        <h3>{props.title}</h3>
      </div>
      {props.children}
    </section>
  );
}

function Body(props: { readonly title: string; readonly note: string }) {
  return (
    <span className="sbody">
      <b>{props.title}</b>
      <span className="muted">{props.note}</span>
    </span>
  );
}

function ChoiceRow<T extends string>(props: {
  readonly title: string;
  readonly note: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
}) {
  const waiting = useContext(WaitingContext);
  return (
    <div className="srow srow-choice">
      <Body title={props.title} note={props.note} />
      {waiting ? (
        <span className="sk-segs" aria-hidden="true">
          {props.options.map((option) => (
            <Sk
              key={option.value}
              width={option.label.length * 7 + 20}
              height={26}
              className="sk-pill"
            />
          ))}
        </span>
      ) : (
        <Segmented
          label={props.title}
          value={props.value}
          options={props.options}
          onChange={props.onChange}
        />
      )}
    </div>
  );
}

/** A choice among numbers. The segments hold text; this maps it back to the number. */
function NumberRow<T extends number>(props: {
  readonly title: string;
  readonly note: string;
  readonly value: T;
  readonly values: readonly T[];
  readonly format: (value: T) => string;
  readonly onChange: (value: T) => void;
}) {
  return (
    <ChoiceRow
      title={props.title}
      note={props.note}
      value={String(props.value)}
      options={props.values.map((value) => ({ value: String(value), label: props.format(value) }))}
      onChange={(text) => {
        const next = props.values.find((value) => String(value) === text);
        if (next !== undefined) props.onChange(next);
      }}
    />
  );
}

function SwitchRow(props: {
  readonly title: string;
  readonly note: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const waiting = useContext(WaitingContext);
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

const thresholds = [30, 20, 15] as const;
const intervals = [5, 10, 15, 30] as const;

/** The owner's preferences. Every change applies at once and is saved by the settings store. */
export function SettingsDialog(props: { readonly open: boolean; readonly onClose: () => void }) {
  const store = useSettings();
  const { settings, actionsAllowedByServer, loaded, loadFailed } = store;
  const [retrying, setRetrying] = useState(false);
  const retry = (): void => {
    setRetrying(true);
    void store.reload().finally(() => setRetrying(false));
  };
  const change = (patch: SettingsPatch): void => void store.update(patch);
  const notify = (key: keyof Settings["notifications"]) => (checked: boolean) =>
    change({ notifications: { [key]: checked } });
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Settings" variant="settings">
      {loadFailed ? (
        <section className="dsec">
          <ErrorNotice inline busy={retrying} onRetry={retry}>
            Headroom could not load your settings. Check that it is running and try again.
          </ErrorNotice>
        </section>
      ) : (
        <WaitingContext value={!loaded}>
          <div aria-busy={!loaded}>
            {store.error === null ? null : (
              <section className="dsec">
                <p className="form-error" role="alert">
                  {store.error}
                </p>
              </section>
            )}
            <Section title="Limits">
              <ChoiceRow
                title="Show Limits As"
                note="Show what you have used, or what is left."
                value={settings.limitsView}
                options={[
                  { value: "used", label: "Used" },
                  { value: "left", label: "Left" },
                ]}
                onChange={(limitsView) => change({ limitsView })}
              />
              <NumberRow
                title="Running Low Under"
                note="Bars turn amber below this. Red means under 10%."
                value={settings.lowThresholdPercent}
                values={thresholds}
                format={(value) => `${value}%`}
                onChange={(lowThresholdPercent) => change({ lowThresholdPercent })}
              />
            </Section>
            <Section title="Refresh">
              <NumberRow
                title="Refresh Every"
                note="How often your accounts update."
                value={settings.refreshIntervalMinutes}
                values={intervals}
                format={(value) => `${value} min`}
                onChange={(refreshIntervalMinutes) => change({ refreshIntervalMinutes })}
              />
            </Section>
            <Section title="Time">
              <ChoiceRow
                title="Times"
                note="“In 52 min” or “at 15:06”."
                value={settings.timeStyle}
                options={[
                  { value: "countdown", label: "Countdown" },
                  { value: "exact", label: "Exact" },
                ]}
                onChange={(timeStyle) => change({ timeStyle })}
              />
              <ChoiceRow
                title="Clock"
                note="15:06 or 3:06 PM."
                value={settings.clock}
                options={[
                  { value: "24h", label: "24-Hour" },
                  { value: "12h", label: "12-Hour" },
                ]}
                onChange={(clock) => change({ clock })}
              />
            </Section>
            <Section title="Display">
              <ChoiceRow
                title="Density"
                note="Compact fits more on screen."
                value={settings.density}
                options={[
                  { value: "comfortable", label: "Comfortable" },
                  { value: "compact", label: "Compact" },
                ]}
                onChange={(density) => change({ density })}
              />
            </Section>
            <Section title="Account Actions">
              <SwitchRow
                title="Allow Account Actions"
                note={
                  actionsAllowedByServer
                    ? "Lets the hold button use a Codex reset."
                    : "Turned off on your server."
                }
                checked={settings.accountActions && actionsAllowedByServer}
                disabled={!actionsAllowedByServer}
                onChange={(accountActions) => change({ accountActions })}
              />
            </Section>
            <Section title="Notifications">
              <SwitchRow
                title="Running Low"
                note="When an account is running low."
                checked={settings.notifications.runningLow}
                onChange={notify("runningLow")}
              />
              <SwitchRow
                title="Expiring Resets"
                note="Before a saved Codex reset expires."
                checked={settings.notifications.expiringResets}
                onChange={notify("expiringResets")}
              />
              <SwitchRow
                title="Refresh Failures"
                note="When an account stops updating."
                checked={settings.notifications.refreshFailures}
                onChange={notify("refreshFailures")}
              />
            </Section>
          </div>
        </WaitingContext>
      )}
    </Dialog>
  );
}
