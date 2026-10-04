import { useContext, useRef, useState } from "react";

import {
  autoResetMinHoursLeft,
  autoResetThresholds,
  defaultAutoResetRule,
  type AutoResetRule,
} from "@headroom/core/contracts";
import { autoResetAccounts, spendRows, type SpendRow } from "@headroom/view-model/automation";
import { accountName, planLabel, providerName } from "@headroom/view-model/labels";
import type { OverviewConnection } from "@headroom/view-model/overview";
import { formatNumber, formatUsd } from "@headroom/view-model/present";
import { parsePositive } from "@headroom/view-model/wallet-money";

import { ApiError, api, demoRefusal, isDemoRefusal } from "../api.ts";
import { BrandMark } from "../icons.tsx";
import { useSettings } from "../lib/settings.tsx";
import { Button } from "../ui/button.tsx";
import { MoneyInput } from "../ui/money-input.tsx";
import { Select, type SelectOption } from "../ui/select.tsx";
import { Sk } from "../ui/skeleton.tsx";
import { Switch } from "../ui/switch.tsx";
import { TextField } from "./delivery/form-parts.tsx";
import { Section, WaitingContext } from "./settings-rows.tsx";
import "./automations.css";

/** What a failed save says. A refused demo call says why; anything else keeps the old setting. */
function failureText(cause: unknown): string {
  if (isDemoRefusal(cause)) return demoRefusal;
  if (cause instanceof ApiError && cause.code === "unsupported_action") {
    return "This account cannot use a banked reset.";
  }
  if (cause instanceof ApiError && cause.code === "not_a_spend_metric") {
    return "Budgets work on spend figures only.";
  }
  return "Could not save. Nothing was changed.";
}

/** Who a row is about: the provider mark, the account's name, and its plan and email under it. */
function AccountLabel(props: {
  readonly connection: OverviewConnection;
  /** Replaces the plan and email line, such as a spend figure's current value. */
  readonly detail?: string;
  readonly title?: string;
}) {
  const { connection } = props;
  const plan = planLabel(connection.plan);
  return (
    <span className="sbody auto-who">
      <b>
        <BrandMark provider={connection.provider} />
        <span>{props.title ?? accountName(connection)}</span>
      </b>
      <span className="muted">
        {providerName(connection.provider)}
        {plan === null ? null : ` · ${plan}`}
        {connection.identity === null ? null : (
          <>
            {" · "}
            <span className="who">{connection.identity}</span>
          </>
        )}
        {props.detail === undefined ? null : ` · ${props.detail}`}
      </span>
    </span>
  );
}

// ---------- Auto-Reset ----------

type Window = AutoResetRule["window"];
const windowOptions: readonly SelectOption<Window>[] = [
  { value: "weekly", label: "Weekly" },
  { value: "session", label: "5-Hour" },
  { value: "either", label: "Either" },
];
const thresholdOptions: readonly SelectOption<`${AutoResetRule["thresholdPercent"]}`>[] =
  autoResetThresholds.map((value) => ({ value: `${value}`, label: `${value}% Used` }));
const hoursOptions: readonly SelectOption<`${AutoResetRule["minHoursLeft"]}`>[] =
  autoResetMinHoursLeft.map((value) => ({
    value: `${value}`,
    label: value === 1 ? "1 hour" : `${value} hours`,
  }));

/**
 * One account's rule: a switch, and the three choices that say when it fires. The choices can be set before the
 * rule is switched on, so it never fires with settings the owner has not seen. A change shows at once and is saved
 * in order; a refused change goes back to what the server holds.
 */
