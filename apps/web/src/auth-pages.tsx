import { useState, type FormEvent } from "react";

import { api } from "./api.ts";
import { authClient, authErrorMessage } from "./auth.ts";
import { ErrorText } from "./components.tsx";
import { messageOf, useLoad } from "./hooks.ts";
import { navigate } from "./router.ts";

function SetupForm(props: { readonly minPassword: number; readonly minUsername: number }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string): string => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.signUp.email({
        name: text("name"),
        email: text("email"),
        username: text("username"),
        password: text("password"),
      });
      if (result.error) setError(authErrorMessage(result.error));
      else navigate({ page: "connections" });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h1>Set up Headroom</h1>
      <p>Create the owner account. Only one account can exist.</p>
      <label>
        Name
        <input name="name" autoComplete="name" required />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Username
        <input name="username" autoComplete="username" minLength={props.minUsername} required />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={props.minPassword}
          required
        />
      </label>
      <p className="hint">At least {props.minPassword} characters.</p>
      <button type="submit" disabled={busy}>
        Create account
      </button>
      <ErrorText message={error} />
    </form>
  );
}

function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = form.get("username");
    const password = form.get("password");
    if (typeof username !== "string" || typeof password !== "string") return;
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.signIn.username({ username, password });
      if (result.error) setError(authErrorMessage(result.error));
      else navigate({ page: "connections" });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function passkey(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.signIn.passkey();
      if (result.error) setError(authErrorMessage(result.error));
      else navigate({ page: "connections" });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={(event) => void submit(event)}>
        <h1>Sign in</h1>
        <label>
          Username
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit" disabled={busy}>
          Sign in
        </button>
      </form>
      <p>
        <button type="button" disabled={busy} onClick={() => void passkey()}>
          Sign in with passkey
        </button>
      </p>
      <ErrorText message={error} />
    </>
  );
}

/** Shown when nobody is signed in: owner setup first, sign-in afterwards. */
export function SignedOutPage() {
  const setup = useLoad(() => api.setup(), "setup");
  if (setup.error !== null) {
    return (
      <main className="narrow">
        <ErrorText message={setup.error} />
      </main>
    );
  }
  if (setup.data === null) {
    return (
      <main className="narrow">
        <p aria-busy="true">Loading...</p>
      </main>
    );
  }
  return (
    <main className="narrow">
      {setup.data.ownerExists ? (
        <SignInForm />
      ) : (
        <SetupForm
          minPassword={setup.data.minimumPasswordLength}
          minUsername={setup.data.minimumUsernameLength}
        />
      )}
    </main>
  );
}
