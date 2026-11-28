import { useId, useState, type FormEvent } from "react";

import { api, ApiError, demoRefusal, isDemoRefusal } from "../api.ts";
import { Button } from "../ui/button.tsx";
import { Section } from "./settings-rows.tsx";
import "./feedback-form.css";

/** The server rejects a longer message. */
const feedbackLimit = 2000;

type Status = "idle" | "sending" | "sent";

function failureText(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === "feedback_unavailable") {
    return "This build cannot send feedback.";
  }
  if (isDemoRefusal(cause)) return demoRefusal;
  return "Could not send. Try again.";
}

/** A message to the maintainer. No contact details: it goes out anonymously with the Headroom version. */
export function FeedbackForm() {
  const id = useId();
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const trimmed = message.trim();
  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (trimmed === "" || status === "sending") return;
    setStatus("sending");
    setError(null);
    try {
      await api.sendFeedback(trimmed);
      setMessage("");
      setStatus("sent");
    } catch (cause) {
      setError(failureText(cause));
      setStatus("idle");
    }
  };
  return (
    <Section>
      <form className="fb" onSubmit={(event) => void send(event)}>
        <label className="sr" htmlFor={id}>
          Feedback
        </label>
        <textarea
          id={id}
          value={message}
          maxLength={feedbackLimit}
          placeholder="What works, what doesn't, what you'd like next"
          onChange={(event) => {
            setMessage(event.target.value);
            if (status === "sent") setStatus("idle");
          }}
        />
        <div className="fb-foot">
          <Button
            type="submit"
            variant="primary"
            busy={status === "sending"}
            busyLabel="Sending"
            disabled={trimmed === ""}
          >
            Send
          </Button>
          {status === "sent" ? (
            <output>Thanks. Sent.</output>
          ) : (
            <span className="fb-count muted">
              {message.length} / {feedbackLimit}
            </span>
          )}
        </div>
        {error === null ? null : (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p className="fb-note muted">
          Sent anonymously to the maintainer with your Headroom version.
        </p>
      </form>
    </Section>
  );
}
