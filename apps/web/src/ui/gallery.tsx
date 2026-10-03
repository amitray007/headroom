import { useEffect, useState, type ReactNode } from "react";

import { providers, type Provider } from "@headroom/core/contracts";

import * as icons from "../icons.tsx";
import { Avatar, BrandMark } from "../icons.tsx";
import { BankedResets } from "./banked-resets.tsx";
import { useNow } from "../lib/now.ts";
import { Bar, type BarTone } from "./bar.tsx";
import { Button, ButtonLink } from "./button.tsx";
import { CountUp } from "./count-up.tsx";
import { DatePicker } from "./date-picker.tsx";
import { Dialog } from "./dialog.tsx";
import { HoldButton, type HoldPhase } from "./hold-button.tsx";
import { InfoTip } from "./info-tip.tsx";
import { Lockup } from "./lockup.tsx";
import { Menu, MenuBlock, MenuItem, MenuSwitch, MenuWho, Popover } from "./menu.tsx";
import { MoneyInput } from "./money-input.tsx";
import { HealthyStatus, Pill, StatusPill, StatusSlot, type StatusKind } from "./pill.tsx";
import { RadioCards, type RadioCard } from "./radio-cards.tsx";
import { Segmented } from "./segmented.tsx";
import { Select, type SelectOption } from "./select.tsx";
import { Spinner } from "./spinner.tsx";
import { Switch } from "./switch.tsx";

type Scheme = "system" | "light" | "dark";

const statusKinds: readonly StatusKind[] = [
  "active",
  "paused",
  "disconnected",
  "refresh_failed",
  "out_of_date",
  "partial",
  "waiting",
];
const tones: readonly BarTone[] = ["good", "warn", "bad", "neutral"];
const holdPhases: readonly HoldPhase[] = ["idle", "holding", "requesting", "ok", "failed"];

const iconList = [
  ["ClockIcon", icons.ClockIcon],
  ["PauseIcon", icons.PauseIcon],
  ["AlertIcon", icons.AlertIcon],
  ["PartialIcon", icons.PartialIcon],
  ["RetryIcon", icons.RetryIcon],
  ["ResetIcon", icons.ResetIcon],
  ["PlusIcon", icons.PlusIcon],
  ["PlugIcon", icons.PlugIcon],
  ["KeyIcon", icons.KeyIcon],
  ["SignOutIcon", icons.SignOutIcon],
  ["ExternalIcon", icons.ExternalIcon],
  ["CopyIcon", icons.CopyIcon],
  ["CheckIcon", icons.CheckIcon],
  ["TerminalIcon", icons.TerminalIcon],
  ["LinkIcon", icons.LinkIcon],
  ["HashIcon", icons.HashIcon],
  ["GearIcon", icons.GearIcon],
  ["InfoIcon", icons.InfoIcon],
  ["BellIcon", icons.BellIcon],
  ["CloseIcon", icons.CloseIcon],
  ["PencilIcon", icons.PencilIcon],
  ["EyeIcon", icons.EyeIcon],
  ["FingerprintIcon", icons.FingerprintIcon],
  ["TrashIcon", icons.TrashIcon],
  ["UserIcon", icons.UserIcon],
  ["PlayIcon", icons.PlayIcon],
  ["UnplugIcon", icons.UnplugIcon],
  ["DotsIcon", icons.DotsIcon],
  ["SparkleIcon", icons.SparkleIcon],
] as const;

const succeed = (outcome: "ok" | "failed") => () =>
  new Promise<"ok" | "failed">((resolve) => setTimeout(() => resolve(outcome), 1200));

