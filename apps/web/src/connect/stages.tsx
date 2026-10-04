import { useId, useState, type FormEvent, type ReactNode } from "react";

import type { AuthMethod, NextStepPayload, SubmitInput } from "@headroom/core/contracts";

import { ExternalIcon } from "../icons.tsx";
import { Button, ButtonLink } from "../ui/button.tsx";
import { CopyButton } from "../ui/copy-button.tsx";
import { acceptsLabel, acceptsPlaceholder, pasteInputKind, type Accepts } from "./steps.ts";

function OpenLink(props: {
  readonly url: string;
  readonly primary?: boolean;
  readonly children: string;
}) {
  return (
    <ButtonLink
      href={props.url}
      target="_blank"
      rel="noreferrer noopener"
      variant={props.primary === false ? "default" : "primary"}
      icon={<ExternalIcon />}
    >
      {props.children}
    </ButtonLink>
  );
}

function CancelButton(props: { readonly onCancel: () => void; readonly disabled?: boolean }) {
  return (
    <Button variant="quiet" disabled={props.disabled === true} onClick={props.onCancel}>
      Cancel
    </Button>
  );
}

function Lead(props: { readonly children: ReactNode }) {
  return (
    <p className="secondary" style={{ margin: 0 }}>
      {props.children}
    </p>
  );
}

interface StageProps {
  readonly provider: string;
  readonly method: AuthMethod;
  readonly step: NextStepPayload | null;
  readonly busy: boolean;
  readonly onSubmit: (input: SubmitInput) => void;
  readonly onCancel: () => void;
}

function PasteStage(
  props: StageProps & { readonly step: Extract<NextStepPayload, { kind: "paste_redirect" }> },
) {
  const { step } = props;
  const id = useId();
  const [value, setValue] = useState("");
  const accepts: Accepts = step.accepts;
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === "") return;
    setValue("");
    props.onSubmit({ kind: pasteInputKind(accepts, trimmed), value: trimmed });
  };
  return (
    <form className="stage" onSubmit={submit}>
      <Lead>
        Open the {props.provider} sign-in page and sign in.{" "}
        {accepts === "code"
          ? "Paste the code it shows here."
          : accepts === "url"
            ? "When it lands on a page that will not load, paste that address here."
            : "Paste the code it shows, or the address of the page that will not load."}
      </Lead>
      <div className="field">
        <label htmlFor={id}>{acceptsLabel(accepts)}</label>
        <input
          id={id}
          type={accepts === "url" ? "url" : "text"}
          value={value}
          placeholder={acceptsPlaceholder(accepts)}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>
      <div className="row">
        <Button type="submit" variant="primary" busy={props.busy} busyLabel="Sending">
          Continue
        </Button>
        <OpenLink url={step.url} primary={false}>
          {`Open ${props.provider} Sign-In`}
        </OpenLink>
        <CancelButton onCancel={props.onCancel} />
      </div>
    </form>
  );
}

function KeyStage(
  props: StageProps & { readonly step: Extract<NextStepPayload, { kind: "api_key" }> },
) {
  const { step } = props;
  const id = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const sent = { ...values };
    setValues({});
    props.onSubmit({ kind: "api_key", values: sent });
  };
  return (
    <form className="stage" onSubmit={submit}>
      {step.fields.map((field) => (
        <div className="field" key={field.name}>
          <label htmlFor={`${id}-${field.name}`}>{field.label}</label>
          <input
            id={`${id}-${field.name}`}
            type={field.secret ? "password" : "text"}
            value={values[field.name] ?? ""}
            onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>
      ))}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        The key is encrypted at rest and never shown again.
      </p>
      <div className="row">
        <Button type="submit" variant="primary" busy={props.busy} busyLabel="Sending">
          Connect
        </Button>
        <OpenLink url={step.keyPageUrl} primary={false}>
          {`Open ${props.provider} Key Page`}
        </OpenLink>
        <CancelButton onCancel={props.onCancel} />
      </div>
    </form>
  );
}

