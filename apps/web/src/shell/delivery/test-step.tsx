import { useState } from "react";

import { isDemoRefusal } from "../../api.ts";
import { Button } from "../../ui/button.tsx";
import { Result } from "../../ui/result.tsx";
import { SwitchRow } from "../settings-rows.tsx";
import { Problem } from "./form-parts.tsx";
import { codeOf, saveProblem } from "./status.ts";

type Phase =
  | { readonly kind: "ready" }
  | { readonly kind: "sent" }
  | { readonly kind: "failed"; readonly text: string; readonly demo: boolean };

/**
 * The Test step of both flows. It sends a test with `send`, which throws when the send fails. After a good
 * send the owner presses `finishLabel`, which runs `finish` (the save) and then calls `onFinished`.
 */
export function TestStep(props: {
  readonly lead: string;
  readonly identity: boolean;
  readonly onIdentity: (value: boolean) => void;
  readonly sendLabel: string;
  readonly send: () => Promise<void>;
  /** Plain words for the error word the server sent. */
  readonly failureText: (code: string | null) => string;
  readonly okTitle: string;
  readonly okNote: string;
  readonly finishLabel: string;
  readonly finish: () => Promise<void>;
  readonly onFinished: () => void;
  /** Offered after a failed send: save without a good test. */
  readonly saveAnyway?: boolean;
  readonly onBack: () => void;
  readonly onFailed: (failed: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "ready" });
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const send = async (): Promise<void> => {
    setSending(true);
    setProblem(null);
    try {
      await props.send();
      setPhase({ kind: "sent" });
      props.onFailed(false);
    } catch (cause) {
      setPhase({
        kind: "failed",
        text: props.failureText(codeOf(cause)),
        demo: isDemoRefusal(cause),
      });
      props.onFailed(true);
    } finally {
      setSending(false);
    }
  };
  const finish = async (): Promise<void> => {
    setSaving(true);
    setProblem(null);
    try {
      await props.finish();
      props.onFinished();
    } catch (cause) {
      setProblem(saveProblem(codeOf(cause)));
    } finally {
      setSaving(false);
    }
  };
  const back = (): void => {
    props.onFailed(false);
    props.onBack();
  };

  if (phase.kind === "sent") {
    return (
      <>
        <Result ok title={props.okTitle}>
          {props.okNote}
        </Result>
        <Problem>{problem}</Problem>
        <div className="dl-actions">
          <Button variant="primary" busy={saving} busyLabel="Saving" onClick={() => void finish()}>
            {props.finishLabel}
          </Button>
          <Button variant="quiet" busy={sending} busyLabel="Sending" onClick={() => void send()}>
            Send Again
          </Button>
        </div>
      </>
    );
  }
  if (phase.kind === "failed") {
    return (
      <>
        <Result ok={false} title={phase.demo ? "Demo Only" : "Test Failed"}>
          {phase.text}
        </Result>
        <Problem>{problem}</Problem>
        <div className="dl-actions">
          <Button variant="primary" onClick={back}>
            Back
          </Button>
          {/* A save is refused for the same reason as the test. */}
          {props.saveAnyway === true && !phase.demo ? (
            <Button variant="quiet" busy={saving} busyLabel="Saving" onClick={() => void finish()}>
              Save Anyway
            </Button>
          ) : null}
        </div>
      </>
    );
  }
  return (
    <>
      <p className="secondary dl-lead">{props.lead}</p>
      <SwitchRow
        title="Include Account Email"
        note="Adds the email or login of each account."
        checked={props.identity}
        onChange={props.onIdentity}
      />
      <div className="dl-actions">
        <Button variant="primary" busy={sending} busyLabel="Sending" onClick={() => void send()}>
          {props.sendLabel}
        </Button>
        <Button variant="quiet" disabled={sending} onClick={back}>
          Back
        </Button>
      </div>
    </>
  );
}
