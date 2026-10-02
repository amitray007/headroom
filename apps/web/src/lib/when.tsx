import { useSettings } from "./settings.tsx";
import { resolveWhen, type WhenKind } from "@headroom/view-model/time";
import { useNow } from "./now.ts";

interface WhenProps {
  readonly at: number;
  readonly kind: WhenKind;
  /** Words before the time, for example "Resets". The component adds "in" for a countdown. */
  readonly prefix?: string;
}

/** An instant as a countdown or an exact time, with the other form in the hover title. */
export function When({ at, kind, prefix }: WhenProps) {
  const { settings } = useSettings();
  const now = useNow();
  const { lead, text, title } = resolveWhen(kind, at, now, settings);
  const leadIn = prefix === undefined ? "" : `${prefix}${lead === "" ? "" : ` ${lead}`} `;
  return (
    <>
      {leadIn}
      <time className="when" dateTime={new Date(at).toISOString()} title={title}>
        {text}
      </time>
    </>
  );
}
