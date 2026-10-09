import { useState } from "react";

import { api } from "../../api.ts";
import { Button } from "../../ui/button.tsx";
import { Problem } from "./form-parts.tsx";
import { SecretCard } from "./secret-card.tsx";
import { codeOf, rotationProblem } from "./status.ts";

/** New Secret: a confirm step, then the new secret shown once with Copy. */
export function SecretRotation(props: {
  readonly channelId: string;
  readonly onClose: () => void;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const make = (): void => {
    setBusy(true);
    setProblem(null);
    api
      .newChannelSecret(props.channelId)
      .then((made) => setSecret(made.secret))
      .catch((cause: unknown) => setProblem(rotationProblem(codeOf(cause))))
      .finally(() => setBusy(false));
  };

  if (secret !== null) {
    return (
      <div className="dl-rotation stage">
        <SecretCard secret={secret} />
        <p className="muted dl-note">Shown once. Add it to your receiver now.</p>
        <div className="dl-actions">
          <Button variant="primary" size="sm" onClick={props.onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="dl-rotation stage">
      <p className="secondary dl-lead">The old secret stops working at once.</p>
      <Problem>{problem}</Problem>
      <div className="dl-actions">
        <Button variant="primary" size="sm" busy={busy} busyLabel="Making" onClick={make}>
          Make New Secret
        </Button>
        <Button variant="quiet" size="sm" disabled={busy} onClick={props.onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
