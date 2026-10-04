import { useState, type FormEvent } from "react";

import type { TopUpInput, TopUpUpdate } from "../../api.ts";
import type { Provider } from "@headroom/core/contracts";
import { accountName, groupByProvider, planLabel, providerName } from "@headroom/view-model/labels";
import type { OverviewConnection } from "@headroom/view-model/overview";
import { currencies, parsePositive, type Currency } from "@headroom/view-model/wallet-money";
import { creditBalanceText, creditsOf, type TopUp } from "@headroom/view-model/wallet";
import { expiryAlertDayOptions } from "@headroom/core/contracts";

import { BrandMark } from "../../icons.tsx";
import { TextField } from "../../shell/delivery/form-parts.tsx";
import { Button } from "../../ui/button.tsx";
import { DatePicker } from "../../ui/date-picker.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { MoneyInput } from "../../ui/money-input.tsx";
import { RadioCards, type RadioCard } from "../../ui/radio-cards.tsx";
import { Segmented } from "../../ui/segmented.tsx";
import { Select, type SelectOption } from "../../ui/select.tsx";

const kinds: readonly RadioCard<TopUp["kind"]>[] = [
  { value: "paid", label: "Paid", description: "You bought these credits." },
  { value: "free", label: "Free", description: "Promo or bonus credits." },
];

/** The expiry alert as a segment value: "none" or the day count. */
type AlertChoice = "none" | `${(typeof expiryAlertDayOptions)[number]}`;
const alertOptions: readonly { readonly value: AlertChoice; readonly label: string }[] = [
  { value: "none", label: "None" },
  ...expiryAlertDayOptions.map((days) => ({ value: `${days}` as const, label: `${days} Days` })),
];

function alertChoiceOf(days: TopUp["expiryAlertDays"]): AlertChoice {
  return days === null ? "none" : `${days}`;
}

function alertDaysOf(choice: AlertChoice): TopUp["expiryAlertDays"] {
  return expiryAlertDayOptions.find((days) => `${days}` === choice) ?? null;
}

/** One option per account: its provider's mark, name, plan and email (blurred in Privacy Mode), under the provider. */
function accountOptions(
  connections: readonly OverviewConnection[],
  providerOrder: readonly Provider[],
): readonly SelectOption<string>[] {
  return groupByProvider(connections, providerOrder).flatMap((group) =>
    group.connections.map((connection): SelectOption<string> => {
      const plan = planLabel(connection.plan);
      return {
        value: connection.id,
        label: accountName(connection),
        icon: <BrandMark provider={connection.provider} />,
        group: providerName(group.provider),
        ...(plan === null ? {} : { meta: plan }),
        ...(connection.identity === null ? {} : { detail: connection.identity }),
      };
    }),
  );
}

