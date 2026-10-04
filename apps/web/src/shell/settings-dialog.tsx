import { useContext, useId, useState } from "react";

import type { NotificationKind, Provider } from "@headroom/core/contracts";
import type { OverviewConnection } from "@headroom/view-model/overview";

import { useDevicePrefs } from "../lib/device-prefs.ts";
import { useSettings } from "../lib/settings.tsx";
import type { SettingsPatch } from "../lib/settings-store.ts";
import { Dialog } from "../ui/dialog.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";
import { Segmented } from "../ui/segmented.tsx";
import { Sk } from "../ui/skeleton.tsx";
import { SlideSwap, type SwapDirection } from "../ui/slide-swap.tsx";
import { Tabs } from "../ui/tabs.tsx";
import { AutomationsTab } from "./automations-tab.tsx";
import { ChannelsTab } from "./delivery/tab.tsx";
import { ExchangeRatesSection } from "./exchange-rates-section.tsx";
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
const retentions = [30, 90, 180, 365] as const;

const tabs = [
  { value: "general", label: "General" },
  { value: "notifications", label: "Notifications" },
  { value: "automations", label: "Automations" },
  { value: "channels", label: "Channels" },
  { value: "privacy", label: "Privacy" },
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
      <Section title="Data">
        <NumberRow
          title="History"
          note="Older refresh history is deleted. The latest reading of each account is always kept."
          value={settings.historyRetentionDays}
          values={retentions}
          format={(value) => (value === 365 ? "1 year" : `${value} days`)}
          onChange={(historyRetentionDays) => change({ historyRetentionDays })}
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
      <ExchangeRatesSection />
    </>
  );
}

/** Device preferences, so they never wait for the server settings. */
function Privacy() {
  const prefs = useDevicePrefs();
  return (
    <Section>
      <SwitchRow
        device
        title="Privacy Mode"
        note="Blur emails and usernames until you hover them. Saved on this device."
        checked={prefs.privacy}
        onChange={prefs.setPrivacy}
      />
      <SwitchRow
        device
        title="Demo Mode"
        note="Show made-up accounts, figures and notifications, for screenshots and screen sharing. Saved on this device."
        checked={prefs.demo}
        onChange={prefs.setDemo}
      />
    </Section>
  );
}

const leadDays = [1, 3, 7] as const;

type Kind = NotificationKind;

const kindGroups: readonly {
  readonly title: string;
  readonly rows: readonly { readonly kind: Kind; readonly title: string; readonly note: string }[];
}[] = [
  {
    title: "Balances and Credits",
    rows: [
      {
        kind: "balance_low",
        title: "Balance Low",
        note: "When a credit balance is running low.",
      },
      {
        kind: "top_up_detected",
        title: "Top-Up Detected",
        note: "When a credit balance goes up.",
      },
      {
        kind: "credits_expiring",
        title: "Credits Expiring",
        note: "Before credits in your Wallet expire.",
      },
    ],
  },
  {
    title: "Spend",
    rows: [
      {
        kind: "extra_usage_started",
        title: "On-Demand Started",
        note: "When an account starts using paid on-demand or extra usage, including Copilot.",
      },
      {
        kind: "spend_near_cap",
        title: "Near Spending Cap",
        note: "When spend gets close to the cap the provider set.",
      },
      {
        kind: "spend_cap_reached",
        title: "Spending Cap Reached",
        note: "When spend hits the cap the provider set.",
      },
      {
        kind: "budget_near",
        title: "Near Your Budget",
        note: "When spend gets close to a budget you set under Automations.",
      },
      {
        kind: "budget_exceeded",
        title: "Over Your Budget",
        note: "When spend passes a budget you set under Automations.",
      },
    ],
  },
  {
    title: "Sign-In",
    rows: [
      {
        kind: "refresh_failed",
        title: "Refresh Failed",
        note: "When an account fails to update twice in a row.",
      },
      {
        kind: "disconnected",
        title: "Disconnected",
        note: "When a sign-in expires and the account needs to be reconnected.",
      },
    ],
  },
];

function Notifications(props: {
  readonly change: (patch: SettingsPatch) => void;
  readonly providers: readonly Provider[];
}) {
  const { settings } = useSettings();
  const on = settings.notifications;
  const notifyKind = (kind: Kind) => (checked: boolean) =>
    props.change({ notifications: { kinds: { [kind]: checked } } });
  const kindRow = (row: { kind: Kind; title: string; note: string }) => (
    <SwitchRow
      key={row.kind}
      title={row.title}
      note={row.note}
      checked={on.kinds[row.kind]}
      onChange={notifyKind(row.kind)}
    />
  );
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
      <Section title="Limits">
        {kindRow({
          kind: "running_low",
          title: "Running Low",
          note: "When a limit has little left, by your low-limit threshold.",
        })}
        {kindRow({
          kind: "almost_out",
          title: "Almost Out",
          note: "When a limit has under 10% left.",
        })}
        <SwitchRow
          title="Include 5-Hour Sessions"
          note="Off keeps weekly and monthly limits only."
          checked={on.includeSessions}
          onChange={(includeSessions) => props.change({ notifications: { includeSessions } })}
        />
      </Section>
      <Section title="Resets">
        {kindRow({
          kind: "reset_expiring",
          title: "Expiring Reset",
          note: "When a banked reset is about to expire.",
        })}
        <NumberRow
          title="Reset Warning"
          note="How early to warn before a banked reset expires."
          value={on.resetLeadDays}
          values={leadDays}
          format={(value) => `${value} ${value === 1 ? "Day" : "Days"}`}
          onChange={(resetLeadDays) => props.change({ notifications: { resetLeadDays } })}
        />
        {kindRow({
          kind: "reset_granted",
          title: "New Banked Reset",
          note: "When an account banks a new reset.",
        })}
        {kindRow({
          kind: "early_reset",
          title: "Early Reset",
          note: "When a limit resets before its scheduled time.",
        })}
        {kindRow({
          kind: "auto_reset",
          title: "Auto-Reset Result",
          note: "When Headroom uses a banked reset for you, or tries and fails.",
        })}
      </Section>
      {kindGroups.map((group) => (
        <Section key={group.title} title={group.title}>
          {group.rows.map(kindRow)}
        </Section>
      ))}
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
  /** The accounts the Automations tab lists; null until the overview loads. */
  readonly connections: readonly OverviewConnection[] | null;
  /** Reload the overview after an automation changed. */
  readonly onAccountsChanged: () => Promise<void>;
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
              {tab === "automations" ? (
                <AutomationsTab
                  connections={props.connections}
                  onChanged={props.onAccountsChanged}
                />
              ) : null}
              {tab === "channels" ? <ChannelsTab /> : null}
              {tab === "privacy" ? <Privacy /> : null}
            </SlideSwap>
          </div>
        </WaitingContext>
      )}
    </Dialog>
  );
}
