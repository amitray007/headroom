import { useState, type ReactNode } from "react";

import type { Provider } from "@headroom/core/contracts";

import antigravityUrl from "./assets/antigravity.svg";
import avatarUrl from "./assets/avatar.svg";
import { avatarSrc } from "./lib/avatar.ts";
import claudeUrl from "./assets/claude.svg";
import codexRaw from "./assets/codex.svg?raw";
import copilotRaw from "./assets/copilot.svg?raw";
import cursorRaw from "./assets/cursor.svg?raw";
import grokRaw from "./assets/grok.svg?raw";
import vercelRaw from "./assets/vercel_ai_gateway.svg?raw";
import { inlineSvg } from "./ui/inline-svg.ts";

interface IconProps {
  readonly className?: string;
}

/** A 24 by 24 stroke icon that takes its colour from the surrounding text. */
function stroke(children: ReactNode, width = 2) {
  return function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={props.className}
      >
        {children}
      </svg>
    );
  };
}

export const ClockIcon = stroke(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const PauseIcon = stroke(
  <>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </>,
);
export const AlertIcon = stroke(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4M12 16h.01" />
  </>,
);
export const PartialIcon = stroke(<circle cx="12" cy="12" r="9" strokeDasharray="4.2 3.2" />);
export const RetryIcon = stroke(
  <>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v6h-6" />
  </>,
);
export const ResetIcon = stroke(
  <>
    <path d="M3 12a9 9 0 1 0 2.6-6.4" />
    <path d="M3 3v6h6" />
  </>,
);
export const PlusIcon = stroke(<path d="M12 5v14M5 12h14" />);
export const PlugIcon = stroke(<path d="M12 22v-5M9 8V2M15 8V2M6 8h12v5a6 6 0 0 1-12 0V8z" />);
export const KeyIcon = stroke(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="m10.9 12.1 9.1-9.1M15 7l3 3" />
  </>,
);
export const SignOutIcon = stroke(
  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
);
export const ExternalIcon = stroke(
  <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />,
);
export const CopyIcon = stroke(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </>,
);
/** Pass className="check" to draw the tick in. */
export const CheckIcon = stroke(<path d="m5 12 5 5 9-10" />, 2.2);
export const TerminalIcon = stroke(<path d="m4 17 6-6-6-6M12 19h8" />);
export const LinkIcon = stroke(
  <>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19" />
  </>,
);
export const HashIcon = stroke(<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />);
export const GearIcon = stroke(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>,
);
export const InfoIcon = stroke(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </>,
);
export const BellIcon = stroke(
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
  </>,
);
export const CloseIcon = stroke(<path d="M18 6 6 18M6 6l12 12" />);
export const PencilIcon = stroke(<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />);
export const EyeIcon = stroke(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const FingerprintIcon = stroke(
  <>
    <path d="M12 10a2 2 0 0 0-2 2c0 1.5-.5 3.5-1.5 5" />
    <path d="M14 13.1c0 2.3-.5 4.2-1.2 5.9" />
    <path d="M17.3 12c0 2.4-.3 4.5-.9 6" />
    <path d="M6.1 16.8A10 10 0 0 1 5.6 12a6.4 6.4 0 0 1 12.8 0" />
    <path d="M8.6 9.4A3.4 3.4 0 0 1 12 8.6" />
  </>,
);
export const TrashIcon = stroke(<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />);
export const UserIcon = stroke(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </>,
);
export const PlayIcon = stroke(<path d="M7 5v14l12-7z" />);
export const UnplugIcon = stroke(
  <>
    <path d="M19 5l-3 3M9.5 14.5 5 19M15 12l-3 3M12 9l3-3M9 12l3 3" />
    <path d="M7 11.5 12.5 17a3 3 0 0 0 4.2-4.2L11 7.3A3 3 0 0 0 7 11.5z" />
  </>,
);
export const DotsIcon = stroke(
  <>
    <circle cx="5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="19" cy="12" r="1.2" />
  </>,
);
export const SparkleIcon = stroke(
  <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M5.6 18.4l2.2-2.2M16.2 7.8l2.2-2.2" />,
);

type Mark =
  | { readonly kind: "image"; readonly url: string }
  | { readonly kind: "inline"; readonly svg: string };

/** Colour marks (Claude, Antigravity) keep their own colours as images. Single-colour marks follow the text colour inline. */
const marks: Record<Provider, Mark> = {
  claude: { kind: "image", url: claudeUrl },
  codex: { kind: "inline", svg: inlineSvg(codexRaw, true) },
  cursor: { kind: "inline", svg: inlineSvg(cursorRaw, true) },
  copilot: { kind: "inline", svg: inlineSvg(copilotRaw, true) },
  grok: { kind: "inline", svg: inlineSvg(grokRaw, true) },
  antigravity: { kind: "image", url: antigravityUrl },
  vercel_ai_gateway: { kind: "inline", svg: inlineSvg(vercelRaw, true) },
};

/** Provider brand mark: 20 px by default, 24 px with size={24}. Decorative; name the provider in text. */
export function BrandMark(props: { readonly provider: Provider; readonly size?: 20 | 24 }) {
  const mark = marks[props.provider];
  const className = props.size === 24 ? "brand lg" : "brand";
  if (mark.kind === "image") {
    return (
      <span className={className}>
        <img src={mark.url} alt="" />
      </span>
    );
  }
  // The markup is a bundled static asset, never user input.
  return <span className={className} dangerouslySetInnerHTML={{ __html: mark.svg }} />;
}

/** The seeded DiceBear face, laid over the local one once it has loaded. Offline, the local one stays. */
function RemoteFace(props: { readonly src: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  if (state === "failed") return null;
  return (
    <img
      src={props.src}
      alt=""
      width={34}
      height={34}
      data-loaded={state === "loaded" ? "true" : undefined}
      onLoad={() => setState("loaded")}
      onError={() => setState("failed")}
    />
  );
}

/**
 * The account face. The bundled identicon is always there, so the box never changes size; the DiceBear face for
 * `seed` (the owner's username) fades in over it when it loads. Without a seed only the bundled face shows.
 */
export function Avatar(props: { readonly seed?: string | null }) {
  const remote = props.seed === undefined || props.seed === null ? null : avatarSrc(props.seed);
  return (
    <span className="avatar-face">
      <img src={avatarUrl} alt="" width={34} height={34} />
      {remote === null ? null : <RemoteFace key={remote} src={remote} />}
    </span>
  );
}

/** Six dots in two columns: the grip that starts a drag. */
export function GripIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={props.className}
    >
      {[8, 12, 16].flatMap((cy) => [
        <circle key={`l${cy}`} cx="9" cy={cy} r="1.5" />,
        <circle key={`r${cy}`} cx="15" cy={cy} r="1.5" />,
      ])}
    </svg>
  );
}

/** A down chevron; rotate it for an open state. */
export const ChevronDownIcon = stroke(<path d="m6 9 6 6 6-6" />);

/** Up and down arrows: reorder. */
export const ReorderIcon = stroke(<path d="m3 16 4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16" />);
