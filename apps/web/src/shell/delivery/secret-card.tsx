import { Button } from "../../ui/button.tsx";
import { CopyButton } from "../../ui/copy-button.tsx";

/** A signing secret in mono type with a Copy button. `onRegenerate` adds a Regenerate button. */
export function SecretCard(props: { readonly secret: string; readonly onRegenerate?: () => void }) {
  return (
    <div className="dl-secret">
      <span className="dl-label">Signing Secret</span>
      <div className="dl-secret-row">
        <code className="dl-secret-value">{props.secret}</code>
        <CopyButton value={props.secret} label="Copy" size="sm" />
        {props.onRegenerate === undefined ? null : (
          <Button size="sm" variant="quiet" onClick={props.onRegenerate}>
            Regenerate
          </Button>
        )}
      </div>
    </div>
  );
}