const accountOptions: readonly SelectOption<string>[] = [
  {
    value: "claude-1",
    label: "Claude",
    meta: "Max 20x",
    detail: "amit.ray@example.com",
    icon: <BrandMark provider="claude" />,
    group: "Claude",
  },
  {
    value: "claude-2",
    label: "Claude",
    meta: "Pro",
    detail: "work@example.org",
    icon: <BrandMark provider="claude" />,
    group: "Claude",
  },
  {
    value: "codex-1",
    label: "Codex",
    meta: "Pro",
    detail: "amit.ray@example.com",
    icon: <BrandMark provider="codex" />,
    group: "Codex",
  },
  {
    value: "cursor-1",
    label: "Cursor",
    meta: "Pro+",
    detail: "amit.ray@example.com",
    icon: <BrandMark provider="cursor" />,
    group: "Cursor",
  },
  {
    value: "grok-1",
    label: "Grok",
    detail: "grok@example.net",
    icon: <BrandMark provider="grok" />,
    group: "Grok",
  },
  {
    value: "copilot-1",
    label: "Copilot",
    meta: "Individual",
    icon: <BrandMark provider="copilot" />,
    group: "Copilot",
  },
];
const cadenceOptions: readonly SelectOption<string>[] = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "weekly", label: "Weekly" },
];
const planCards: readonly RadioCard<string>[] = [
  {
    value: "monthly",
    label: "Monthly",
    description: "Renews every month. Cancel any time.",
    meta: "$20",
  },
  { value: "yearly", label: "Yearly", description: "Two months free.", meta: "$200" },
  {
    value: "usage",
    label: "Pay as you go",
    description: "Billed on use, with a monthly cap.",
    meta: "Variable",
  },
];
const planCardsWithIcons: readonly RadioCard<string>[] = planCards.map((card) =>
  Object.assign({}, card, { icon: <icons.SparkleIcon /> }),
);
const moneyCurrencies = [
  "USD",
  "INR",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "SGD",
  "CHF",
  "BRL",
] as const;
type MoneyCurrency = (typeof moneyCurrencies)[number];

/** Every form field once, so the same markup can sit on the page and inside a dialog. */
function FieldSet(props: { readonly prefix: string }) {
  const [account, setAccount] = useState<string | null>("claude-1");
  const [cadence, setCadence] = useState<string | null>(null);
  const [amount, setAmount] = useState<{ minor: number | null; currency: MoneyCurrency }>({
    minor: 1999,
    currency: "USD",
  });
  const [renews, setRenews] = useState<string | null>("2026-10-12");
  const [plan, setPlan] = useState("monthly");
  return (
    <div className="dl-form" data-prefix={props.prefix}>
      <Select
        label="Account"
        value={account}
        options={accountOptions}
        onChange={setAccount}
        placeholder="Choose an account"
      />
      <Select
        label="Billing cadence"
        value={cadence}
        options={cadenceOptions}
        onChange={setCadence}
        placeholder="Choose a cadence"
      />
      <MoneyInput
        label="Monthly cost"
        minor={amount.minor}
        currency={amount.currency}
        currencies={moneyCurrencies}
        onChange={setAmount}
        hint="Typed with grouping, stored as minor units."
      />
      <DatePicker label="Renews on" value={renews} onChange={setRenews} optional min="2026-10-01" />
      <RadioCards label="Plan" value={plan} options={planCards} onChange={setPlan} />
    </div>
  );
}

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
      <h2 style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: 500 }}>{props.title}</h2>
      {props.children}
    </section>
  );
}

function Row(props: { readonly children: ReactNode }) {
  return <div className="row">{props.children}</div>;
}

function Meter(props: {
  readonly label: string;
  readonly window: string;
  readonly percent: number;
  readonly caption: string;
}) {
  const tone: BarTone = props.percent >= 90 ? "bad" : props.percent >= 70 ? "warn" : "good";
  const left = 100 - props.percent;
  return (
    <div className="cell">
      <div className="label">
        <span>{props.label}</span> <span className="window">{props.window}</span>
      </div>
      <div className="value">
        <CountUp value={props.percent} />
        <span className="unit">%</span>
      </div>
      <Bar
        percent={props.percent}
        tone={tone}
        label={`${props.label} ${props.percent}% used`}
        valueNow={props.percent}
      />
      <div className="caption">
        {left < 10 ? <span className="tone bad">Almost Out · </span> : null}
        {left >= 10 && left < 30 ? <span className="tone warn">Running Low · </span> : null}
        {props.caption}
      </div>
    </div>
  );
}

