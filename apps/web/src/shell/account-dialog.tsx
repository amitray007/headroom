import { useState, type FormEvent } from "react";

import { api } from "../api.ts";
import { authClient } from "../auth.ts";
import { FingerprintIcon, PlusIcon } from "../icons.tsx";
import { isDemoSite } from "../lib/site.ts";
import { useLoad } from "../lib/load.ts";
import { shortDate } from "@headroom/view-model/time";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";
import { PasswordField } from "../ui/password-field.tsx";
import { PasswordStrength } from "../ui/password-strength.tsx";
import { LoadingNote, Sk } from "../ui/skeleton.tsx";

const resultMs = 1600;
const fallbackMinimum = 12;

interface Failure {
  readonly code?: string | undefined;
  readonly status?: number | undefined;
}

/** Which field a failed password change belongs to, with plain words. Anything else shows under the form. */
function passwordError(
  error: Failure,
  minimum: number,
): { readonly field: "current" | "next" | "form"; readonly message: string } {
  if (error.code === "INVALID_PASSWORD") {
    return { field: "current", message: "Your current password is wrong." };
  }
  if (error.code === "PASSWORD_TOO_SHORT") {
    return { field: "next", message: `Use at least ${minimum} characters.` };
  }
  if (error.status === 429) {
    return { field: "form", message: "Too many attempts. Wait a minute and try again." };
  }
  return { field: "form", message: "Could not change the password. Try again." };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Two rows in the final layout while the passkey list loads. */
function PasskeysSkeleton() {
  return (
    <>
      <LoadingNote>Loading passkeys</LoadingNote>
      <ul className="plist" aria-busy="true">
        {[0, 1].map((index) => (
          <li key={index} aria-hidden="true">
            <Sk width={32} height={32} className="sk-tile" />
            <span className="pbody">
              <b>
                <Sk kind="text" width={index === 0 ? 120 : 96} />
              </b>
              <span className="muted">
                <Sk kind="text" width={80} />
              </span>
            </span>
            <Sk width={64} height={30} className="sk-pill" />
          </li>
        ))}
      </ul>
    </>
  );
}

function Passkeys() {
  const list = authClient.useListPasskeys();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passkeys = list.data ?? [];
  const failed = !list.isPending && Boolean(list.error);
  const ready = !list.isPending && !failed;

  const add = async (): Promise<void> => {
    setAdding(true);
    setError(null);
    try {
      const name = passkeys.length === 0 ? "Passkey" : `Passkey ${passkeys.length + 1}`;
      const result = await authClient.passkey.addPasskey({ name });
      if (result.error) setError("Could not add the passkey. Try again.");
      else await list.refetch();
    } catch {
      setError("Could not add the passkey. Try again.");
    }
    setAdding(false);
  };
  const remove = async (id: string): Promise<void> => {
    setError(null);
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) setError("Could not remove the passkey. Try again.");
      else await list.refetch();
    } catch {
      setError("Could not remove the passkey. Try again.");
    }
  };

  return (
    <section className="dsec">
      <div className="dsec-head">
        <h3>Passkeys</h3>
        <Button
          size="sm"
          icon={<PlusIcon />}
          busy={adding}
          busyLabel="Waiting for Your Device"
          disabled={!ready}
          onClick={() => void add()}
        >
          Add Passkey
        </Button>
      </div>
      {list.isPending ? <PasskeysSkeleton /> : null}
      {failed ? (
        <ErrorNotice inline busy={list.isRefetching} onRetry={() => void list.refetch()}>
          Headroom could not load your passkeys. Check that it is running and try again.
        </ErrorNotice>
      ) : null}
      {ready && passkeys.length === 0 ? (
        <EmptyState compact icon={<FingerprintIcon />} title="No Passkeys Yet">
          Add one to sign in without a password.
        </EmptyState>
      ) : null}
      {ready && passkeys.length > 0 ? (
        <ul className="plist">
          {passkeys.map((passkey) => {
            const name = passkey.name?.trim() ? passkey.name.trim() : "Passkey";
            return (
              <li key={passkey.id}>
                <span className="pk">
                  <FingerprintIcon />
                </span>
                <span className="pbody">
                  <b>{name}</b>
                  <span className="muted">{`Added ${shortDate(passkey.createdAt.getTime())}`}</span>
                </span>
                <Button
                  variant="quiet-danger"
                  size="sm"
                  aria-label={`Remove ${name}`}
                  onClick={() => void remove(passkey.id)}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Password() {
  const setup = useLoad(() => api.setup(), "setup");
  const minimum = setup.data?.minimumPasswordLength ?? fallbackMinimum;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [currentError, setCurrentError] = useState<string | undefined>(undefined);
  const [nextError, setNextError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCurrentError(undefined);
    setNextError(undefined);
    try {
      const result = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
      });
      if (result.error) {
        const failure = passwordError(result.error, minimum);
        if (failure.field === "current") setCurrentError(failure.message);
        else if (failure.field === "next") setNextError(failure.message);
        else setError(failure.message);
        setBusy(false);
        return;
      }
    } catch {
      setError("Could not change the password. Try again.");
      setBusy(false);
      return;
    }
    setCurrent("");
    setNext("");
    setBusy(false);
    setChanged(true);
    await wait(resultMs);
    setChanged(false);
  };

  return (
    <section className="dsec">
      <div className="dsec-head">
        <h3>Password</h3>
      </div>
      <form className="pform" onSubmit={(event) => void submit(event)}>
        <PasswordField
          label="Current Password"
          name="current"
          autoComplete="current-password"
          value={current}
          error={currentError}
          onChange={(event) => {
            setCurrent(event.currentTarget.value);
            setCurrentError(undefined);
          }}
          required
        />
        <PasswordStrength
          label="New Password"
          name="next"
          autoComplete="new-password"
          minimum={minimum}
          minLength={minimum}
          value={next}
          error={nextError}
          onChange={(event) => {
            setNext(event.currentTarget.value);
            setNextError(undefined);
          }}
          required
        />
        {error === null ? null : (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <Button variant="primary" type="submit" busy={busy} busyLabel="Changing">
            {changed ? "Password Changed" : "Change Password"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Passkeys and password; the demo site has neither. The content mounts only while the dialog is open, so it loads fresh each time. */
export function AccountDialog(props: { readonly open: boolean; readonly onClose: () => void }) {
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Account">
      {props.open ? (
        <>
          {isDemoSite ? null : <Passkeys />}
          {isDemoSite ? null : <Password />}
        </>
      ) : null}
    </Dialog>
  );
}
