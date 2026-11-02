import { useState } from "react";

import { ApiError, api } from "./api.ts";
import { AuthFrame, AuthSkeleton, Unreachable } from "./auth-pages.tsx";
import { useLoad } from "./lib/load.ts";
import { href } from "./router.ts";
import { Button, ButtonLink } from "./ui/button.tsx";

const expired = "This code has expired. Start again from your Mac.";

/** Where a Mac that asked to connect (D48) meets the signed-in owner: allow it, or not. */
export function PairPage(props: { readonly code: string }) {
  const pairing = useLoad(() => api.pairing(props.code), `pairing:${props.code}`);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "deny"): Promise<void> {
    setBusy(decision);
    setError(null);
    try {
      await api.decidePairing(props.code, decision);
      pairing.reload();
    } catch (cause) {
      // Already decided, or gone: the reload shows which.
      if (cause instanceof ApiError && cause.status !== 500) pairing.reload();
      else setError("Request failed. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (pairing.data === null) {
    if (pairing.error === null) return <AuthSkeleton />;
    if (pairing.status === 404) return <AuthFrame title="Code Expired" note={expired} />;
    return (
      <Unreachable
        task="load this request"
        status={pairing.status}
        busy={pairing.pending}
        onRetry={pairing.reload}
      />
    );
  }
  const { name, status } = pairing.data;
  if (status === "approved") {
    return (
      <AuthFrame title="Connected">
        <ButtonLink variant="primary" href={href({ page: "connect" })}>
          Connect AI Accounts
        </ButtonLink>
      </AuthFrame>
    );
  }
  if (status === "denied") return <AuthFrame title="Not Allowed" />;
  if (status === "expired") return <AuthFrame title="Code Expired" note={expired} />;
  return (
    <AuthFrame title={`Allow ${name}?`}>
      <p className="pair-code" aria-label="Code">
        {props.code}
      </p>
      <ul className="pair-can">
        <li>Can see your accounts, limits and resets</li>
        <li>Can mark notices as read</li>
        <li>Cannot change accounts, connect new ones or use your plans</li>
      </ul>
      {error === null ? null : (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="pair-actions">
        <Button disabled={busy !== null} busy={busy === "deny"} onClick={() => void decide("deny")}>
          Deny
        </Button>
        <Button
          variant="primary"
          disabled={busy !== null}
          busy={busy === "approve"}
          onClick={() => void decide("approve")}
        >
          Allow
        </Button>
      </div>
    </AuthFrame>
  );
}
