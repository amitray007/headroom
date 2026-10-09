import React from "react";
import { useSceneFrame } from "./clock";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useVideoConfig } from "remotion";
import { C, easeInOut, easeOut, fade, rise, s, sans } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
type Rect = [number, number, number, number];

const bell = (f: number, a: number, b: number, len = 12) =>
  interpolate(f, [a, a + len, b - len, b], [0, 1, 1, 0], { ...clamp, easing: easeInOut });

/**
 * One captured component, placed and held still. Sizes are in the component's CSS pixels (`cw` x `ch`), drawn at
 * width `w`. `pieces` split it into parts that rise in one after another. `lift` raises one part while the others
 * step back. `sheen` runs one soft light across it.
 */
const Shot: React.FC<{
  src: string;
  cw: number;
  ch: number;
  w: number;
  x: number;
  y: number;
  at: number;
  out?: number;
  crop?: number;
  pieces?: Rect[];
  stagger?: number;
  lift?: { index: number; a: number; b: number };
  sheen?: number;
  wipe?: boolean;
  radius?: number;
  shadow?: boolean;
}> = ({ src, cw, ch, w, x, y, at, out, crop, pieces, stagger = 4, lift, sheen, wipe, radius = 20, shadow = true }) => {
  const f = useSceneFrame();
  const k = w / cw;
  const h = (crop ?? ch) * k;
  const shown = fade(f, at, 20) * (out === undefined ? 1 : interpolate(f, [out, out + 12], [1, 0], clamp));
  const lifted = lift ? bell(f, lift.a, lift.b) : 0;
  const reveal = wipe ? interpolate(f, [at, at + 40], [0, 1], { ...clamp, easing: easeOut }) : 1;
  const px = (n: number) => `${Math.max(0, n).toFixed(2)}px`;
  // Insets are measured from the card's edges, which a crop moves above the image's bottom.
  const clip = (r: Rect) => `inset(${px(r[1] * k)} ${px(w - (r[0] + r[2]) * k)} ${px(h - (r[1] + r[3]) * k)} ${px(r[0] * k)})`;
  const img = <Img src={staticFile(src)} style={{ position: "absolute", left: 0, top: 0, width: w, height: ch * k }} />;
  const sweep = sheen === undefined ? -1 : interpolate(f, [sheen, sheen + 40], [-0.3, 1.3], { ...clamp, easing: easeInOut });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        opacity: shown,
        transform: pieces ? undefined : `translateY(${rise(f, at, 26, 24)}px)`,
        borderRadius: radius,
        clipPath: wipe ? `inset(0 ${(1 - reveal) * 100}% 0 0 round ${radius}px)` : undefined,
        boxShadow: shadow ? "0 40px 100px rgba(0,0,0,0.5)" : undefined,
      }}
    >
      <div style={{ position: "absolute", inset: 0, borderRadius: radius, overflow: pieces ? "visible" : "hidden" }}>
        {pieces
          ? pieces.map((r, i) => {
              const t = interpolate(f, [at + i * stagger, at + i * stagger + 20], [0, 1], { ...clamp, easing: easeOut });
              const mine = lift?.index === i;
              const cx = (r[0] + r[2] / 2) * k;
              const cy = (r[1] + r[3] / 2) * k;
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    inset: 0,
                    clipPath: clip(r),
                    opacity: t * (mine ? 1 : 1 - 0.5 * lifted),
                    transformOrigin: `${cx}px ${cy}px`,
                    transform: `translateY(${(1 - t) * 18}px) scale(${mine ? 1 + 0.018 * lifted : 1})`,
                    filter: mine && lifted > 0 ? `brightness(${1 + 0.18 * lifted})` : undefined,
                    zIndex: mine ? 2 : 1,
                  }}
                >
                  {img}
                </div>
              );
            })
          : img}
        {sheen !== undefined && sweep > -0.3 && sweep < 1.3 ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: radius,
              overflow: "hidden",
              mixBlendMode: "screen",
              background: `linear-gradient(100deg, rgba(255,255,255,0) ${(sweep - 0.18) * 100}%, rgba(255,255,255,0.09) ${sweep * 100}%, rgba(255,255,255,0) ${(sweep + 0.18) * 100}%)`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
};

/** A short headline above the component, centred. */
const Title: React.FC<{ text: string; at: number; out?: number; y?: number; size?: number }> = ({ text, at, out, y = 96, size = 60 }) => {
  const f = useSceneFrame();
  const o = fade(f, at, 18) * (out === undefined ? 1 : interpolate(f, [out, out + 12], [1, 0], clamp));
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: y,
        textAlign: "center",
        opacity: o,
        transform: `translateY(${rise(f, at, 22, 18)}px)`,
        fontFamily: sans,
        fontSize: size,
        fontWeight: 500,
        letterSpacing: "-0.035em",
        color: C.text,
      }}
    >
      {text}
    </div>
  );
};

const sceneFade = (f: number, len: number) => fade(f, 0, 10) * interpolate(f, [len - 10, len], [1, 0], clamp);

