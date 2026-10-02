import { useState } from "react";

import { api, ApiError, type ChannelView } from "../../api.ts";
import { Button } from "../../ui/button.tsx";
import { CopyButton } from "../../ui/copy-button.tsx";
import { Section, SwitchRow } from "../settings-rows.tsx";
import { ChannelPanel } from "./channel-panel.tsx";
import { FormFold } from "./form-parts.tsx";
import { changeProblem, isFullUrl, problemText, saveProblem, urlProblem } from "./status.ts";

/** The inline form that sets up a webhook, or changes its URL. `onDone` gets the secret of a new webhook. */
function WebhookForm(props: {
  readonly channel: ChannelView | null;
  readonly open: boolean;
  readonly onDone: (secret: string | undefined) => void;
  readonly onCancel: () => void;
}) {
  const { channel } = props;
  const [url, setUrl] = useState("");
  const [identity, setIdentity] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = url.trim();
  const canSave = clean !== "";

  const save = (): void => {
    if (!isFullUrl(clean)) {
      setError(urlProblem);
      return;
    }
    setError(null);
    setSaving(true);
    const run =
      channel === null
        ? api
            .createChannel({ type: "webhook", url: clean, includeIdentity: identity })
            .then((created) => created.secret)
        : api.updateChannel(channel.id, { url: clean }).then(() => undefined);
    run
      .then((secret) => props.onDone(secret))
      .catch((cause: unknown) =>
        setError(problemText(cause instanceof ApiError ? cause.code : null, saveProblem)),
      )
      .finally(() => setSaving(false));
  };

  return (
    <FormFold
      open={props.open}
      busy={saving}
      error={error}
      canSave={canSave}
      onSave={save}
      onCancel={props.onCancel}
    >
      <div className="field">
        <label htmlFor="dl-webhook-url">URL</label>
        <input
          id="dl-webhook-url"
          type="url"
          value={url}
          placeholder="https://example.com/headroom"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setUrl(event.currentTarget.value)}
        />
      </div>
      {/* A set-up channel has its own switch above the form. */}
      {channel === null ? (
        <SwitchRow
          title="Include Account Email"
          note="Adds the email or login of each account."
          checked={identity}
          onChange={setIdentity}
        />
      ) : null}
    </FormFold>
  );
}

/** The signing secret, shown once. It lives only while this callout is open. */
function SecretCallout(props: { readonly secret: string; readonly onDone: () => void }) {
  return (
    <section className="dl-secret" aria-label="Signing Secret">
      <span className="dl-label">Signing Secret</span>
      <div className="dl-secret-row">
        <code className="dl-secret-value">{props.secret}</code>
        <CopyButton value={props.secret} label="Copy" size="sm" />
      </div>
      <span className="muted dl-note">
        Shown once. Use it to check each request came from Headroom.
      </span>
      <div className="dl-actions">
        <Button size="sm" onClick={props.onDone}>
          Done
        </Button>
      </div>
    </section>
  );
}

/** Webhook: a Set Up row, or the channel with its controls. */
export function WebhookCard(props: {
  readonly channel: ChannelView | null;
  readonly reload: () => void;
}) {
  const { channel, reload } = props;
  const [form, setForm] = useState({ open: false, key: 0 });
  const [secret, setSecret] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const open = (): void => setForm((current) => ({ open: true, key: current.key + 1 }));
  const close = (): void => setForm((current) => ({ ...current, open: false }));

  const newSecret = (): void => {
    if (channel === null) return;
    setProblem(null);
    api
      .newChannelSecret(channel.id)
      .then((made) => setSecret(made.secret))
      .catch(() => setProblem(changeProblem));
  };

  return (
    <Section>
      {channel === null ? (
        <div className="srow">
          <span className="sbody">
            <b>Webhook</b>
            <span className="muted">Send each notice to a URL.</span>
          </span>
          <Button size="sm" onClick={open} disabled={form.open}>
            Set Up
          </Button>
        </div>
      ) : (
        <ChannelPanel
          channel={channel}
          title="Webhook"
          reload={reload}
          actions={
            <>
              <Button size="sm" variant="quiet" onClick={newSecret}>
                New Secret
              </Button>
              <Button size="sm" variant="quiet" onClick={open}>
                Change URL
              </Button>
            </>
          }
        />
      )}
      {problem === null ? null : (
        <p className="form-error dl-problem" role="alert">
          {problem}
        </p>
      )}
      {secret === null ? null : <SecretCallout secret={secret} onDone={() => setSecret(null)} />}
      <WebhookForm
        key={`${channel?.id ?? "new"}-${form.key}`}
        channel={channel}
        open={form.open}
        onCancel={close}
        onDone={(made) => {
          close();
          if (made !== undefined) setSecret(made);
          reload();
        }}
      />
    </Section>
  );
}
