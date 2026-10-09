import { useState } from "react";

import { api } from "../../api.ts";
import { ExternalIcon } from "../../icons.tsx";
import { Button, ButtonLink } from "../../ui/button.tsx";
import { PasswordField } from "../../ui/password-field.tsx";
import { Problem } from "./form-parts.tsx";
import { botCheckProblem, codeOf } from "./status.ts";
import { botTokenProblem, isBotToken } from "./validate.ts";

/** Step 1 of Telegram: make a bot with BotFather and check its token. */
export function TelegramBotStep(props: {
  /** In change mode, the bot of the saved channel can stay. */
  readonly keepName: string | null;
  /** The token typed before, when the owner comes back to this step. */
  readonly initial: string;
  readonly onKeep: () => void;
  readonly onVerified: (botToken: string, username: string) => void;
  readonly onCancel: (() => void) | null;
}) {
  const [token, setToken] = useState(props.initial);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const clean = token.trim();
  const shapeOk = isBotToken(clean);
  const shapeError = touched && clean !== "" && !shapeOk ? botTokenProblem : undefined;

  const verify = async (): Promise<void> => {
    if (!shapeOk) {
      setTouched(true);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const found = await api.checkBot(clean);
      props.onVerified(clean, found.bot.username);
    } catch (cause) {
      setProblem(botCheckProblem(codeOf(cause)));
      setBusy(false);
    }
  };

  return (
    <form
      className="dl-form"
      onSubmit={(event) => {
        event.preventDefault();
        void verify();
      }}
    >
      <ol className="dl-howto">
        <li>
          <span className="dl-howto-row">
            <span>Open @BotFather in Telegram.</span>
            <ButtonLink
              size="sm"
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer noopener"
              icon={<ExternalIcon />}
            >
              Open BotFather
            </ButtonLink>
          </span>
        </li>
        <li>Send /newbot and follow the steps.</li>
        <li>Paste the token it gives you.</li>
      </ol>
      <PasswordField
        label="Bot Token"
        value={token}
        error={shapeError}
        autoComplete="off"
        onChange={(event) => {
          setToken(event.currentTarget.value);
          setProblem(null);
        }}
        onBlur={() => setTouched(true)}
      />
      <Problem>{problem}</Problem>
      <div className="dl-actions">
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          busyLabel="Verifying"
          disabled={!shapeOk}
        >
          Verify Token
        </Button>
        {props.keepName === null ? null : (
          <Button variant="quiet" disabled={busy} onClick={props.onKeep}>
            {`Keep ${props.keepName}`}
          </Button>
        )}
        {props.onCancel === null ? null : (
          <Button variant="quiet" disabled={busy} onClick={props.onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
