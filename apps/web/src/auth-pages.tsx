import { useId, useState, type FormEvent, type ReactNode } from "react";

import { api } from "./api.ts";
import { authClient, authErrorMessage } from "./auth.ts";
import "./auth-pages.css";
import { messageOf, useLoad } from "./lib/load.ts";
import { AlertIcon, FingerprintIcon } from "./icons.tsx";
import { Button } from "./ui/button.tsx";
import { EmptyState } from "./ui/empty-state.tsx";
import { Lockup } from "./ui/lockup.tsx";
import { PasswordField } from "./ui/password-field.tsx";
import { PasswordStrength } from "./ui/password-strength.tsx";
import { LoadingNote, Sk } from "./ui/skeleton.tsx";

/** Signing in changes the session; the app then shows the dashboard at the root. */
function openDashboard(): void {
  window.location.hash = "#/";
}

/** The centred page: logo, then one card. */
function AuthFrame(props: {
  readonly title: string;
  readonly note?: string;
  readonly children: ReactNode;
}) {
  return (
    <main className="auth">
      <Lockup />
      <section className="panel auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title">{props.title}</h1>
        {props.note === undefined ? null : <p className="secondary">{props.note}</p>}
        {props.children}
      </section>
    </main>
  );
}

/** The sign-in card in its final layout. Shown while the session or the owner check is pending. */
export function AuthSkeleton() {
  return (
    <main className="auth" aria-busy="true">
      <LoadingNote>Loading</LoadingNote>
      <Lockup />
      <section className="panel auth-card" aria-hidden="true">
        <h1 className="sk-slot">
          <Sk kind="title" width={96} />
        </h1>
        <div className="auth-form">
          {[0, 1].map((index) => (
            <div key={index} className="sk-field">
              <Sk width={index === 0 ? 72 : 64} />
              <Sk className="sk-input" />
            </div>
          ))}
          <Sk className="sk-button" />
        </div>
        <div className="auth-or">
          <span>or</span>
        </div>
        <Sk className="sk-button" />
      </section>
    </main>
  );
}

/** Headroom could not be reached, or refused to answer: a centred tile with plain words and Try Again. */
export function Unreachable(props: {
  readonly task: string;
  /** HTTP status of the failure, when the server answered. */
  readonly status: number | null;
  readonly busy: boolean;
  readonly onRetry: () => void;
}) {
  const limited = props.status === 429;
  return (
    <main className="auth">
      <Lockup />
      <EmptyState
        icon={<AlertIcon />}
        title={limited ? "Too Many Attempts" : "Cannot Reach Headroom"}
        actions={
          <Button busy={props.busy} busyLabel="Trying" onClick={props.onRetry}>
            Try Again
          </Button>
        }
      >
        {limited
          ? "Headroom is slowing requests down. Wait a minute, then try again."
          : `Headroom could not ${props.task}. Check that it is running and try again.`}
      </EmptyState>
    </main>
  );
}

function Field(props: {
  readonly name: string;
  readonly label: string;
  readonly type?: string;
  readonly autoComplete: string;
  readonly minLength?: number;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        minLength={props.minLength}
        required
      />
    </div>
  );
}

function ErrorLine(props: { readonly message: string | null }) {
  return props.message === null ? null : (
    <p className="auth-error" role="alert">
      {props.message}
    </p>
  );
}

function SetupForm(props: { readonly minPassword: number; readonly minUsername: number }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");

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
      else openDashboard();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Set Up Headroom" note="Create the owner account. Only one account can exist.">
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <Field name="name" label="Name" autoComplete="name" />
        <Field name="email" label="Email" type="email" autoComplete="email" />
        <Field
          name="username"
          label="Username"
          autoComplete="username"
          minLength={props.minUsername}
        />
        <PasswordStrength
          name="password"
          label="Password"
          autoComplete="new-password"
          minimum={props.minPassword}
          minLength={props.minPassword}
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          required
        />
        <ErrorLine message={error} />
        <Button type="submit" variant="primary" busy={busy} busyLabel="Creating Account">
          Create Account
        </Button>
      </form>
    </AuthFrame>
  );
}

function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"password" | "passkey" | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = form.get("username");
    const password = form.get("password");
    if (typeof username !== "string" || typeof password !== "string") return;
    setBusy("password");
    setError(null);
    try {
      const result = await authClient.signIn.username({ username, password });
      if (result.error) setError(authErrorMessage(result.error));
      else openDashboard();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  }

  async function passkey(): Promise<void> {
    setBusy("passkey");
    setError(null);
    try {
      const result = await authClient.signIn.passkey();
      if (result.error) setError(authErrorMessage(result.error));
      else openDashboard();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthFrame title="Sign In">
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <Field name="username" label="Username" autoComplete="username webauthn" />
        <PasswordField name="password" label="Password" autoComplete="current-password" required />
        <ErrorLine message={error} />
        <Button
          type="submit"
          variant="primary"
          busy={busy === "password"}
          busyLabel="Signing In"
          disabled={busy !== null}
        >
          Sign In
        </Button>
      </form>
      <div className="auth-or" aria-hidden="true">
        <span>or</span>
      </div>
      <Button
        icon={<FingerprintIcon />}
        busy={busy === "passkey"}
        busyLabel="Waiting for Passkey"
        disabled={busy !== null}
        onClick={() => void passkey()}
      >
        Sign In With Passkey
      </Button>
    </AuthFrame>
  );
}

/** Shown when nobody is signed in: owner setup first, sign-in afterwards. */
export function SignedOutPage() {
  const setup = useLoad(() => api.setup(), "setup");
  if (setup.data === null) {
    return setup.error === null ? (
      <AuthSkeleton />
    ) : (
      <Unreachable
        task="load the sign-in page"
        status={setup.status}
        busy={setup.pending}
        onRetry={setup.reload}
      />
    );
  }
  return setup.data.ownerExists ? (
    <SignInForm />
  ) : (
    <SetupForm
      minPassword={setup.data.minimumPasswordLength}
      minUsername={setup.data.minimumUsernameLength}
    />
  );
}
