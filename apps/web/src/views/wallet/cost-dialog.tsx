import { useState, type FormEvent } from "react";

import type { Provider } from "@headroom/core/contracts";
import { accountName, planLabel, providerName } from "@headroom/view-model/labels";
import {
  currencies,
  formatMoney,
  suggestPrices,
  type Cost,
  type Currency,
  type Cycle,
  type WalletAccount,
} from "@headroom/view-model/wallet";

import { TextField } from "../../shell/delivery/form-parts.tsx";
import { Button } from "../../ui/button.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { Segmented } from "../../ui/segmented.tsx";
import { amountText, monthLabel, parseAmount } from "./book.ts";
import { DateField, GroupField, SelectField } from "./fields.tsx";

type Kind = Cost["kind"];

const kinds: readonly { readonly value: Kind; readonly label: string }[] = [
  { value: "paid", label: "Paid" },
  { value: "free", label: "Free" },
  { value: "included", label: "Included" },
];

const cycles: readonly { readonly value: Cycle; readonly label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annual" },
];

/** Quick answers for "Included With": what each provider's accounts usually come with. */
const includedWith: Partial<Record<Provider, readonly string[]>> = {
  grok: ["X Premium"],
  copilot: ["GitHub Pro", "GitHub Education"],
  antigravity: ["Google AI Pro"],
};

const cycleWord: Record<Cycle, string> = { monthly: "month", annual: "year" };

function CostForm(props: {
  readonly account: WalletAccount;
  readonly defaultCurrency: Currency;
  readonly onSave: (cost: Cost | null) => void;
  readonly onCancel: () => void;
}) {
  const { account } = props;
  const { provider, plan } = account.connection;
  const current = account.cost;
  const [kind, setKind] = useState<Kind>(current?.kind ?? "paid");
  const [amount, setAmount] = useState(
    current?.kind === "paid" ? amountText(current.price.minor) : "",
  );
  const [currency, setCurrency] = useState<Currency>(
    current?.kind === "paid" ? current.price.currency : props.defaultCurrency,
  );
  const [cycle, setCycle] = useState<Cycle>(current?.kind === "paid" ? current.cycle : "monthly");
  const [renewsOn, setRenewsOn] = useState(
    current?.kind === "paid" ? (current.renewsOn ?? "") : "",
  );
  const [included, setIncluded] = useState(
    current?.kind === "included" ? current.includedWith : "",
  );
  const [error, setError] = useState<string | null>(null);

  const suggestions = kind === "paid" ? suggestPrices(provider, plan) : [];
  const quick = includedWith[provider] ?? [];

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (kind === "free") {
      props.onSave({ kind: "free" });
    } else if (kind === "included") {
      const words = included.trim();
      if (words === "") setError("Say what this account comes with.");
      else props.onSave({ kind: "included", includedWith: words });
    } else {
      const minor = parseAmount(amount);
      if (minor === null) setError("Enter an amount above zero, such as 199.99.");
      else {
        props.onSave({
          kind: "paid",
          price: { minor, currency },
          cycle,
          renewsOn: renewsOn === "" ? null : renewsOn,
        });
      }
    }
  };

  const description = [providerName(provider), accountName(account.connection), planLabel(plan)]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <form onSubmit={submit} noValidate>
      <div className="dsec">
        <p className="w-desc">{description}</p>
        <Segmented
          full
          label="Kind of cost"
          value={kind}
          options={kinds}
          onChange={(next) => {
            setKind(next);
            setError(null);
          }}
        />
      </div>
      {kind === "paid" ? (
        <div className="dsec">
          {suggestions.length === 0 ? null : (
            <GroupField label="List prices">
              <div className="w-chips">
                {suggestions.map((suggestion) => {
                  const chosen =
                    amount === amountText(suggestion.price.minor) &&
                    currency === suggestion.price.currency &&
                    cycle === suggestion.cycle;
                  return (
                    <button
                      key={`${suggestion.label}:${suggestion.cycle}`}
                      type="button"
                      className="w-chip"
                      aria-pressed={chosen}
                      onClick={() => {
                        setAmount(amountText(suggestion.price.minor));
                        setCurrency(suggestion.price.currency);
                        setCycle(suggestion.cycle);
                        setError(null);
                      }}
                    >
                      <span>
                        {suggestion.label} · {formatMoney(suggestion.price)} /{" "}
                        {cycleWord[suggestion.cycle]}
                      </span>
                      <span className="muted">List price, {monthLabel(suggestion.asOf)}</span>
                    </button>
                  );
                })}
              </div>
            </GroupField>
          )}
          <div className="w-pair">
            <TextField
              label="Amount"
              value={amount}
              inputMode="decimal"
              placeholder="0.00"
              error={error}
              onChange={(value) => {
                setAmount(value);
                setError(null);
              }}
            />
            <SelectField
              label="Currency"
              value={currency}
              onChange={(value) => {
                const next = currencies.find((entry) => entry === value);
                if (next !== undefined) setCurrency(next);
              }}
            >
              {currencies.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </SelectField>
          </div>
          <GroupField label="Billing">
            <Segmented full label="Billing" value={cycle} options={cycles} onChange={setCycle} />
          </GroupField>
          <DateField label="Renews On (Optional)" value={renewsOn} onChange={setRenewsOn} />
        </div>
      ) : null}
      {kind === "included" ? (
        <div className="dsec">
          <TextField
            label="Included With"
            value={included}
            placeholder={quick[0] ?? "Another subscription"}
            error={error}
            onChange={(value) => {
              setIncluded(value);
              setError(null);
            }}
          />
          {quick.length === 0 ? null : (
            <div className="w-chips">
              {quick.map((words) => (
                <button
                  key={words}
                  type="button"
                  className="w-chip"
                  aria-pressed={included === words}
                  onClick={() => {
                    setIncluded(words);
                    setError(null);
                  }}
                >
                  {words}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {kind === "free" ? (
        <div className="dsec">
          <p className="w-desc">
            Counts as {formatMoney({ minor: 0, currency: props.defaultCurrency })} in your totals.
          </p>
        </div>
      ) : null}
      <div className="w-foot">
        {current === null ? null : (
          <Button variant="quiet-danger" className="w-clear" onClick={() => props.onSave(null)}>
            Clear Cost
          </Button>
        )}
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" type="submit">
          Save Cost
        </Button>
      </div>
    </form>
  );
}

/**
 * Set or edit what one account costs. Closed while `account` is null. The form mounts fresh for each account,
 * so a half-typed entry never carries over.
 */
export function CostDialog(props: {
  readonly account: WalletAccount | null;
  /** The display currency, the starting choice for a new paid cost. */
  readonly defaultCurrency: Currency;
  /** Null clears the cost back to Not set. */
  readonly onSave: (connectionId: string, cost: Cost | null) => void;
  readonly onClose: () => void;
}) {
  const { account, onClose } = props;
  return (
    <Dialog
      open={account !== null}
      onClose={onClose}
      title={account?.cost === null || account === null ? "Set Cost" : "Edit Cost"}
    >
      {account === null ? null : (
        <CostForm
          key={account.connection.id}
          account={account}
          defaultCurrency={props.defaultCurrency}
          onSave={(cost) => {
            props.onSave(account.connection.id, cost);
            onClose();
          }}
          onCancel={onClose}
        />
      )}
    </Dialog>
  );
}
