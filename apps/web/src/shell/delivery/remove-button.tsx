import { useEffect, useRef, useState } from "react";

import { Button } from "../../ui/button.tsx";

/** Remove, in two steps: the first press asks, the second confirms. The question lapses after a few seconds. */
export function RemoveButton(props: { readonly onRemove: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const press = (): void => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    clearTimeout(timer.current);
    setBusy(true);
    void props.onRemove().finally(() => {
      setBusy(false);
      setArmed(false);
    });
  };
  return (
    <Button
      size="sm"
      variant="quiet-danger"
      busy={busy}
      busyLabel="Removing"
      onClick={press}
      onBlur={() => {
        if (!busy) setArmed(false);
      }}
    >
      {armed ? "Confirm Remove" : "Remove"}
    </Button>
  );
}
