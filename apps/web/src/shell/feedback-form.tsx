import { type FormEvent, type KeyboardEvent, useId, useState } from "react";

import { feedbackMaxLength } from "@headroom/core/contracts";

import { api, ApiError, demoRefusal, isDemoRefusal } from "../api.ts";
import { Button } from "../ui/button.tsx";
import { DrawnCheck } from "../ui/drawn-check.tsx";
import { Section } from "./settings-rows.tsx";
import "./feedback-form.css";

/** The count appears only once a message gets close to the limit. */
const countFrom = 1800;

function failureText(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === "feedback_unavailable") {
    return "This build cannot send feedback.";
  }
  if (cause instanceof ApiError && cause.code === "feedback_too_soon") {
    return "Wait a moment before sending more.";
  }
  if (isDemoRefusal(cause)) return demoRefusal;
  return "Could not send. Try again.";
}

function Sent(props: { readonly onAgain: () => void }) {
  return (
    <output className="fb-sent">
      <span className="fb-sent-mark">
        <DrawnCheck />
      </span>
      <b>Thanks for the feedback</b>
      <span className="muted">It reached the maintainer.</span>
      <Button variant="quiet" size="sm" onClick={props.onAgain}>
        Send Another
      </Button>
    </output>
  );
}

/** A message to the maintainer. No contact details: it goes out anonymously with the Headroom version. */
export function FeedbackForm() {
  const id = useId();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = message.trim();

  const send = async (): Promise<void> => {
    if (trimmed === "" || sending) return;
    setSending(true);
    setError(null);
    try {
      await api.sendFeedback(trimmed);
      setMessage("");
      setSent(true);
    } catch (cause) {
      setError(failureText(cause));
    } finally {
      setSending(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void send();
  };
  const shortcut = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <Section title="Feedback">
      <p className="fb-lead">Tell the maintainer what works, what breaks, or what you want next.</p>
      {sent ? (
        <Sent onAgain={() => setSent(false)} />
      ) : (
        <form className="fb-card" onSubmit={submit}>
          <label className="sr" htmlFor={id}>
            Feedback
          </label>
          <textarea
            id={id}
            value={message}
            maxLength={feedbackMaxLength}
            rows={6}
            placeholder="The Wallet could show monthly totals…"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={shortcut}
            aria-invalid={error !== null}
          />
          <div className="fb-bar">
            <span className="fb-meta">Sent anonymously with your version.</span>
            {message.length >= countFrom ? (
              <span
                className="fb-count"
                data-full={message.length >= feedbackMaxLength || undefined}
              >
                {feedbackMaxLength - message.length}
              </span>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              size="sm"
              busy={sending}
              busyLabel="Sending"
              disabled={trimmed === ""}
            >
              Send
            </Button>
          </div>
        </form>
      )}
      {error === null ? null : (
        <p className="fb-error" role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}
