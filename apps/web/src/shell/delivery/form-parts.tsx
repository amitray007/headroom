import type { ReactNode } from "react";

import { Button } from "../../ui/button.tsx";
import { Fold } from "../../ui/fold.tsx";

/** The set-up form, folded away until it opens. Save and Cancel sit at its foot. */
export function FormFold(props: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly canSave: boolean;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Fold closed={!props.open}>
      <form
        className="dl-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (props.canSave) props.onSave();
        }}
      >
        {props.children}
        {props.error === null ? null : (
          <p className="form-error" role="alert">
            {props.error}
          </p>
        )}
        <div className="dl-actions">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            busy={props.busy}
            busyLabel="Saving"
            disabled={!props.canSave}
          >
            Save
          </Button>
          <Button variant="quiet" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Fold>
  );
}
