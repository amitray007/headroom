import { useContext, useId, useState } from "react";

import type { Provider } from "@headroom/core/contracts";

import type { Settings } from "../api.ts";
import { useSettings } from "../lib/settings.tsx";
import type { SettingsPatch } from "../lib/settings-store.ts";
import { Dialog } from "../ui/dialog.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";
import { Segmented } from "../ui/segmented.tsx";
import { Sk } from "../ui/skeleton.tsx";
import { SlideSwap, type SwapDirection } from "../ui/slide-swap.tsx";
import { Tabs } from "../ui/tabs.tsx";
import { ChannelsTab } from "./delivery/tab.tsx";
import { ProviderCards } from "./provider-cards.tsx";
import { Body, Section, SwitchRow, WaitingContext } from "./settings-rows.tsx";

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

const thresholds = [30, 20, 15] as const;
const intervals = [5, 10, 15, 30] as const;

const tabs = [
  { value: "general", label: "General" },
  { value: "notifications", label: "Notifications" },
  { value: "channels", label: "Channels" },
] as const;

/** The tabs of the dialog. */
export type SettingsTab = (typeof tabs)[number]["value"];

function General(props: { readonly change: (patch: SettingsPatch) => void }) {
  const { settings } = useSettings();
  const { change } = props;
  return (
    <>
      <Section title="Limits">
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
        <SwitchRow
          title="Keep Inactive Last"
          note="Paused and disconnected stay at the bottom."
          checked={settings.keepInactiveLast}
          onChange={(keepInactiveLast) => change({ keepInactiveLast })}
        />
      </Section>
      <AccountActions change={change} />
    </>
  );
}

const leadDays = [1, 3, 7] as const;

function Notifications(props: {
  readonly change: (patch: SettingsPatch) => void;
  readonly providers: readonly Provider[];
}) {
  const { settings } = useSettings();
  const on = settings.notifications;
  const notify =
    (key: Exclude<keyof Settings["notifications"], "resetLeadDays" | "mutedProviders">) =>
    (checked: boolean) =>
      props.change({ notifications: { [key]: checked } });
  const mute = (provider: Provider) => (shown: boolean) =>
    props.change({
      notifications: {
        mutedProviders: shown
          ? on.mutedProviders.filter((name) => name !== provider)
          : [...on.mutedProviders, provider],
      },
    });
  return (
    <>
      <Section title="Types">
        <SwitchRow
          title="Running Low"
          note="When a limit is running low."
          checked={on.runningLow}
          onChange={notify("runningLow")}
        />
        <SwitchRow
          title="Expiring Resets"
          note="Before a saved reset expires."
          checked={on.expiringResets}
          onChange={notify("expiringResets")}
        />
        <NumberRow
          title="Reset Warning"
          note="How early to warn before a saved reset expires."
          value={on.resetLeadDays}
          values={leadDays}
          format={(value) => `${value} ${value === 1 ? "Day" : "Days"}`}
          onChange={(resetLeadDays) => props.change({ notifications: { resetLeadDays } })}
        />
        <SwitchRow
          title="Balances"
          note="When prepaid credits are running low."
          checked={on.balances}
          onChange={notify("balances")}
        />
        <SwitchRow
          title="Spend"
          note="When extra spend nears or hits its cap."
          checked={on.spend}
          onChange={notify("spend")}
        />
        <SwitchRow
          title="Refresh Failures"
          note="When an account stops updating."
          checked={on.refreshFailures}
          onChange={notify("refreshFailures")}
        />
      </Section>
      <Section title="Limits">
        <SwitchRow
          title="Include 5-Hour Sessions"
          note="Off keeps weekly and monthly limits only."
          checked={on.includeSessions}
          onChange={notify("includeSessions")}
        />
      </Section>
      <Section title="Providers">
        <ProviderCards
          providers={props.providers}
          muted={on.mutedProviders}
          onToggle={(provider, shown) => mute(provider)(shown)}
        />
      </Section>
    </>
  );
}

function AccountActions(props: { readonly change: (patch: SettingsPatch) => void }) {
  const { settings } = useSettings();
  return (
    <Section title="Account Actions">
      <SwitchRow
        title="Allow Account Actions"
        note="Lets the hold button use a Codex reset."
        checked={settings.accountActions}
        onChange={(accountActions) => props.change({ accountActions })}
      />
    </Section>
  );
}

/** The owner's preferences, in tabs. Every change applies at once and is saved by the settings store. */
export function SettingsDialog(props: {
  readonly open: boolean;
  /** Providers with a connected account, in the saved order. */
  readonly providers: readonly Provider[];
  readonly onClose: () => void;
}) {
  const store = useSettings();
  const { loaded, loadFailed } = store;
  const [retrying, setRetrying] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("general");
  const [direction, setDirection] = useState<SwapDirection>("swap");
  const [wasOpen, setWasOpen] = useState(props.open);
  const panelId = useId();
  // The dialog opens on General every time.
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setTab("general");
  }
  const retry = (): void => {
    setRetrying(true);
    void store.reload().finally(() => setRetrying(false));
  };
  const choose = (next: SettingsTab): void => {
    const index = (value: SettingsTab): number => tabs.findIndex((entry) => entry.value === value);
    setDirection(index(next) > index(tab) ? "next" : "prev");
    setTab(next);
  };
  const change = (patch: SettingsPatch): void => void store.update(patch);
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
          <Tabs
            label="Settings"
            className="stabs"
            tabClassName="stab"
            indicator
            panelId={panelId}
            tabs={tabs}
            value={tab}
            onChange={choose}
          />
          <div
            id={panelId}
            role="tabpanel"
            aria-label={tabs.find((t) => t.value === tab)?.label}
            aria-busy={!loaded}
          >
            {store.error === null ? null : (
              <section className="dsec">
                <p className="form-error" role="alert">
                  {store.error}
                </p>
              </section>
            )}
            <SlideSwap swapKey={tab} direction={direction}>
              {tab === "general" ? <General change={change} /> : null}
              {tab === "notifications" ? (
                <Notifications change={change} providers={props.providers} />
              ) : null}
              {tab === "channels" ? <ChannelsTab /> : null}
            </SlideSwap>
          </div>
        </WaitingContext>
      )}
    </Dialog>
  );
}
