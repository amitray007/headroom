import { useState } from "react";

import { api, type ChannelView } from "../../api.ts";
import { Button } from "../../ui/button.tsx";
import { Result } from "../../ui/result.tsx";
import { FlowShell } from "./flow-shell.tsx";
import { generateSecret } from "./secret.ts";
import { testProblem } from "./status.ts";
import { stepperAt, webhookWords, type Stage } from "./steps.ts";
import { TestStep } from "./test-step.tsx";
import { hostOf } from "./validate.ts";
import { WebhookSecretStep } from "./webhook-secret-step.tsx";
import { WebhookUrlStep } from "./webhook-url-step.tsx";

/**
 * Set up a webhook: URL, Secret, Test, Done. Headroom makes the secret here, so the test can sign with it before
 * anything is saved. With `channel` it changes that channel; keeping its secret saves the URL first, because
 * the saved secret exists only on the server, and then tests the saved channel.
 */
export function WebhookFlow(props: {
  readonly channel: ChannelView | null;
  /** Leave without saving. Only offered when changing a channel. */
  readonly onCancel: (() => void) | null;
  /** The channel was saved: load the list again. */
  readonly onSaved: () => void;
  readonly onDone: () => void;
}) {
  const { channel } = props;
  const [stage, setStage] = useState<Stage>("first");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState(generateSecret);
  const [keep, setKeep] = useState<boolean | null>(channel === null ? null : true);
  const [identity, setIdentity] = useState(channel?.includeIdentity ?? false);
  const [failed, setFailed] = useState(false);
  const { step, state } = stepperAt(stage, failed);
  const keeping = channel !== null && keep === true;

  const save = async (): Promise<void> => {
    if (channel === null) {
      await api.createChannel({ type: "webhook", url, secret, includeIdentity: identity });
    } else {
      await api.updateChannel(channel.id, {
        url,
        includeIdentity: identity,
        ...(keeping ? {} : { secret }),
      });
    }
    props.onSaved();
  };

  const send = async (): Promise<void> => {
    if (keeping) {
      await api.updateChannel(channel.id, { url, includeIdentity: identity });
      props.onSaved();
      await api.testChannel(channel.id);
      return;
    }
    await api.verifyDelivery({ type: "webhook", url, secret });
  };

  return (
    <FlowShell type="webhook" words={webhookWords} step={step} state={state} stage={stage}>
      {stage === "first" ? (
        <WebhookUrlStep
          initial={url}
          onCancel={props.onCancel}
          onContinue={(next) => {
            setUrl(next);
            setStage("second");
          }}
        />
      ) : null}
      {stage === "second" ? (
        <WebhookSecretStep
          secret={secret}
          keep={keep}
          onKeep={setKeep}
          onRegenerate={() => setSecret(generateSecret())}
          onBack={() => setStage("first")}
          onContinue={() => setStage("test")}
        />
      ) : null}
      {stage === "test" ? (
        <TestStep
          lead={`Send a test request to ${hostOf(url)}.`}
          identity={identity}
          onIdentity={setIdentity}
          sendLabel={keeping ? "Save and Send Test" : "Send Test"}
          send={send}
          failureText={(code) => testProblem("webhook", code)}
          okTitle="Receiver Answered"
          okNote="Your receiver accepted the test."
          finishLabel="Finish"
          finish={keeping ? () => Promise.resolve() : save}
          saveAnyway={!keeping}
          onFinished={() => setStage("done")}
          onBack={() => setStage("second")}
          onFailed={setFailed}
        />
      ) : null}
      {stage === "done" ? (
        <>
          <Result ok title="Webhook Is Set Up">
            {`Notices will arrive at ${hostOf(url)}.`}
          </Result>
          <div className="dl-actions">
            <Button variant="primary" onClick={props.onDone}>
              Done
            </Button>
          </div>
        </>
      ) : null}
    </FlowShell>
  );
}
