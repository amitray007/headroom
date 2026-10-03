import { useState, type FormEvent } from "react";

import type { Provider } from "@headroom/core/contracts";
import { accountName, groupByProvider, planLabel, providerName } from "@headroom/view-model/labels";
import type { OverviewConnection } from "@headroom/view-model/overview";
import { currencies, type Currency, type TopUp } from "@headroom/view-model/wallet";

import { TextField } from "../../shell/delivery/form-parts.tsx";
import { Button } from "../../ui/button.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { Segmented } from "../../ui/segmented.tsx";
import { newId, parseAmount, parsePositive } from "./book.ts";
import { DateField, SelectField } from "./fields.tsx";
import { effectivePrivacy, useDevicePrefs } from "../../lib/device-prefs.ts";

/**
 * Option labels for one provider's accounts. Two accounts with the same name and plan get the email, or a number
 * while Privacy Mode is on, because an option cannot blur its text.
 */
function optionLabels(
  connections: readonly OverviewConnection[],
  hidden: boolean,
): ReadonlyMap<string, string> {
  const base = connections.map((connection) =>
    [accountName(connection), planLabel(connection.plan)]
      .filter((part) => part !== null)
      .join(" · "),
  );
  const labels = new Map<string, string>();
  connections.forEach((connection, index) => {
    const label = base[index] ?? "";
    const twins = base.filter((other) => other === label).length;
    if (twins < 2) labels.set(connection.id, label);
    else if (!hidden && connection.identity !== null) {
      labels.set(connection.id, `${label} · ${connection.identity}`);
    } else {
      const position = base.slice(0, index + 1).filter((other) => other === label).length;
      labels.set(connection.id, `${label} ${position}`);
    }
  });
  return labels;
}

const kinds = [
  { value: "paid", label: "Paid" },
  { value: "free", label: "Free" },
] as const;

function TopUpForm(props: {
  readonly connections: readonly OverviewConnection[];
  readonly providerOrder: readonly Provider[];
  readonly defaultCurrency: Currency;
  readonly today: string;
  readonly onAdd: (topUp: TopUp) => void;
  readonly onCancel: () => void;
}) {
  const groups = groupByProvider(props.connections, props.providerOrder);
  const prefs = useDevicePrefs();
  const hidden = effectivePrivacy(prefs.privacy, prefs.demo);
  const [connectionId, setConnectionId] = useState(groups[0]?.connections[0]?.id ?? "");
  const [date, setDate] = useState(props.today);
  const [kind, setKind] = useState<TopUp["kind"]>("paid");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>(props.defaultCurrency);
  const [credits, setCredits] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{
    readonly amount?: string;
    readonly credits?: string;
    readonly date?: string;
  }>({});

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const minor = kind === "paid" ? parseAmount(amount) : null;
    const added = credits.trim() === "" ? null : parsePositive(credits);
    const next: { amount?: string; credits?: string; date?: string } = {};
    if (kind === "paid" && minor === null) next.amount = "Enter an amount above zero, such as 25.";
    if (credits.trim() !== "" && added === null) next.credits = "Enter a number above zero.";
    if (date === "") next.date = "Pick a date.";
    setErrors(next);
    if (Object.keys(next).length > 0 || connectionId === "") return;
    props.onAdd({
      id: newId(),
      connectionId,
      date,
      kind,
      price: kind === "paid" && minor !== null ? { minor, currency } : null,
      credits: added,
      note: note.trim() === "" ? null : note.trim(),
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="dsec">
        <SelectField label="Account" value={connectionId} onChange={setConnectionId}>
          {groups.map((group) => {
            const labels = optionLabels(group.connections, hidden);
            return (
              <optgroup key={group.provider} label={providerName(group.provider)}>
                {group.connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {labels.get(connection.id)}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </SelectField>
        <DateField label="Date" value={date} onChange={setDate} required />
        {errors.date === undefined ? null : (
          <p className="w-note bad" role="alert">
            {errors.date}
          </p>
        )}
        <Segmented
          full
          label="Kind of top-up"
          value={kind}
          options={kinds}
          onChange={(next) => {
            setKind(next);
            setErrors({});
          }}
        />
        {kind === "paid" ? (
          <div className="w-pair">
            <TextField
              label="Amount"
              value={amount}
              inputMode="decimal"
              placeholder="0.00"
              error={errors.amount ?? null}
              onChange={(value) => {
                setAmount(value);
                setErrors({});
              }}
            />
            <SelectField
              label="Currency"
              value={currency}
              onChange={(value) => {
                const chosen = currencies.find((entry) => entry === value);
                if (chosen !== undefined) setCurrency(chosen);
              }}
            >
              {currencies.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </SelectField>
          </div>
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
      </div>
      <div className="w-foot">
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" type="submit">
          Add Top-Up
        </Button>
      </div>
    </form>
  );
}

/** Record credits bought or received. Closed unless `open`; the form mounts fresh each time it opens. */
export function TopUpDialog(props: {
  readonly open: boolean;
  readonly connections: readonly OverviewConnection[];
  readonly providerOrder: readonly Provider[];
  readonly defaultCurrency: Currency;
  /** Today as `YYYY-MM-DD`, the starting date. */
  readonly today: string;
  readonly onAdd: (topUp: TopUp) => void;
  readonly onClose: () => void;
}) {
  const { onClose } = props;
  return (
    <Dialog open={props.open} onClose={onClose} title="Add Top-Up">
      {props.open ? (
        <TopUpForm
          connections={props.connections}
          providerOrder={props.providerOrder}
          defaultCurrency={props.defaultCurrency}
          today={props.today}
          onAdd={(topUp) => {
            props.onAdd(topUp);
            onClose();
          }}
          onCancel={onClose}
        />
      ) : null}
    </Dialog>
  );
}