function AutoResetRow(props: {
  readonly connection: OverviewConnection;
  readonly onChanged: () => Promise<void>;
}) {
  const { connection, onChanged } = props;
  const saved = connection.automation.autoReset ?? defaultAutoResetRule;
  const [draft, setDraft] = useState<AutoResetRule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(0);
  const rule = draft ?? saved;
  const save = (patch: Partial<AutoResetRule>): void => {
    const next = { ...rule, ...patch };
    const mine = ++latest.current;
    setDraft(next);
    setError(null);
    const send = async (): Promise<void> => {
      try {
        await api.setAutoReset(connection.id, next);
        await onChanged();
      } catch (cause) {
        setError(failureText(cause));
      }
      if (latest.current === mine) setDraft(null);
    };
    chain.current = chain.current.then(send);
  };
  const name = accountName(connection);
  return (
    <div className="auto-row" data-on={rule.enabled ? "" : undefined}>
      {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the Switch component renders the input */}
      <label className="srow">
        <AccountLabel connection={connection} />
        <Switch
          checked={rule.enabled}
          label={`Auto-reset for ${name}`}
          onChange={(enabled) => save({ enabled })}
        />
      </label>
      <div className="auto-opts">
        <Select
          label="Window"
          size="sm"
          value={rule.window}
          options={windowOptions}
          onChange={(window) => save({ window })}
        />
        <Select
          label="Fire At"
          size="sm"
          value={`${rule.thresholdPercent}` as const}
          options={thresholdOptions}
          onChange={(value) => {
            const thresholdPercent = autoResetThresholds.find((item) => `${item}` === value);
            if (thresholdPercent !== undefined) save({ thresholdPercent });
          }}
        />
        <Select
          label="Skip If It Resets Within"
          size="sm"
          value={`${rule.minHoursLeft}` as const}
          options={hoursOptions}
          onChange={(value) => {
            const minHoursLeft = autoResetMinHoursLeft.find((item) => `${item}` === value);
            if (minHoursLeft !== undefined) save({ minHoursLeft });
          }}
        />
      </div>
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function AutoResetSection(props: {
  readonly connections: readonly OverviewConnection[];
  readonly onChanged: () => Promise<void>;
}) {
  const { settings } = useSettings();
  const waiting = useContext(WaitingContext);
  const accounts = autoResetAccounts(props.connections);
  return (
    <Section title="Auto-Reset">
      <p className="auto-note muted">
        Uses the reset that expires first, once per window. Not yet validated, so the first try may
        fail.
      </p>
      {waiting || settings.accountActions ? null : (
        <output className="auto-hint">
          Allow Account Actions is off. Rules are saved but do not fire until you turn it on in
          General.
        </output>
      )}
      {accounts.length === 0 ? (
        <p className="auto-empty muted">No connected account can use a banked reset yet.</p>
      ) : (
        accounts.map((connection) => (
          <AutoResetRow key={connection.id} connection={connection} onChanged={props.onChanged} />
        ))
      )}
    </Section>
  );
}

// ---------- Budgets ----------

function spendText(row: SpendRow): string {
  if (row.value === null) return "Spend unknown";
  return row.unit === "USD"
    ? `Spent ${formatUsd(row.value)}`
    : `Used ${formatNumber(row.value, Number.isInteger(row.value) ? 0 : 2)} ${row.value === 1 ? "credit" : "credits"}`;
}

const dollars = ["USD"] as const;

/** One spend figure's budget: an amount in its own unit, saved on request, cleared with one press. */
function BudgetRow(props: { readonly row: SpendRow; readonly onChanged: () => Promise<void> }) {
  const { row, onChanged } = props;
  const savedAmount = row.budget?.amount ?? null;
  const [minor, setMinor] = useState<number | null>(
    savedAmount === null ? null : Math.round(savedAmount * 100),
  );
  const [text, setText] = useState(savedAmount === null ? "" : String(savedAmount));
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usd = row.unit === "USD";
  const amount = usd ? (minor === null ? null : minor / 100) : parsePositive(text);
  const valid = amount !== null && amount > 0;
  const dirty = valid && amount !== savedAmount;
  const invalidText = !usd && text.trim() !== "" && amount === null;
  const run = async (kind: "save" | "clear"): Promise<void> => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "clear") {
        await api.clearBudget(row.connection.id, row.metricKey);
        setMinor(null);
        setText("");
      } else if (amount !== null) {
        await api.setBudget(row.connection.id, row.metricKey, amount);
      }
      await onChanged();
    } catch (cause) {
      setError(failureText(cause));
    }
    setBusy(null);
  };
  return (
    <div className="auto-row">
      <div className="srow auto-budget-head">
        <AccountLabel
          connection={row.connection}
          title={`${accountName(row.connection)} · ${row.label}`}
          detail={spendText(row)}
        />
      </div>
      <div className="auto-budget">
        {usd ? (
          <MoneyInput
            label="Budget"
            minor={minor}
            currency="USD"
            currencies={dollars}
            onChange={(next) => setMinor(next.minor)}
          />
        ) : (
          <TextField
            label="Budget (Credits)"
            value={text}
            inputMode="decimal"
            error={invalidText ? "Enter a number above zero." : null}
            onChange={setText}
          />
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={!dirty || busy !== null}
          busy={busy === "save"}
          busyLabel="Saving"
          onClick={() => void run("save")}
        >
          Set Budget
        </Button>
        {row.budget === null ? null : (
          <Button
            variant="quiet"
            size="sm"
            disabled={busy !== null}
            busy={busy === "clear"}
            busyLabel="Clearing"
            onClick={() => void run("clear")}
          >
            Clear
          </Button>
        )}
      </div>
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function BudgetsSection(props: {
  readonly connections: readonly OverviewConnection[];
  readonly onChanged: () => Promise<void>;
}) {
  const rows = spendRows(props.connections);
  return (
    <Section title="Budgets">
      <p className="auto-note muted">
        Your own limit on a spend figure. You get a notice when spend nears it, using the Running
        Low setting, and again when it passes.
      </p>
      {rows.length === 0 ? (
        <p className="auto-empty muted">No connected account reports spend yet.</p>
      ) : (
        rows.map((row) => (
          <BudgetRow
            // A saved change brings a new budget: start the inputs from it.
            key={`${row.connection.id}:${row.metricKey}:${row.budget?.amount ?? "none"}`}
            row={row}
            onChanged={props.onChanged}
          />
        ))
      )}
    </Section>
  );
}

/** Placeholder rows while the overview loads. */
function AutomationsWaiting() {
  return (
    <Section>
      <Sk width="100%" height={56} className="sk-card-slot" />
    </Section>
  );
}

/** The Automations tab: auto-reset rules per account, and spend budgets. */
export function AutomationsTab(props: {
  readonly connections: readonly OverviewConnection[] | null;
  readonly onChanged: () => Promise<void>;
}) {
  if (props.connections === null) return <AutomationsWaiting />;
  return (
    <>
      <AutoResetSection connections={props.connections} onChanged={props.onChanged} />
      <BudgetsSection connections={props.connections} onChanged={props.onChanged} />
    </>
  );
}