/* The first account panel in its own CSS pixels: header, four figure columns, actions. */
const PANEL = { cw: 992, ch: 287.5 };
const PANEL_PIECES: Rect[] = [
  [0, 0, 992, 88],
  [0, 88, 260, 124],
  [260, 88, 244, 124],
  [504, 88, 244, 124],
  [748, 88, 244, 124],
  [0, 212, 992, 75.5],
];

export const Overview: React.FC = () => {
  const f = useSceneFrame();
  const swap = s(2.4);
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, s(9)) }}>
      {/* The whole app first, small enough to sit clear of the captions. */}
      <Shot src="c/hero.png" cw={1440} ch={900} w={1248} x={336} y={70} at={0} out={swap - 8} radius={18} sheen={18} />
      <Title text="Every limit, on one panel." at={swap + 4} y={150} />
      <Shot src="c/panel1.png" {...PANEL} w={1600} x={160} y={330} at={swap} pieces={PANEL_PIECES} stagger={7} sheen={swap + s(2.6)} />
    </AbsoluteFill>
  );
};

const ROWS: Rect[] = [
  [0, 0, 992, 76],
  [0, 76, 992, 76],
  [0, 152, 992, 95],
  [0, 247, 992, 76],
  [0, 323, 992, 76],
];

export const DetailedCompare: React.FC = () => {
  const f = useSceneFrame();
  const swap = s(3.8);
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, s(8)) }}>
      <Title text="Closest to the limit, first." at={4} out={swap - 10} />
      <Shot src="c/detailed.png" cw={992} ch={551} w={1400} x={260} y={230} crop={399} at={6} out={swap - 10} pieces={ROWS} shadow={false} lift={{ index: 0, a: s(1.9), b: swap }} />
      <Title text="Which account to use next." at={swap + 2} />
      <Shot
        src="c/compare.png"
        cw={992}
        ch={292}
        w={1500}
        x={210}
        y={290}
        at={swap}
        pieces={[
          [0, 0, 992, 64],
          [0, 64, 992, 228],
        ]}
        shadow={false}
        lift={{ index: 0, a: swap + s(1.5), b: s(8) + 12 }}
      />
    </AbsoluteFill>
  );
};

export const Timeline: React.FC = () => {
  const f = useSceneFrame();
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, s(6)) }}>
      <Title text="When headroom comes back." at={4} />
      <Shot src="c/timeline.png" cw={992} ch={560} w={1300} x={310} y={220} crop={480} at={6} wipe radius={18} sheen={s(2.4)} />
    </AbsoluteFill>
  );
};

export const Wallet: React.FC = () => {
  const f = useSceneFrame();
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, s(5)) }}>
      <Title text="What it all costs." at={4} />
      <Shot
        src="c/wallet-totals.png"
        cw={992}
        ch={120}
        w={1300}
        x={310}
        y={225}
        at={6}
        radius={16}
        shadow={false}
        pieces={[0, 1, 2, 3].map((i): Rect => [i * 248, 0, 248, 120])}
        lift={{ index: 3, a: s(2.4), b: s(5) + 12 }}
      />
      <Shot src="c/wallet-spend.png" cw={992} ch={380} w={1300} x={310} y={410} crop={360} at={24} radius={16} />
    </AbsoluteFill>
  );
};

/* Icons in the app's own stroke style (apps/web/src/icons.tsx): 24 x 24, round caps, current colour. */
const icon = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width={30} height={30} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
/** The app's ResetIcon, as on Hold to Reset Limits. */
const ResetIcon = icon(
  <>
    <path d="M3 12a9 9 0 1 0 2.6-6.4" />
    <path d="M3 3v6h6" />
  </>,
);
const WalletIcon = icon(
  <>
    <path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2" />
    <path d="M3 6v12a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-3" />
  </>,
);
const GaugeIcon = icon(
  <>
    <path d="m12 14 4-4" />
    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
  </>,
);

/* A list item that rises in, with its icon on a quiet tile. */
const Item: React.FC<{ glyph: React.ReactNode; title: string; at: number; y: number; x: number }> = ({ glyph, title, at, y, x }) => {
  const f = useSceneFrame();
  return (
    <div style={{ position: "absolute", left: x, top: y, display: "flex", alignItems: "center", gap: 22, opacity: fade(f, at, 16), transform: `translateY(${rise(f, at, 20, 16)}px)` }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, display: "grid", placeItems: "center", background: "#161616", border: "1px solid #2e2e2e", boxShadow: "inset 0 1px 0 #ffffff0d", color: C.text }}>{glyph}</div>
      <div style={{ fontFamily: sans, fontSize: 33, color: C.text, letterSpacing: "-0.02em" }}>{title}</div>
    </div>
  );
};

