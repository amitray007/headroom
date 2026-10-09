import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, easeInOut, mono, sans } from "./theme";

export const Backdrop: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 90% at 50% 38%, #1c1c1c 0%, ${C.bg} 52%, ${C.deep} 100%)`,
    }}
  />
);

const MONO_MARKS = new Set(["codex", "cursor", "copilot", "grok", "vercel_ai_gateway"]);

export const Mark: React.FC<{ name: string; size: number; style?: React.CSSProperties }> = ({ name, size, style }) => (
  <Img
    src={staticFile(`${name}.svg`)}
    style={{
      width: size,
      height: size,
      objectFit: "contain",
      filter: MONO_MARKS.has(name) ? "invert(0.93)" : undefined,
      // The Codex mark has more padding in its view box than the others.
      transform: name === "codex" ? "scale(1.35)" : undefined,
      ...style,
    }}
  />
);

export const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg viewBox="0 0 64 64" width={size} height={size}>
    <path
      fill="#ebebeb"
      d="M22.93 0H41.07C47.673 0 50.974 0 54.528 1.124C58.408 2.536 61.464 5.592 62.876 9.472C64 13.026 64 16.327 64 22.93V41.07C64 47.673 64 50.974 62.876 54.528C61.464 58.408 58.408 61.464 54.528 62.876C50.974 64 47.673 64 41.07 64H22.93C16.327 64 13.026 64 9.472 62.876C5.592 61.464 2.536 58.408 1.124 54.528C0 50.974 0 47.673 0 41.07V22.93C0 16.327 0 13.026 1.124 9.472C2.536 5.592 5.592 2.536 9.472 1.124C13.026 0 16.327 0 22.93 0Z"
    />
    <rect fill="#747474" x="12" y="16" width="40" height="4" rx="2" />
    <rect fill="#121212" x="12" y="28" width="28" height="8" rx="4" />
    <rect fill="#121212" x="12" y="40" width="16" height="8" rx="4" />
  </svg>
);

/** A camera keyframe: at frame `f`, put window point (x, y) at the centre of the screen, at `zoom`. */
export type Key = { f: number; x: number; y: number; zoom: number };

export function camera(frame: number, keys: Key[]) {
  const opt = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeInOut } as const;
  // Interpolate each segment with its own easing, so every move starts and ends at rest.
  let i = 0;
  while (i < keys.length - 2 && frame > keys[i + 1].f) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const range = [a.f, Math.max(b.f, a.f + 1)];
  const zoom = interpolate(frame, range, [a.zoom, b.zoom], opt);
  const x = interpolate(frame, range, [a.x, b.x], opt);
  const y = interpolate(frame, range, [a.y, b.y], opt);
  return { zoom, x, y };
}

/** The app window: a 1440 x 900 CSS-pixel viewport drawn at 1600 x 1000, scrolled by `scroll` CSS pixels. */
export const W = 1600;
export const H = 1000;
export const K = W / 1440;

export const AppWindow: React.FC<{
  src: string;
  scroll?: number;
  layers?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ src, scroll = 0, layers, style }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      top: 0,
      width: W,
      height: H,
      borderRadius: 26,
      overflow: "hidden",
      background: C.bg,
      boxShadow: "0 0 0 1px #ffffff14, 0 40px 120px #000000c0, 0 10px 30px #00000080",
      ...style,
    }}
  >
    <Img src={staticFile(src)} style={{ position: "absolute", left: 0, top: -scroll * K, width: W }} />
    {layers}
  </div>
);

/** Places a window so the camera point sits at the screen centre. */
export const Camera: React.FC<{ keys: Key[]; children: React.ReactNode; tilt?: number; lift?: number }> = ({
  keys,
  children,
  tilt = 0,
  lift = 0,
}) => {
  const frame = useCurrentFrame();
  const { zoom, x, y } = camera(frame, keys);
  return (
    <AbsoluteFill style={{ perspective: 2400 }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: H,
          transformOrigin: "0 0",
          transform: `translate(${960 - x * zoom}px, ${540 - y * zoom + lift}px) scale(${zoom}) rotateX(${tilt}deg)`,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

export const Caption: React.FC<{ text: string; opacity: number }> = ({ text, opacity }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 64,
      display: "flex",
      justifyContent: "center",
      opacity,
    }}
  >
    <div
      style={{
        maxWidth: 1320,
        padding: "14px 26px",
        borderRadius: 18,
        background: "#0a0a0acc",
        border: "1px solid #ffffff14",
        backdropFilter: "blur(12px)",
        color: C.text,
        fontFamily: sans,
        fontSize: 36,
        lineHeight: 1.35,
        letterSpacing: "-0.01em",
        textAlign: "center",
      }}
    >
      {text}
    </div>
  </div>
);

export const Label: React.FC<{ index: string; title: string; opacity: number }> = ({ index, title, opacity }) => (
  <div style={{ position: "absolute", left: 72, top: 60, opacity, display: "flex", gap: 16, alignItems: "baseline" }}>
    <span style={{ fontFamily: mono, fontSize: 22, color: C.dim, letterSpacing: "0.04em" }}>{index}</span>
    <span style={{ fontFamily: sans, fontSize: 30, fontWeight: 500, color: C.text, letterSpacing: "-0.02em" }}>{title}</span>
  </div>
);
