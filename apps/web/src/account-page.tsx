import { useState, type FormEvent } from "react";

import { authClient, authErrorMessage } from "./auth.ts";
import { ErrorText } from "./components.tsx";
import { messageOf } from "./hooks.ts";

export function AccountPage(props: { readonly name: string; readonly email: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passkeyName, setPasskeyName] = useState("");

  async function addPasskey(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setStatus(null);
    try {
      const result = await authClient.passkey.addPasskey({ name: passkeyName });
      if (result.error) setError(authErrorMessage(result.error));
      else {
        setStatus("Passkey added.");
        setPasskeyName("");
      }
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function signOut(): Promise<void> {
    try {
      await authClient.signOut();
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  return (
    <main className="narrow">
      <h1>Account</h1>
      <p>
        {props.name} ({props.email})
      </p>
      <form onSubmit={(event) => void addPasskey(event)}>
        <h2>Add a passkey</h2>
        <label>
          Passkey name
          <input
            value={passkeyName}
            onChange={(event) => setPasskeyName(event.target.value)}
            required
          />
        </label>
        <button type="submit">Add passkey</button>
      </form>
      {status === null ? null : <output>{status}</output>}
      <ErrorText message={error} />
      <h2>Session</h2>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </main>
  );
}
