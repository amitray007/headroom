import { useState } from "react";

import { Button } from "../../ui/button.tsx";
import { TextField } from "./form-parts.tsx";
import { checkWebhookUrl } from "./validate.ts";

/** Step 1 of the webhook: the address that receives each notice. */
export function WebhookUrlStep(props: {
  readonly initial: string;
  readonly onContinue: (url: string) => void;
  readonly onCancel: (() => void) | null;
}) {
  const [url, setUrl] = useState(props.initial);
  const [touched, setTouched] = useState(false);
  const check = checkWebhookUrl(url);
  const error = touched && !check.ok ? check.problem : null;
  const warning = check.ok ? check.warning : null;

  return (
    <form
      className="dl-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (check.ok) props.onContinue(url.trim());
      }}
    >
      <TextField
        label="URL"
        type="url"
        value={url}
        placeholder="https://example.com/headroom"
        error={error}
        warning={warning}
        onChange={setUrl}
        onBlur={() => setTouched(true)}
      />
      <div className="dl-actions">
        <Button type="submit" variant="primary" disabled={url.trim() === ""}>
          Continue
        </Button>
        {props.onCancel === null ? null : (
          <Button variant="quiet" onClick={props.onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