function TopUpForm(props: {
  readonly connections: readonly OverviewConnection[];
  readonly providerOrder: readonly Provider[];
  readonly connectionId: string | null;
  readonly defaultCurrency: Currency;
  readonly today: string;
  /** The top-up being edited, or null to add a new one. */
  readonly editing: TopUp | null;
  readonly onAdd: (topUp: TopUpInput) => Promise<void>;
  readonly onSave: (id: string, update: TopUpUpdate) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const { editing } = props;
  const options = accountOptions(props.connections, props.providerOrder);
  const [connectionId, setConnectionId] = useState(
    editing?.connectionId ?? props.connectionId ?? options[0]?.value ?? "",
  );
  const [date, setDate] = useState<string | null>(editing?.date ?? props.today);
  const [kind, setKind] = useState<TopUp["kind"]>(editing?.kind ?? "paid");
  const [price, setPrice] = useState<{ minor: number | null; currency: Currency }>({
    minor: editing?.price?.minor ?? null,
    currency: editing?.price?.currency ?? props.defaultCurrency,
  });
  const [credits, setCredits] = useState(
    editing?.credits === null || editing === null ? "" : String(editing.credits),
  );
  const [note, setNote] = useState(editing?.note ?? "");
  const [expiresOn, setExpiresOn] = useState<string | null>(editing?.expiresOn ?? null);
  const [alert, setAlert] = useState<AlertChoice>(alertChoiceOf(editing?.expiryAlertDays ?? null));
  // Headroom found this top-up from a balance change, so its price may stay empty until the owner knows it.
  const priceOptional = editing?.source === "detected";
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [errors, setErrors] = useState<{
    readonly amount?: string;
    readonly credits?: string;
    readonly date?: string;
    readonly expiry?: string;
  }>({});

  // A top-up adds to the balance the account holds, so show it. Unknown stays unsaid, never zero.
  const chosen = props.connections.find((connection) => connection.id === connectionId);
  const balance = chosen === undefined ? null : (creditsOf(chosen)?.balance ?? null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const added = credits.trim() === "" ? null : parsePositive(credits);
    const next: { amount?: string; credits?: string; date?: string; expiry?: string } = {};
    const priced = price.minor !== null && price.minor > 0;
    if (kind === "paid" && !priced && !(priceOptional && price.minor === null)) {
      next.amount = "Enter an amount above zero.";
    }
    if (credits.trim() !== "" && added === null) next.credits = "Enter a number above zero.";
    if (date === null) next.date = "Pick a date.";
    if (date !== null && expiresOn !== null && expiresOn < date) {
      next.expiry = "Pick a day on or after the top-up date.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || connectionId === "" || date === null) return;
    if (pending) return;
    setPending(true);
    setFailed(false);
    const update: TopUpUpdate = {
      date,
      kind,
      price:
        kind === "paid" && price.minor !== null
          ? { minor: price.minor, currency: price.currency }
          : null,
      credits: added,
      note: note.trim() === "" ? null : note.trim(),
      expiresOn,
      // An alert needs an expiry day to count from.
      expiryAlertDays: expiresOn === null ? null : alertDaysOf(alert),
    };
    (editing === null
      ? props.onAdd({ connectionId, ...update })
      : props.onSave(editing.id, update)
    ).catch(() => {
      setPending(false);
      setFailed(true);
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="dsec">
        {editing === null ? (
          <Select
            label="Account"
            value={connectionId === "" ? null : connectionId}
            options={options}
            onChange={setConnectionId}
          />
        ) : (
          <p className="w-desc">
            {chosen === undefined
              ? "Removed account"
              : `${providerName(chosen.provider)} · ${accountName(chosen)}`}
            {editing.source === "detected" ? (
              <span className="muted"> · Detected automatically from a balance change.</span>
            ) : null}
          </p>
        )}
        {balance === null ? null : (
          <p className="w-balance muted">Balance: {creditBalanceText(balance)}</p>
        )}
        <DatePicker
          label="Date"
          value={date}
          error={errors.date ?? null}
          onChange={(next) => {
            setDate(next);
            setErrors({});
          }}
        />
        <RadioCards
          label="Kind of top-up"
          hideLabel
          layout="grid"
          value={kind}
          options={kinds}
          onChange={(next) => {
            setKind(next);
            setErrors({});
          }}
        />
        {kind === "paid" ? (
          <MoneyInput
            label="Amount"
            minor={price.minor}
            currency={price.currency}
            currencies={currencies}
            error={errors.amount ?? null}
            {...(priceOptional ? { hint: "Leave empty until you know the price." } : {})}
            onChange={(next) => {
              setPrice(next);
              setErrors({});
            }}
          />
        ) : null}
        <TextField
          label="Credits Added (Optional)"
          value={credits}
          inputMode="decimal"
          error={errors.credits ?? null}
          onChange={(value) => {
            setCredits(value);
            setErrors({});
          }}
        />
        <TextField label="Note (Optional)" value={note} onChange={setNote} />
        <DatePicker
          label="Expires On (Optional)"
          optional
          value={expiresOn}
          {...(date === null ? {} : { min: date })}
          error={errors.expiry ?? null}
          onChange={(next) => {
            setExpiresOn(next);
            if (next === null) setAlert("none");
            setErrors({});
          }}
        />
        <div className="field fld">
          <span className="fld-label">Alert Before Expiry</span>
          <Segmented
            full
            label="Alert before expiry"
            value={expiresOn === null ? "none" : alert}
            options={alertOptions}
            disabled={expiresOn === null}
            onChange={setAlert}
          />
        </div>
      </div>
      {failed ? (
        <p className="w-save-error" role="alert">
          Could not save. Nothing was changed.
        </p>
      ) : null}
      <div className="w-foot">
        <Button disabled={pending} onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          busy={pending}
          busyLabel={editing === null ? "Adding" : "Saving"}
        >
          {editing === null ? "Add Top-Up" : "Save Top-Up"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Record credits bought or received, or edit a recorded top-up. Closed unless `open`; the form mounts fresh each
 * time it opens, with `connectionId` chosen when the owner started from an account.
 */
export function TopUpDialog(props: {
  readonly open: boolean;
  readonly connections: readonly OverviewConnection[];
  readonly providerOrder: readonly Provider[];
  /** The account to start on, or null for the first. */
  readonly connectionId: string | null;
  /** The display currency, the starting choice for a paid top-up. */
  readonly defaultCurrency: Currency;
  /** Today as `YYYY-MM-DD`, the starting date. */
  readonly today: string;
  /** The top-up to edit, or null to add a new one. */
  readonly editing: TopUp | null;
  readonly onAdd: (topUp: TopUpInput) => Promise<void>;
  readonly onSave: (id: string, update: TopUpUpdate) => Promise<void>;
  readonly onClose: () => void;
}) {
  const { onClose } = props;
  return (
    <Dialog
      open={props.open}
      onClose={onClose}
      title={props.editing === null ? "Add Top-Up" : "Edit Top-Up"}
    >
      {props.open ? (
        <TopUpForm
          connections={props.connections}
          providerOrder={props.providerOrder}
          connectionId={props.connectionId}
          defaultCurrency={props.defaultCurrency}
          today={props.today}
          editing={props.editing}
          onAdd={(topUp) => props.onAdd(topUp).then(onClose)}
          onSave={(id, update) => props.onSave(id, update).then(onClose)}
          onCancel={onClose}
        />
      ) : null}
    </Dialog>
  );
}
