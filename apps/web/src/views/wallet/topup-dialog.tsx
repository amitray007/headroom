import { useState, type FormEvent } from "react";

import type { Provider } from "@headroom/core/contracts";
import { accountName, groupByProvider, planLabel, providerName } from "@headroom/view-model/labels";
import type { OverviewConnection } from "@headroom/view-model/overview";
import { currencies, parsePositive, type Currency } from "@headroom/view-model/wallet-money";
import type { TopUp } from "@headroom/view-model/wallet";

import { BrandMark } from "../../icons.tsx";
import { TextField } from "../../shell/delivery/form-parts.tsx";
import { Button } from "../../ui/button.tsx";
import { DatePicker } from "../../ui/date-picker.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { MoneyInput } from "../../ui/money-input.tsx";
import { RadioCards, type RadioCard } from "../../ui/radio-cards.tsx";
import { Select, type SelectOption } from "../../ui/select.tsx";
import { newId } from "./book.ts";

const kinds: readonly RadioCard<TopUp["kind"]>[] = [
  { value: "paid", label: "Paid", description: "You bought these credits." },
  { value: "free", label: "Free", description: "Promo or bonus credits." },
];

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
  readonly onAdd: (topUp: TopUp) => void;
  readonly onCancel: () => void;
}) {
  const options = accountOptions(props.connections, props.providerOrder);
  const [connectionId, setConnectionId] = useState(props.connectionId ?? options[0]?.value ?? "");
  const [date, setDate] = useState<string | null>(props.today);
  const [kind, setKind] = useState<TopUp["kind"]>("paid");
  const [price, setPrice] = useState<{ minor: number | null; currency: Currency }>({
    minor: null,
    currency: props.defaultCurrency,
  });
  const [credits, setCredits] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{
    readonly amount?: string;
    readonly credits?: string;
    readonly date?: string;
  }>({});

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const added = credits.trim() === "" ? null : parsePositive(credits);
    const next: { amount?: string; credits?: string; date?: string } = {};
    if (kind === "paid" && (price.minor === null || price.minor <= 0)) {
      next.amount = "Enter an amount above zero.";
    }
    if (credits.trim() !== "" && added === null) next.credits = "Enter a number above zero.";
    if (date === null) next.date = "Pick a date.";
    setErrors(next);
    if (Object.keys(next).length > 0 || connectionId === "" || date === null) return;
    props.onAdd({
      id: newId(),
      connectionId,
      date,
      kind,
      price:
        kind === "paid" && price.minor !== null
          ? { minor: price.minor, currency: price.currency }
          : null,
      credits: added,
      note: note.trim() === "" ? null : note.trim(),
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="dsec">
        <Select
          label="Account"
          value={connectionId === "" ? null : connectionId}
          options={options}
          onChange={setConnectionId}
        />
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

/**
 * Record credits bought or received. Closed unless `open`; the form mounts fresh each time it opens, with
 * `connectionId` chosen when the owner started from an account.
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
          connectionId={props.connectionId}
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
