import { useId, useState } from "react";

import { Button } from "../../ui/button.tsx";
import { Segmented } from "../../ui/segmented.tsx";
import { Disclosure } from "./form-parts.tsx";
import { SecretCard } from "./secret-card.tsx";

/** Step 2 of the webhook: the signing secret. In change mode the saved secret can stay. */
export function WebhookSecretStep(props: {
  readonly secret: string;
  /** Set only when changing a saved webhook: true keeps its secret. */
  readonly keep: boolean | null;
  readonly onKeep: (keep: boolean) => void;
  readonly onRegenerate: () => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const boxId = useId();
  const showing = props.keep !== true;
  return (
    <div className="dl-form">
      {props.keep === null ? null : (
        <Segmented
          label="Secret"
          value={props.keep ? "keep" : "new"}
          onChange={(value) => props.onKeep(value === "keep")}
          options={[
            { value: "keep", label: "Keep Current Secret" },
            { value: "new", label: "New Secret" },
          ]}
        />
      )}
      {showing ? (
        <>
          <p className="secondary dl-lead">
            Add this secret to your receiver. Headroom signs every request with it.
          </p>
          <SecretCard
            secret={props.secret}
            onRegenerate={() => {
              setSaved(false);
              props.onRegenerate();
            }}
          />
          <Disclosure label="How Requests Are Signed">
            <ul className="dl-signing">
              <li>Headers: webhook-id, webhook-timestamp, webhook-signature.</li>
              <li>Signature: HMAC-SHA256 of id.timestamp.body, keyed with the secret.</li>
              <li>Follows the Standard Webhooks format.</li>
            </ul>
          </Disclosure>
          <label className="dl-check" htmlFor={boxId}>
            <input
              id={boxId}
              type="checkbox"
              checked={saved}
              onChange={(event) => setSaved(event.currentTarget.checked)}
            />
            I Saved the Secret
          </label>
        </>
      ) : (
        <p className="secondary dl-lead">The secret your receiver uses now keeps working.</p>
      )}
      <div className="dl-actions">
        <Button variant="primary" disabled={showing && !saved} onClick={props.onContinue}>
          Continue
        </Button>
        <Button variant="quiet" onClick={props.onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}