function FileStage(
  props: StageProps & { readonly step: Extract<NextStepPayload, { kind: "paste_file" }> },
) {
  const { step } = props;
  const id = useId();
  const [contents, setContents] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (contents.trim() === "") return;
    const sent = contents;
    setContents("");
    props.onSubmit({ kind: "file", contents: sent });
  };
  return (
    <form className="stage" onSubmit={submit}>
      {step.hint === "" ? null : <Lead>{step.hint}</Lead>}
      <div className="field">
        <label htmlFor={id}>{`Contents of ${step.expectedFileName}`}</label>
        <textarea
          id={id}
          value={contents}
          rows={8}
          onChange={(event) => setContents(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>
      <div className="row">
        <Button type="submit" variant="primary" busy={props.busy} busyLabel="Sending">
          Import
        </Button>
        <CancelButton onCancel={props.onCancel} />
      </div>
    </form>
  );
}

function SelectStage(
  props: StageProps & { readonly step: Extract<NextStepPayload, { kind: "select_account" }> },
) {
  const { step } = props;
  const [selected, setSelected] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (selected === "") return;
    props.onSubmit({ kind: "selection", id: selected });
  };
  return (
    <form className="stage" onSubmit={submit}>
      <Lead>Choose which account to connect.</Lead>
      <fieldset className="choices">
        <legend className="sr">Account</legend>
        {step.options.map((option) => (
          <label key={option.id} className="choice">
            <input
              type="radio"
              name="account"
              value={option.id}
              checked={selected === option.id}
              onChange={() => setSelected(option.id)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="row">
        <Button
          type="submit"
          variant="primary"
          disabled={selected === ""}
          busy={props.busy}
          busyLabel="Sending"
        >
          Continue
        </Button>
        <CancelButton onCancel={props.onCancel} />
      </div>
    </form>
  );
}

/** The Sign In step: what the owner does at the provider, drawn per kind of next step. */
export function SignInStage(props: StageProps) {
  const { step, provider, method } = props;
  if (step === null) {
    return (
      <div className="stage">
        <Lead>Starting the {provider} sign-in. This page updates on its own.</Lead>
        <div className="row">
          <CancelButton onCancel={props.onCancel} />
        </div>
      </div>
    );
  }
  switch (step.kind) {
    case "open_url":
      return (
        <div className="stage">
          {method === "approval_poll" ? (
            <Lead>
              Open the {provider} approval page and approve Headroom there. This page updates on its
              own.
            </Lead>
          ) : (
            <Lead>
              Open the {provider} sign-in page and finish there. This page updates on its own.
            </Lead>
          )}
          <div className="row">
            <OpenLink url={step.url}>
              {method === "approval_poll" ? "Open the Approval Page" : `Open ${provider} Sign-In`}
            </OpenLink>
            <CopyButton value={step.url} label="Copy Link" />
            <CancelButton onCancel={props.onCancel} />
          </div>
        </div>
      );
    case "device_code":
      return (
        <div className="stage">
          <Lead>
            Open {provider} and enter this code. Headroom finishes on its own once {provider}{" "}
            approves.
          </Lead>
          <div className="row">
            <span className="code">
              {step.userCode}
              <CopyButton value={step.userCode} label="Copy Code" size="sm" iconOnly />
            </span>
            <OpenLink url={step.verificationUrl}>{`Open ${provider} Sign-In`}</OpenLink>
            <CancelButton onCancel={props.onCancel} />
          </div>
        </div>
      );
    case "paste_redirect":
      return <PasteStage {...props} step={step} />;
    case "api_key":
      return <KeyStage {...props} step={step} />;
    case "paste_file":
      return <FileStage {...props} step={step} />;
    case "select_account":
      return <SelectStage {...props} step={step} />;
  }
}

/** The Check step: the sign-in was accepted and Headroom looks at what the account reports. */
export function CheckStage(props: { readonly onCancel: () => void }) {
  return (
    <div className="stage">
      <Lead>Signed in. Checking this account's limits.</Lead>
      <div className="sk bar" style={{ width: "40%" }} />
      <div className="row">
        <CancelButton onCancel={props.onCancel} />
      </div>
    </div>
  );
}
