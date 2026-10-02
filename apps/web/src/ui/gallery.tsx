import { useEffect, useState, type ReactNode } from "react";

import { providers, type Provider } from "@headroom/core/contracts";

import * as icons from "../icons.tsx";
import { Avatar, BrandMark } from "../icons.tsx";
import { BankedResets } from "./banked-resets.tsx";
import { useNow } from "../lib/now.ts";
import { Bar, type BarTone } from "./bar.tsx";
import { Button, ButtonLink } from "./button.tsx";
import { CountUp } from "./count-up.tsx";
import { Dialog } from "./dialog.tsx";
import { HoldButton, type HoldPhase } from "./hold-button.tsx";
import { InfoTip } from "./info-tip.tsx";
import { Lockup } from "./lockup.tsx";
import { Menu, MenuBlock, MenuItem, MenuSwitch, MenuWho, Popover } from "./menu.tsx";
import { HealthyStatus, Pill, StatusPill, StatusSlot, type StatusKind } from "./pill.tsx";
import { Segmented } from "./segmented.tsx";
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
        Hide Details
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
export function Gallery() {
  const [scheme, setScheme] = useState<Scheme>("system");
  const [privacy, setPrivacy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusIndex, setStatusIndex] = useState(0);
  const [count, setCount] = useState(61068);
  const [dialog, setDialog] = useState<"none" | "plain" | "settings">("none");
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
              <HoldButton size="sm" label="Hold to Reset Weekly Limit" onConfirm={succeed("ok")} />
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
          <HoldButton label="Hold to Reset Weekly Limit" onConfirm={succeed("ok")} />
          <HoldButton label="Hold to Reset Weekly Limit" onConfirm={succeed("failed")} />
          <HoldButton label="Hold to Reset Weekly Limit" off onConfirm={succeed("ok")} />
        </Row>
        <Row>
          {holdPhases.map((phase) => (
            <HoldButton
              key={phase}
              label="Hold to Reset Weekly Limit"
              preview={{ phase, progress: phase === "holding" ? 42 : undefined }}
              onConfirm={succeed("ok")}
            />
          ))}
          <HoldButton
            label="Hold to Reset Weekly Limit"
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
