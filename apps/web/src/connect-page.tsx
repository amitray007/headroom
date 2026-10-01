import { useEffect, useState, type FormEvent } from "react";

import type { NextStepPayload, SubmitInput } from "@headroom/core/contracts";

import { api, type Attempt } from "./api.ts";
import { ErrorText } from "./components.tsx";
import { formatTimeLeft } from "./format.ts";
import { messageOf, useLoad, useNow } from "./hooks.ts";
import {
  acceptsLabel,
  attemptStateLabel,
  isTerminal,
  methodLabel,
  pasteInputKind,
  shouldPoll,
  stepForm,
} from "./labels.ts";
import { href } from "./router.ts";

function CopyButton(props: { readonly text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(props.text).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      {copied ? "Copied" : "Copy code"}
    </button>
  );
}

function ExternalLink(props: { readonly url: string; readonly children: string }) {
  return (
    <a href={props.url} target="_blank" rel="noreferrer noopener">
      {props.children}
    </a>
  );
}

/** Input forms for steps that need the user to paste or choose something. Clears itself on submit. */
function StepInput(props: {
  readonly step: NextStepPayload;
  readonly busy: boolean;
  readonly onSubmit: (input: SubmitInput) => void;
}) {
  const { step } = props;
  const [value, setValue] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState("");

  function submit(event: FormEvent<HTMLFormElement>, build: () => SubmitInput): void {
    event.preventDefault();
    const input = build();
    setValue("");
    setValues({});
    props.onSubmit(input);
  }

  switch (step.kind) {
    case "open_url":
      return (
        <p>
          <ExternalLink url={step.url}>Open the sign-in page</ExternalLink> and finish there.
        </p>
      );
    case "device_code":
      return (
        <div>
          <p>
            Open <ExternalLink url={step.verificationUrl}>{step.verificationUrl}</ExternalLink> and
            enter this code.
          </p>
          <p className="row">
            <code className="device-code">{step.userCode}</code>
            <CopyButton text={step.userCode} />
          </p>
        </div>
      );
    case "paste_redirect": {
      const label = acceptsLabel(step.accepts);
      return (
        <form
          onSubmit={(event) =>
            submit(event, () => ({
              kind: pasteInputKind(step.accepts, value),
              value: value.trim(),
            }))
          }
        >
          <p>
            <ExternalLink url={step.url}>Open the sign-in page</ExternalLink>, approve access, then
            come back.
          </p>
          <label>
            {label}
            <input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <button type="submit" disabled={props.busy}>
            Submit
          </button>
        </form>
      );
    }
    case "select_account":
      return (
        <form onSubmit={(event) => submit(event, () => ({ kind: "selection", id: selected }))}>
          <fieldset>
            <legend>Choose an account</legend>
            {step.options.map((option) => (
              <label key={option.id} className="inline">
                <input
                  type="radio"
                  name="account"
                  value={option.id}
                  checked={selected === option.id}
                  onChange={() => setSelected(option.id)}
                  required
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={props.busy || selected === ""}>
            Continue
          </button>
        </form>
      );
    case "api_key":
      return (
        <form onSubmit={(event) => submit(event, () => ({ kind: "api_key", values }))}>
          <p>
            Create a key on the <ExternalLink url={step.keyPageUrl}>provider key page</ExternalLink>
            .
          </p>
          {step.fields.map((field) => (
            <label key={field.name}>
              {field.label}
              <input
                type={field.secret ? "password" : "text"}
                value={values[field.name] ?? ""}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
          ))}
          <button type="submit" disabled={props.busy}>
            Submit
          </button>
        </form>
      );
    case "paste_file":
      return (
        <form onSubmit={(event) => submit(event, () => ({ kind: "file", contents: value }))}>
          <p>{step.hint}</p>
          <label>
            Contents of {step.expectedFileName}
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              rows={8}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <button type="submit" disabled={props.busy}>
            Submit
          </button>
        </form>
      );
  }
}

function AttemptView(props: {
  readonly attempt: Attempt;
  readonly onUpdate: (attempt: Attempt) => void;
  readonly onRestart: () => void;
}) {
  const { attempt } = props;
  const now = useNow(1000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { onUpdate } = props;

  useEffect(() => {
    if (attempt.pollAfterMs <= 0 && !shouldPoll(attempt.state)) return;
    const timer = setTimeout(
      () => {
        api.attempt(attempt.id).then(onUpdate, (cause: unknown) => setError(messageOf(cause)));
      },
      Math.max(attempt.pollAfterMs, 1000),
    );
    return () => clearTimeout(timer);
  }, [attempt, onUpdate]);

  async function call(action: () => Promise<Attempt>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onUpdate(await action());
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  const terminal = isTerminal(attempt.state);
  const form = attempt.nextStep === null ? "none" : stepForm(attempt.nextStep);
  return (
    <section aria-live="polite">
      <h2>
        {attempt.provider}: {attemptStateLabel(attempt.state)}
      </h2>
      {attempt.state === "succeeded" ? (
        <p>
          Connected.{" "}
          {attempt.connectionId === null ? null : (
            <a href={href({ page: "detail", id: attempt.connectionId })}>View the connection</a>
          )}
        </p>
      ) : null}
      {terminal && attempt.state !== "succeeded" ? (
        <>
          <p>{attempt.error ?? `The attempt ${attempt.state}.`}</p>
          <button type="button" onClick={props.onRestart}>
            Try again
          </button>
        </>
      ) : null}
      {!terminal && attempt.nextStep !== null ? (
        <StepInput
          key={attempt.nextStep.kind}
          step={attempt.nextStep}
          busy={busy}
          onSubmit={(input) => void call(() => api.submitInput(attempt.id, input))}
        />
      ) : null}
      {!terminal && shouldPoll(attempt.state) && form === "none" ? (
        <p className="row">
          <span className="spinner" aria-hidden="true" />
          Waiting. Time left {formatTimeLeft(attempt.expiresAt, now)}.
        </p>
      ) : null}
      {!terminal ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void call(() => api.cancelAttempt(attempt.id))}
        >
          Cancel
        </button>
      ) : null}
      <ErrorText message={error} />
    </section>
  );
}

/** Pick a provider and method, start an attempt, then follow its steps. With `reconnectId`, re-signs an existing connection. */
export function ConnectPage(props: { readonly reconnectId?: string }) {
  const { reconnectId } = props;
  const providers = useLoad(() => api.providers(), "providers");
  const existing = useLoad(
    () => (reconnectId === undefined ? Promise.resolve(null) : api.connection(reconnectId)),
    `reconnect:${reconnectId ?? ""}`,
  );
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [provider, setProvider] = useState("");
  const [method, setMethod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lockedProvider = existing.data?.connection.provider;
  const available = (providers.data?.providers ?? []).filter(
    (entry) => lockedProvider === undefined || entry.provider === lockedProvider,
  );
  const chosenProvider = lockedProvider ?? provider;
  const methods = available.find((entry) => entry.provider === chosenProvider)?.methods ?? [];

  async function begin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setAttempt(
        reconnectId === undefined
          ? await api.beginAttempt(chosenProvider, method)
          : await api.reconnect(reconnectId, method),
      );
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="narrow">
      <h1>{reconnectId === undefined ? "Connect an account" : "Reconnect"}</h1>
      <ErrorText message={providers.error ?? existing.error} />
      {attempt === null ? (
        <form onSubmit={(event) => void begin(event)}>
          <label>
            Provider
            <select
              value={chosenProvider}
              disabled={lockedProvider !== undefined}
              onChange={(event) => {
                setProvider(event.target.value);
                setMethod("");
              }}
              required
            >
              <option value="">Choose a provider</option>
              {available.map((entry) => (
                <option key={entry.provider} value={entry.provider}>
                  {entry.provider}
                  {entry.interface === "private" ? " (private interface)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Method
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              disabled={methods.length === 0}
              required
            >
              <option value="">Choose a method</option>
              {methods.map((entry) => (
                <option key={entry} value={entry}>
                  {methodLabel(entry)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy || chosenProvider === "" || method === ""}>
            Start
          </button>
          <ErrorText message={error} />
        </form>
      ) : (
        <AttemptView
          attempt={attempt}
          onUpdate={setAttempt}
          onRestart={() => {
            setAttempt(null);
            setError(null);
          }}
        />
      )}
    </main>
  );
}