function AccountMenu(props: {
  readonly scheme: Scheme;
  readonly onScheme: (scheme: Scheme) => void;
  readonly hide: boolean;
  readonly onHide: (hide: boolean) => void;
  readonly onSettings: () => void;
}) {
  return (
    <Menu label="Account Menu" trigger={<Avatar />} triggerClassName="avatar">
      <MenuWho lead="Signed in as" name="maverick" />
      <MenuBlock>
        <Segmented
          full
          label="Appearance"
          value={props.scheme}
          onChange={props.onScheme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </MenuBlock>
      <MenuSwitch icon={<icons.EyeIcon />} checked={props.hide} onChange={props.onHide}>
        Privacy Mode
      </MenuSwitch>
      <MenuItem icon={<icons.GearIcon />} onSelect={props.onSettings}>
        Settings
      </MenuItem>
      <MenuItem icon={<icons.UserIcon />} onSelect={() => undefined}>
        Account
      </MenuItem>
      <MenuItem icon={<icons.SignOutIcon />} danger onSelect={() => undefined}>
        Sign Out
      </MenuItem>
    </Menu>
  );
}

function Notifications() {
  return (
    <Popover
      label="Notifications, 2 unread"
      trigger={
        <>
          <icons.BellIcon />
          <span className="badge num" aria-hidden="true">
            2
          </span>
        </>
      }
      triggerClassName="bell"
      panelLabel="Notifications"
    >
      <div className="nhead">
        <div>
          <h2>Notifications</h2>
          <p className="nsub">2 updates waiting for you</p>
        </div>
        <Button variant="quiet" size="sm">
          Mark All Read
        </Button>
      </div>
      <ul className="nlist">
        <li className="nrow unread" data-tone="bad">
          <span className="nicon">
            <icons.AlertIcon />
          </span>
          <span className="nbody">
            <span className="ntitle">Claude Is Almost Out of Its Weekly Limit</span>
            <span className="ndesc">91% used. Resets in 52 min.</span>
          </span>
          <span className="ntime">12 min</span>
        </li>
        <li className="nrow unread" data-tone="warn">
          <span className="nicon">
            <icons.ClockIcon />
          </span>
          <span className="nbody">
            <span className="ntitle">Claude Weekly Limit Is Running Low</span>
            <span className="ndesc">78% used. Resets in 52 min.</span>
          </span>
          <span className="ntime">12 min</span>
        </li>
        <li className="nrow" data-tone="info">
          <span className="nicon">
            <icons.ResetIcon />
          </span>
          <span className="nbody">
            <span className="ntitle">A Codex Reset Expires in 3 Days</span>
            <span className="ndesc">1 of 3 banked full resets expires Oct 5.</span>
          </span>
          <span className="ntime">1 h</span>
        </li>
      </ul>
      <div className="nfoot">
        <span className="muted">1 read</span>
        <Button variant="quiet" size="sm">
          Clear Read
        </Button>
      </div>
    </Popover>
  );
}

function rowMenu(name: string) {
  return (
    <Menu
      variant="row"
      label={`More actions for ${name}`}
      trigger={<icons.DotsIcon />}
      triggerClassName="btn quiet sm kebab"
    >
      <MenuItem icon={<icons.PauseIcon />} onSelect={() => undefined}>
        Pause
      </MenuItem>
      <MenuItem icon={<icons.UnplugIcon />} onSelect={() => undefined}>
        Reconnect
      </MenuItem>
      <MenuItem icon={<icons.PencilIcon />} onSelect={() => undefined}>
        Rename
      </MenuItem>
      <MenuItem icon={<icons.CloseIcon />} danger onSelect={() => undefined}>
        Disconnect
      </MenuItem>
    </Menu>
  );
}

/** Every primitive in every state. Development only; reach it at #/dev/ui. */
function GalleryFields(props: { readonly onOpenDialog: () => void }) {
  const [account, setAccount] = useState<string | null>(null);
  const [toolbar, setToolbar] = useState<string | null>("claude-1");
  const [usd, setUsd] = useState<{ minor: number | null; currency: MoneyCurrency }>({
    minor: 123456,
    currency: "USD",
  });
  const [inr, setInr] = useState<{ minor: number | null; currency: MoneyCurrency }>({
    minor: 123456789,
    currency: "INR",
  });
  const [eur, setEur] = useState<{ minor: number | null; currency: MoneyCurrency }>({
    minor: null,
    currency: "EUR",
  });
  const [gbp, setGbp] = useState<{ minor: number | null; currency: MoneyCurrency }>({
    minor: 4500,
    currency: "GBP",
  });
  const [jpy, setJpy] = useState<{ minor: number | null; currency: MoneyCurrency }>({
    minor: 15000,
    currency: "JPY",
  });
  const [lockedMinor, setLockedMinor] = useState<number | null>(2000);
  const [date, setDate] = useState<string | null>(null);
  const [required, setRequired] = useState<string | null>("2026-10-20");
  const [list, setList] = useState("monthly");
  const [grid, setGrid] = useState("yearly");
  return (
    <>
      <Section title="Select">
        <div className="dl-form" style={{ maxWidth: 420 }}>
          <Select
            label="Account"
            value={account}
            options={accountOptions}
            onChange={setAccount}
            placeholder="Choose an account"
          />
          <Select
            label="Account (with error)"
            value={null}
            options={cadenceOptions}
            onChange={setAccount}
            error="Choose one."
          />
          <Row>
            <Select
              label="Account"
              hideLabel
              size="sm"
              value={toolbar}
              options={accountOptions}
              onChange={setToolbar}
            />
            <Select
              label="Cadence"
              hideLabel
              size="sm"
              value={null}
              options={cadenceOptions}
              onChange={setToolbar}
              placeholder="Cadence"
            />
          </Row>
        </div>
      </Section>

      <Section title="Money Input">
        <div className="dl-form" style={{ maxWidth: 420 }}>
          <MoneyInput
            label="USD"
            minor={usd.minor}
            currency={usd.currency}
            currencies={moneyCurrencies}
            onChange={setUsd}
          />
          <MoneyInput
            label="INR (lakh grouping)"
            minor={inr.minor}
            currency={inr.currency}
            currencies={moneyCurrencies}
            onChange={setInr}
          />
          <MoneyInput
            label="EUR (empty)"
            minor={eur.minor}
            currency={eur.currency}
            currencies={moneyCurrencies}
            onChange={setEur}
            hint="Paste 1,999.50 or $20."
          />
          <MoneyInput
            label="GBP (with error)"
            minor={gbp.minor}
            currency={gbp.currency}
            currencies={moneyCurrencies}
            onChange={setGbp}
            error="Enter a smaller amount."
          />
          <MoneyInput
            label="JPY (no decimals)"
            minor={jpy.minor}
            currency={jpy.currency}
            currencies={moneyCurrencies}
            onChange={setJpy}
          />
          <MoneyInput
            label="One currency (static)"
            minor={lockedMinor}
            currency="USD"
            currencies={["USD"]}
            onChange={(next) => setLockedMinor(next.minor)}
          />
          <p className="muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
            USD minor: {usd.minor ?? "null"} · INR minor: {inr.minor ?? "null"} · JPY minor:{" "}
            {jpy.minor ?? "null"}
          </p>
        </div>
      </Section>

      <Section title="Date Picker">
        <div className="dl-form" style={{ maxWidth: 420 }}>
          <DatePicker
            label="Renews on (optional, min Oct 1 2026)"
            value={date}
            onChange={setDate}
            optional
            min="2026-10-01"
          />
          <DatePicker
            label="Due date (min, max, error)"
            value={required}
            onChange={setRequired}
            min="2026-10-05"
            max="2026-12-20"
            error="Pick a date in range."
          />
        </div>
      </Section>

      <Section title="Radio Cards">
        <div className="dl-form" style={{ maxWidth: 520 }}>
          <RadioCards label="Plan (list)" value={list} options={planCards} onChange={setList} />
          <RadioCards
            label="Plan (grid)"
            layout="grid"
            value={grid}
            options={planCardsWithIcons}
            onChange={setGrid}
          />
        </div>
      </Section>

      <Section title="Fields in a Dialog">
        <Row>
          <Button onClick={props.onOpenDialog}>Open Form Dialog</Button>
        </Row>
      </Section>
    </>
  );
}

export function Gallery() {
  const [scheme, setScheme] = useState<Scheme>("system");
  const [privacy, setPrivacy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusIndex, setStatusIndex] = useState(0);
  const [count, setCount] = useState(61068);
  const [dialog, setDialog] = useState<"none" | "plain" | "settings" | "fields">("none");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [segment, setSegment] = useState("used");
  const now = useNow();
  const [on, setOn] = useState(true);
  useEffect(() => {
    document.documentElement.style.colorScheme = scheme === "system" ? "" : scheme;
  }, [scheme]);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-privacy", privacy);
  }, [privacy]);
  useEffect(() => {
    document.documentElement.dataset["density"] = density;
  }, [density]);

  const status = statusKinds[statusIndex] ?? "active";

  return (
    <div className="page">
      <header className="top">
        <Lockup />
        <nav aria-label="Page">
          <ButtonLink variant="primary" icon={<icons.PlusIcon />} href="#/dev/ui">
            Connect an Account
          </ButtonLink>
          <Notifications />
          <AccountMenu
            scheme={scheme}
            onScheme={setScheme}
            hide={privacy}
            onHide={setPrivacy}
            onSettings={() => setDialog("settings")}
          />
        </nav>
      </header>

      <div className="intro">
        <h1>UI Gallery</h1>
        <p>Every primitive in every state. Switch appearance and density from the menu above.</p>
      </div>

      <Section title="Panel Composition">
        <section className="panel">
          <header>
            <div className="titles">
              <h3>
                <span className="name">Personal</span>
                <span className="plan">
                  <span className="sep" aria-hidden="true">
                    ·
                  </span>
                  Max
                </span>
                <button className="rename" type="button" aria-label="Rename this account">
                  <icons.PencilIcon />
                </button>
              </h3>
              <div className="ident">
                <span className="who">maverick@example.com</span>
              </div>
            </div>
            <div className="right">
              <StatusSlot statusKey={status}>
                {status === "active" ? (
                  <HealthyStatus age="12 min ago" />
                ) : (
                  <StatusPill kind={status} />
                )}
              </StatusSlot>
            </div>
          </header>
          <div className="cells">
            <Meter label="Session" window="5 hours" percent={49} caption="Resets in 1 h 12 min" />
            <Meter label="Weekly" window="all models" percent={78} caption="Resets in 52 min" />
            <Meter label="Weekly" window="Fable" percent={91} caption="Resets in 52 min" />
          </div>
          <div className="facts">
            <span className="lead">
              <HoldButton size="sm" label="Hold to Reset Limits" onConfirm={succeed("ok")} />
            </span>
            <span className="acts">
              <Button variant="quiet" size="sm" icon={<icons.PauseIcon />}>
                Pause
              </Button>
              <Button variant="quiet" size="sm" icon={<icons.RetryIcon />}>
                Refresh
              </Button>
              <Button variant="quiet-danger" size="sm">
                Disconnect
              </Button>
            </span>
          </div>
        </section>
      </Section>

      <Section title="Buttons">
        <Row>
          <Button>Default</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="quiet-danger">Quiet Danger</Button>
          <Button disabled>Disabled</Button>
        </Row>
        <Row>
          <Button size="sm">Small</Button>
          <Button size="sm" variant="primary" icon={<icons.UnplugIcon />}>
            Reconnect
          </Button>
          <Button size="sm" variant="quiet" icon={<icons.RetryIcon />}>
            Refresh
          </Button>
          <Button icon={<icons.ExternalIcon />}>Open the Sign-in Page</Button>
          <ButtonLink href="#/dev/ui">Link as Button</ButtonLink>
        </Row>
        <Row>
          <Button
            variant="quiet"
            size="sm"
            icon={<icons.RetryIcon />}
            busy={busy}
            busyLabel="Refreshing"
            onClick={() => {
              setBusy(true);
              setTimeout(() => setBusy(false), 1800);
            }}
          >
            Refresh
          </Button>
          <Button busy busyLabel="Disconnecting" variant="quiet-danger" size="sm">
            Disconnect
          </Button>
          <Button variant="primary" busy busyLabel="Connecting">
            Connect
          </Button>
        </Row>
      </Section>

      <Section title="Status">
        <Row>
          {statusKinds.map((kind) => (
            <StatusPill key={kind} kind={kind} />
          ))}
        </Row>
        <Row>
          <Pill tone="good" icon={<span className="dot" />}>
            Active
          </Pill>
          <Pill>Default</Pill>
          <Pill tone="neutral">Neutral</Pill>
          <Pill tone="warn" icon={<icons.ClockIcon />}>
            Warn
          </Pill>
          <Pill tone="bad" icon={<icons.AlertIcon />}>
            Bad
          </Pill>
          <Pill tone="quiet" icon={<icons.PauseIcon />}>
            Quiet
          </Pill>
          <span className="chip">2 Accounts</span>
        </Row>
        <Row>
          <HealthyStatus age="2 min ago" />
          <Button size="sm" onClick={() => setStatusIndex((statusIndex + 1) % statusKinds.length)}>
            Cycle the Panel Status
          </Button>
        </Row>
      </Section>

      <Section title="Bars">
        <div className="cells">
          {tones.map((tone, index) => (
            <div className="cell" key={tone}>
              <div className="label">{tone}</div>
              <Bar percent={[20, 74, 94, 55][index] ?? 0} tone={tone} label={`${tone} bar`} />
              <Bar
                thin
                percent={[20, 74, 94, 55][index] ?? 0}
                tone={tone}
                label={`${tone} thin bar`}
              />
            </div>
          ))}
          <div className="cell">
            <div className="label">Unknown</div>
            <Bar unknown label="Weekly usage not reported" />
          </div>
          <div className="cell">
            <div className="label">Over the Limit</div>
            <Bar percent={100} tone="bad" limit={89} label="Weekly usage 112%, over the limit" />
          </div>
          <div className="cell">
            <div className="label">Zero</div>
            <Bar percent={0} tone="good" label="Nothing used" />
          </div>
        </div>
      </Section>

      <Section title="Numbers">
        <Row>
          <span className="cell value">
            <CountUp value={count} />
            <span className="unit">credits</span>
          </span>
          <span className="cell value">
            <CountUp value={4.99} decimals={2} prefix="$" />
          </span>
          <Button size="sm" onClick={() => setCount(count === 61068 ? 1204 : 61068)}>
            Change the Number
          </Button>
        </Row>
      </Section>

      <Section title="Menus, Popover and Info">
        <Row>
          <span className="secondary">Account menu and bell are in the top bar.</span>
          <span className="secondary">Row menu:</span>
          {rowMenu("Personal")}
          <span className="secondary">
            Reset credits
            <InfoTip label="All reset expiry times">
              <b>Banked Resets</b>
              <span>Reset 1 · expires Sunday, Oct 5 at 06:25</span>
              <span>Reset 2 · expires Wed, Oct 22 at 14:39</span>
            </InfoTip>
          </span>
        </Row>
      </Section>

      <Section title="Banked Resets">
        <Row>
          <BankedResets count={1} label="Reset Grant" expiries={[now + 3 * 86_400_000]} />
          <BankedResets
            count={3}
            label="Reset Grant"
            expiries={[now + 3 * 86_400_000, now + 9 * 86_400_000, now + 20 * 86_400_000]}
          />
          <BankedResets count={0} label="Reset Grant" expiries={[]} />
        </Row>
      </Section>

      <Section title="Segmented and Switch">
        <Row>
          <Segmented
            label="Show limits as"
            value={segment}
            onChange={setSegment}
            options={[
              { value: "used", label: "Used" },
              { value: "left", label: "Left" },
            ]}
          />
          <Segmented
            label="Density"
            value={density}
            onChange={setDensity}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
          <Switch label="Example switch" checked={on} onChange={setOn} />
          <Switch label="Off switch" checked={false} onChange={() => undefined} />
          <Switch label="Disabled switch" checked disabled onChange={() => undefined} />
        </Row>
      </Section>

      <Section title="Hold to Confirm">
        <Row>
          <HoldButton label="Hold to Reset Limits" onConfirm={succeed("ok")} />
          <HoldButton label="Hold to Reset Limits" onConfirm={succeed("failed")} />
          <HoldButton label="Hold to Reset Limits" off onConfirm={succeed("ok")} />
        </Row>
        <Row>
          {holdPhases.map((phase) => (
            <HoldButton
              key={phase}
              label="Hold to Reset Limits"
              preview={{ phase, progress: phase === "holding" ? 42 : undefined }}
              onConfirm={succeed("ok")}
            />
          ))}
          <HoldButton
            label="Hold to Reset Limits"
            off
            preview={{ phase: "idle" }}
            onConfirm={succeed("ok")}
          />
        </Row>
      </Section>

      <Section title="Dialog">
        <Row>
          <Button onClick={() => setDialog("plain")}>Open Dialog</Button>
          <Button onClick={() => setDialog("settings")}>Open Settings Dialog</Button>
        </Row>
      </Section>

      <GalleryFields onOpenDialog={() => setDialog("fields")} />

      <Section title="Brand Marks and Avatar">
        <Row>
          {providers.map((provider: Provider) => (
            <span key={provider} className="row">
              <BrandMark provider={provider} />
              <BrandMark provider={provider} size={24} />
            </span>
          ))}
          <span className="avatar">
            <Avatar />
          </span>
          <Spinner />
        </Row>
      </Section>

      <Section title="Icons">
        <Row>
          {iconList.map(([name, Icon]) => (
            <span key={name} title={name} style={{ display: "inline-grid", width: 20 }}>
              <Icon />
            </span>
          ))}
        </Row>
      </Section>

      <Dialog open={dialog === "fields"} onClose={() => setDialog("none")} title="Form Fields">
        <section className="dsec">
          <FieldSet prefix="dialog" />
        </section>
      </Dialog>
      <Dialog open={dialog === "plain"} onClose={() => setDialog("none")} title="Account">
        <section className="dsec">
          <div className="dsec-head">
            <h3>Passkeys</h3>
            <Button size="sm" icon={<icons.PlusIcon />}>
              Add Passkey
            </Button>
          </div>
          <ul className="plist">
            <li>
              <span className="pk">
                <icons.FingerprintIcon />
              </span>
              <span className="pbody">
                <b>MacBook Touch ID</b>
                <span className="muted">Added Sep 28 · Last used today</span>
              </span>
              <Button variant="quiet-danger" size="sm">
                Remove
              </Button>
            </li>
          </ul>
        </section>
      </Dialog>
      <Dialog
        open={dialog === "settings"}
        onClose={() => setDialog("none")}
        title="Settings"
        variant="settings"
      >
        <section className="dsec">
          <div className="dsec-head">
            <h3>Limits</h3>
          </div>
          <div className="srow">
            <span className="sbody">
              <b>Show Limits As</b>
              <span className="muted">Used shows how much is spent. Left shows what remains.</span>
            </span>
            <Segmented
              label="Show limits as"
              value={segment}
              onChange={setSegment}
              options={[
                { value: "used", label: "Used" },
                { value: "left", label: "Left" },
              ]}
            />
          </div>
        </section>
        <section className="dsec">
          <div className="dsec-head">
            <h3>Notifications</h3>
          </div>
          <label className="srow" htmlFor="g-low">
            <span className="sbody">
              <b>Running Low</b>
              <span className="muted">When an account is running low.</span>
            </span>
            <Switch id="g-low" checked={on} onChange={setOn} />
          </label>
          <label className="srow" htmlFor="g-fail">
            <span className="sbody">
              <b>Refresh Failures</b>
              <span className="muted">When Headroom cannot refresh an account.</span>
            </span>
            <Switch id="g-fail" checked={false} onChange={() => undefined} />
          </label>
        </section>
      </Dialog>
    </div>
  );
}