export const Alerts: React.FC = () => {
  const f = useSceneFrame();
  const swap = s(4.3);
  const pulse = interpolate(f, [s(6.8), s(7.8)], [0, 1], clamp);
  const ruleW = 660;
  const k = ruleW / 534;
  const sw: Rect = [480, 32, 42, 24];
  const out = (a: number) => fade(f, a, 16) * interpolate(f, [swap - 10, swap], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, s(9)) }}>
      {/* Alerts: the notification panel and what it covers. */}
      <Shot src="c/notifications.png" cw={400} ch={560} w={520} x={300} y={150} crop={540} at={4} out={swap - 10} radius={18} />
      <div style={{ position: "absolute", left: 920, top: 330, opacity: out(16), transform: `translateY(${rise(f, 16, 22, 18)}px)` }}>
        <div style={{ fontFamily: sans, fontSize: 64, fontWeight: 500, letterSpacing: "-0.035em", color: C.text }}>Told before you hit the wall.</div>
      </div>
      {["Low limits and expiring resets", "Budgets and on-demand spend", "Broken sign-ins"].map((t, i) => (
        <div key={t} style={{ position: "absolute", left: 924, top: 446 + i * 52, opacity: out(30 + i * 6), fontFamily: sans, fontSize: 32, color: C.muted, letterSpacing: "-0.01em" }}>
          {t}
        </div>
      ))}
      <div style={{ position: "absolute", left: 924, top: 630, opacity: out(54), fontFamily: sans, fontSize: 26, color: C.dim }}>In the app, on Telegram or by webhook.</div>

      {/* Automations: what they do, and one real rule. */}
      <AbsoluteFill style={{ opacity: f >= swap ? 1 : 0 }}>
        <Title text="Automations, on your terms." at={swap + 2} y={150} />
        <Item glyph={ResetIcon} title="Use a banked Codex reset before you run out" at={swap + 14} x={150} y={350} />
        <Item glyph={WalletIcon} title="Log credit top-ups in the Wallet" at={swap + 22} x={150} y={440} />
        <Item glyph={GaugeIcon} title="Warn you when spend nears a budget" at={swap + 30} x={150} y={530} />
        <div style={{ position: "absolute", left: 150, top: 640, opacity: fade(f, swap + 44, 16), fontFamily: sans, fontSize: 26, color: C.dim }}>
          Account actions stay off until you allow them.
        </div>
        <Shot src="c/rule.png" cw={534} ch={156} w={ruleW} x={1110} y={390} at={swap + 18} radius={20} />
        <div
          style={{
            position: "absolute",
            left: 1110 + (sw[0] + sw[2] / 2) * k - 46,
            top: 390 + (sw[1] + sw[3] / 2) * k - 30,
            width: 92,
            height: 60,
            borderRadius: 40,
            border: `2px solid ${C.green}`,
            opacity: pulse > 0 && pulse < 1 ? 0.9 * (1 - pulse) : 0,
            transform: `scale(${1 + pulse * 0.6})`,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const PhonePrivacy: React.FC = () => {
  const f = useSceneFrame();
  const { fps } = useVideoConfig();
  const swap = s(2.2);
  const inPhone = spring({ frame: f - 2, fps, config: { damping: 22, mass: 1 } });
  const phoneOut = interpolate(f, [swap - 10, swap], [1, 0], clamp);
  const scroll = interpolate(f, [s(0.5), s(2.1)], [0, 420], { ...clamp, easing: easeInOut });
  const blur = interpolate(f, [s(4.0), s(4.6)], [0, 1], { ...clamp, easing: easeInOut });
  const PW = 380;
  const PH = 800;
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, s(6)) }}>
      <AbsoluteFill style={{ opacity: phoneOut }}>
        <div
          style={{
            position: "absolute",
            left: 380,
            top: 110 + (1 - inPhone) * 60,
            opacity: inPhone,
            width: PW,
            height: PH,
            borderRadius: 54,
            padding: 12,
            background: "#0b0b0c",
            boxShadow: "0 0 0 1px #ffffff1f, 0 50px 120px #000",
          }}
        >
          <div style={{ width: "100%", height: "100%", borderRadius: 42, overflow: "hidden", position: "relative", background: C.bg }}>
            <Img src={staticFile("c/mobile.png")} style={{ position: "absolute", left: 0, top: (-scroll * (PW - 24)) / 390, width: PW - 24 }} />
          </div>
        </div>
        <div style={{ position: "absolute", left: 900, top: 420, opacity: fade(f, 14, 18), transform: `translateY(${rise(f, 14, 22, 18)}px)` }}>
          <div style={{ fontFamily: sans, fontSize: 64, fontWeight: 500, letterSpacing: "-0.035em", color: C.text }}>On your phone.</div>
          <div style={{ marginTop: 18, fontFamily: sans, fontSize: 30, color: C.muted }}>The same dashboard, laid out for a small screen.</div>
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: 1 - phoneOut }}>
        <Title text="Privacy Mode blurs emails." at={swap + 2} y={150} />
        <Shot src="c/panel1.png" {...PANEL} w={1600} x={160} y={330} at={swap} />
        <div style={{ opacity: blur }}>
          <Shot src="c/panel1-private.png" {...PANEL} w={1600} x={160} y={330} at={swap} shadow={false} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
