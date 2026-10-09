import React from "react";
import { useSceneFrame } from "./clock";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { AppWindow, Camera, K, Label, Logo, Mark } from "./parts";
import { C, easeInOut, easeOut, fade, mono, rise, s, sans } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const headline: React.CSSProperties = {
  fontFamily: sans,
  fontSize: 92,
  fontWeight: 500,
  letterSpacing: "-0.035em",
  lineHeight: 1.04,
  color: C.text,
  textAlign: "center",
};

/* S1: four reset rings, each counting down at its own speed. */
const RINGS = [
  { name: "claude", label: "Claude", start: 0.72, speed: 0.0016, sub: (p: number) => `resets in ${Math.max(1, Math.round(p * 4.4))} h ${String(Math.round((p * 263) % 60)).padStart(2, "0")} min` },
  { name: "codex", label: "Codex", start: 0.38, speed: 0.0007, sub: () => "resets in 4 days" },
  { name: "cursor", label: "Cursor", start: 0.9, speed: 0.0003, sub: () => "cycle ends in 22 days" },
  { name: "copilot", label: "Copilot", start: 0.55, speed: 0.0011, sub: () => "resets on the 1st" },
];

const Ring: React.FC<{ i: number; frame: number }> = ({ i, frame }) => {
  const r = RINGS[i];
  const at = 14 + i * 9;
  const drawn = interpolate(frame, [at, at + 30], [0, 1], { ...clamp, easing: easeOut });
  const left = Math.max(0.05, r.start - Math.max(0, frame - at - 30) * r.speed * 3);
  const p = left * drawn;
  const R = 92;
  const len = 2 * Math.PI * R;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, opacity: fade(frame, at, 14), transform: `translateY(${rise(frame, at)}px)` }}>
      <div style={{ position: "relative", width: 230, height: 230 }}>
        <svg viewBox="0 0 230 230" width={230} height={230} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={115} cy={115} r={R} fill="none" stroke="#2a2a2a" strokeWidth={9} />
          <circle cx={115} cy={115} r={R} fill="none" stroke={C.text} strokeWidth={9} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - p)} />
        </svg>
        <Mark name={r.name} size={56} style={{ position: "absolute", left: 87, top: 87 }} />
      </div>
      <div style={{ fontFamily: sans, fontSize: 32, fontWeight: 500, color: C.text }}>{r.label}</div>
      <div style={{ fontFamily: mono, fontSize: 22, color: C.muted }}>{r.sub(left)}</div>
    </div>
  );
};

export const Hook: React.FC = () => {
  const f = useSceneFrame();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 70, flexDirection: "column" }}>
      <div style={{ ...headline, opacity: fade(f, 4, 20), transform: `translateY(${rise(f, 4, 26)}px)` }}>You pay for all of these.</div>
      <div style={{ display: "flex", gap: 84 }}>
        {RINGS.map((_, i) => (
          <Ring key={i} i={i} frame={f} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

/* S2: seven dashboards pile up. */
const TABS: [string, string][] = [
  ["claude", "claude.ai / usage"],
  ["codex", "chatgpt.com / codex"],
  ["cursor", "cursor.com / dashboard"],
  ["copilot", "github.com / copilot"],
  ["grok", "grok.com / settings"],
  ["antigravity", "antigravity / quota"],
  ["vercel_ai_gateway", "vercel.com / ai-gateway"],
];
const SPOTS = [
  [-560, -250, -7], [-80, -300, 4], [420, -230, -3], [-420, -60, 5], [160, -90, -6], [560, -20, 3], [-140, 110, -2],
];

export const Problem: React.FC = () => {
  const f = useSceneFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(f, [s(5.2), s(6)], [1, 0], { ...clamp, easing: easeInOut });
  const gather = interpolate(f, [s(5.0), s(6)], [0, 1], { ...clamp, easing: easeInOut });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      {TABS.map(([name, text], i) => {
        const at = 6 + i * 6;
        const sp = spring({ frame: f - at, fps, config: { damping: 15, mass: 0.8 } });
        const [x, y, rot] = SPOTS[i];
        const drift = Math.sin((f + i * 20) / 30) * 4;
        return (
          <div
            key={name}
            style={{
              position: "absolute",
              left: 960,
              top: 430,
              transform: `translate(-50%, -50%) translate(${x * (1 - gather)}px, ${(y - 260 * (1 - sp)) * (1 - gather) + drift}px) rotate(${rot * (1 - gather)}deg) scale(${1 - 0.7 * gather})`,
              opacity: Math.min(1, sp * 1.4) * (1 - gather),
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "20px 28px",
              border: `1px solid ${C.border}`,
              background: C.surface,
              borderRadius: 20,
              fontFamily: mono,
              fontSize: 26,
              color: C.muted,
              boxShadow: "0 24px 60px #000a",
              whiteSpace: "nowrap",
            }}
          >
            <Mark name={name} size={32} />
            {text}
          </div>
        );
      })}
      <div style={{ position: "absolute", top: 640, opacity: out }}>
        <div style={{ ...headline, opacity: fade(f, 44, 20), transform: `translateY(${rise(f, 44)}px)` }}>Seven dashboards.</div>
        <div style={{ ...headline, color: "#8a8a8a", opacity: fade(f, 70, 20), transform: `translateY(${rise(f, 70)}px)` }}>
          No single view of what's left.
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* S3: the lockup. */
export const Reveal: React.FC = () => {
  const f = useSceneFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 18, mass: 0.9 } });
  const out = interpolate(f, [s(3.4), s(4)], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 40, opacity: out }}>
      <div style={{ display: "flex", alignItems: "center", gap: 34, transform: `scale(${0.86 + 0.14 * pop})`, opacity: pop }}>
        <Logo size={136} />
        <span style={{ fontFamily: sans, fontSize: 140, fontWeight: 500, letterSpacing: "-0.045em", color: C.text }}>Headroom</span>
      </div>
      <div style={{ fontFamily: sans, fontSize: 42, color: C.muted, letterSpacing: "-0.01em", opacity: fade(f, 26, 22), transform: `translateY(${rise(f, 26, 22, 16)}px)` }}>
        All your AI plans, on one screen.
      </div>
    </AbsoluteFill>
  );
};

/* Window coordinates: CSS pixels of the 1440 x 900 app times K. */
const P = (x: number, y: number) => ({ x: x * K, y: y * K });

/* S4: the overview. */
export const Overview: React.FC = () => {
  const f = useSceneFrame();
  const enter = interpolate(f, [0, 34], [0, 1], { ...clamp, easing: easeOut });
  const panel = P(720, 300);
  const cell = P(560, 290);
  return (
    <AbsoluteFill style={{ opacity: interpolate(f, [s(8.6), s(9)], [1, 0], clamp) }}>
      <Camera
        tilt={18 * (1 - enter)}
        lift={160 * (1 - enter)}
        keys={[
          { f: 0, x: 800, y: 500, zoom: 1.02 },
          { f: s(2), x: 800, y: 500, zoom: 1.02 },
          { f: s(4.6), x: panel.x, y: panel.y, zoom: 1.45 },
          { f: s(7.4), x: cell.x, y: cell.y, zoom: 1.75 },
          { f: s(9), x: cell.x + 24, y: cell.y, zoom: 1.78 },
        ]}
      >
        <AppWindow src="overview.png" style={{ opacity: enter }} />
      </Camera>
      <Label index="01" title="Overview" opacity={fade(f, 20) * interpolate(f, [s(8.2), s(8.6)], [1, 0], clamp)} />
    </AbsoluteFill>
  );
};

/* S5: Detailed, then Compare with the recommended account. */
export const DetailedCompare: React.FC = () => {
  const f = useSceneFrame();
  const swap = interpolate(f, [s(3.8), s(4.4)], [0, 1], { ...clamp, easing: easeInOut });
  const scroll = interpolate(f, [s(0.4), s(3.6)], [0, 140], { ...clamp, easing: easeInOut });
  const tag = P(830, 236 - 140);
  const rec = P(720, 195);
  const glow = interpolate(f, [s(5.6), s(6.2)], [0, 1], { ...clamp, easing: easeOut });
  return (
    <AbsoluteFill style={{ opacity: fade(f, 0, 12) * interpolate(f, [s(7.6), s(8)], [1, 0], clamp) }}>
      <Camera
        keys={[
          { f: 0, x: 800, y: 520, zoom: 1.05 },
          { f: s(1.6), x: 800, y: 520, zoom: 1.12 },
          { f: s(3.5), x: tag.x - 120, y: tag.y + 60, zoom: 1.7 },
          { f: s(4.4), x: 800, y: 420, zoom: 1.1 },
          { f: s(6.0), x: rec.x, y: rec.y + 40, zoom: 1.55 },
          { f: s(8), x: rec.x, y: rec.y + 40, zoom: 1.6 },
        ]}
      >
        <AppWindow src="detailed.png" scroll={scroll} />
        <AppWindow
          src="compare.png"
          style={{ opacity: swap, boxShadow: "none" }}
          layers={
            <div
              style={{
                position: "absolute",
                left: 226 * K,
                top: 172 * K,
                width: 988 * K,
                height: 30 * K,
                borderRadius: 14,
                boxShadow: `0 0 0 ${2 + 2 * glow}px ${C.green}${Math.round(glow * 200).toString(16).padStart(2, "0")}`,
              }}
            />
          }
        />
      </Camera>
      <Label index="02" title="Detailed" opacity={fade(f, 8) * (1 - swap)} />
      <Label index="03" title="Compare" opacity={swap * interpolate(f, [s(7.2), s(7.6)], [1, 0], clamp)} />
    </AbsoluteFill>
  );
};

/* S6: the timeline, panning past the Now line. */
export const Timeline: React.FC = () => {
  const f = useSceneFrame();
  return (
    <AbsoluteFill style={{ opacity: fade(f, 0, 12) * interpolate(f, [s(5.6), s(6)], [1, 0], clamp) }}>
      <Camera
        keys={[
          { f: 0, x: 520, y: 520, zoom: 1.55 },
          { f: s(6), x: 1180, y: 470, zoom: 1.65 },
        ]}
      >
        <AppWindow src="timeline.png" />
      </Camera>
      <Label index="04" title="Timeline" opacity={fade(f, 8) * interpolate(f, [s(5.2), s(5.6)], [1, 0], clamp)} />
    </AbsoluteFill>
  );
};

/* S7: the wallet. */
export const Wallet: React.FC = () => {
  const f = useSceneFrame();
  const totals = P(720, 225);
  const donut = P(420, 520);
  return (
    <AbsoluteFill style={{ opacity: fade(f, 0, 12) * interpolate(f, [s(4.6), s(5)], [1, 0], clamp) }}>
      <Camera
        keys={[
          { f: 0, x: totals.x, y: totals.y + 60, zoom: 1.35 },
          { f: s(2), x: totals.x, y: totals.y + 60, zoom: 1.45 },
          { f: s(5), x: donut.x + 160, y: donut.y, zoom: 1.75 },
        ]}
      >
        <AppWindow src="wallet.png" />
      </Camera>
      <Label index="05" title="Wallet" opacity={fade(f, 8) * interpolate(f, [s(4.2), s(4.6)], [1, 0], clamp)} />
    </AbsoluteFill>
  );
};

/* S8: notifications slide in, then an automation rule. */
export const Alerts: React.FC = () => {
  const f = useSceneFrame();
  const slide = interpolate(f, [s(0.8), s(1.5)], [0, 1], { ...clamp, easing: easeOut });
  const swap = interpolate(f, [s(4.2), s(4.8)], [0, 1], { ...clamp, easing: easeInOut });
  const panel = { x: 768 * K, y: 74 * K, w: 400 * K, h: 560 * K };
  const sw = P(954, 543);
  const pulse = interpolate(f, [s(6.3), s(7.3)], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ opacity: fade(f, 0, 12) * interpolate(f, [s(8.6), s(9)], [1, 0], clamp) }}>
      <Camera
        keys={[
          { f: 0, x: 800, y: 500, zoom: 1.05 },
          { f: s(1.8), x: panel.x + panel.w / 2 - 60, y: panel.y + panel.h / 2, zoom: 1.45 },
          { f: s(4.2), x: panel.x + panel.w / 2 - 60, y: panel.y + panel.h / 2 + 20, zoom: 1.5 },
          { f: s(4.8), x: 800, y: 520, zoom: 1.1 },
          { f: s(6.6), x: sw.x - 260, y: sw.y - 40, zoom: 1.8 },
          { f: s(9), x: sw.x - 260, y: sw.y - 40, zoom: 1.85 },
        ]}
      >
        <AppWindow
          src="overview.png"
          layers={
            <div
              style={{
                position: "absolute",
                inset: 0,
                opacity: slide,
                clipPath: `inset(${panel.y - 6}px ${1600 - panel.x - panel.w - 6}px ${1000 - panel.y - panel.h - 6}px ${panel.x - 6}px round 18px)`,
                transform: `translateY(${(1 - slide) * -18}px)`,
              }}
            >
              <Img src={staticFile("notifications.png")} style={{ width: 1600 }} />
            </div>
          }
        />
        <AppWindow
          src="automations.png"
          style={{ opacity: swap, boxShadow: "none" }}
          layers={
            <div
              style={{
                position: "absolute",
                left: sw.x - 40,
                top: sw.y - 26,
                width: 80,
                height: 52,
                borderRadius: 30,
                border: `3px solid ${C.green}`,
                opacity: (1 - pulse) * (pulse > 0 ? 1 : 0),
                transform: `scale(${1 + pulse * 0.6})`,
              }}
            />
          }
        />
      </Camera>
      <Label index="06" title="Alerts" opacity={fade(f, 8) * (1 - swap)} />
      <Label index="07" title="Automations" opacity={swap * interpolate(f, [s(8.2), s(8.6)], [1, 0], clamp)} />
    </AbsoluteFill>
  );
};

/* S9: the phone, then Privacy Mode. */
export const PhonePrivacy: React.FC = () => {
  const f = useSceneFrame();
  const { fps } = useVideoConfig();
  const inPhone = spring({ frame: f - 4, fps, config: { damping: 20, mass: 1 } });
  const phoneOut = interpolate(f, [s(2.6), s(3.1)], [0, 1], { ...clamp, easing: easeInOut });
  const blur = interpolate(f, [s(4.1), s(4.7)], [0, 1], { ...clamp, easing: easeInOut });
  const phoneScroll = interpolate(f, [s(0.6), s(2.8)], [0, 420], { ...clamp, easing: easeInOut });
  const email = P(330, 200);
  const PW = 410;
  const PH = 860;
  return (
    <AbsoluteFill style={{ opacity: fade(f, 0, 12) * interpolate(f, [s(5.6), s(6)], [1, 0], clamp) }}>
      <AbsoluteFill style={{ opacity: phoneOut }}>
        <Camera
          keys={[
            { f: s(2.6), x: 800, y: 500, zoom: 1.05 },
            { f: s(4.0), x: email.x + 120, y: email.y + 40, zoom: 1.9 },
            { f: s(6), x: email.x + 140, y: email.y + 40, zoom: 1.95 },
          ]}
        >
          <AppWindow src="overview.png" />
          <AppWindow src="privacy.png" style={{ opacity: blur, boxShadow: "none" }} />
        </Camera>
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: 1 - phoneOut }}>
        <div
          style={{
            position: "absolute",
            left: 960 - PW / 2 + (1 - inPhone) * 700,
            top: 540 - PH / 2 + 20,
            width: PW,
            height: PH,
            borderRadius: 56,
            padding: 12,
            background: "#0c0c0c",
            boxShadow: "0 0 0 1px #ffffff22, 0 50px 120px #000",
          }}
        >
          <div style={{ width: "100%", height: "100%", borderRadius: 44, overflow: "hidden", position: "relative", background: C.bg }}>
            <Img src={staticFile("mobile.png")} style={{ position: "absolute", left: 0, top: -phoneScroll * (PW - 24) / 390, width: PW - 24 }} />
          </div>
        </div>
      </AbsoluteFill>
      <Label index="08" title="On your phone" opacity={fade(f, 8) * (1 - phoneOut)} />
      <Label index="09" title="Privacy Mode" opacity={phoneOut * interpolate(f, [s(5.2), s(5.6)], [1, 0], clamp)} />
    </AbsoluteFill>
  );
};

/* S10: every provider's login flows into one server: yours. */
const PROVIDERS = ["claude", "codex", "cursor", "copilot", "grok", "antigravity", "vercel_ai_gateway"];
const Lock: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#86e3a8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2.5" />
    <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
  </svg>
);
export const Trust: React.FC = () => {
  const f = useSceneFrame();
  const gap = 150;
  const x0 = 960 - (gap * (PROVIDERS.length - 1)) / 2;
  const top = 330;
  const target = { x: 960, y: 600 };
  return (
    <AbsoluteFill style={{ opacity: fade(f, 0, 12) * interpolate(f, [s(7.6), s(8)], [1, 0], clamp) }}>
      <div style={{ ...headline, position: "absolute", top: 130, left: 0, right: 0, fontSize: 76, opacity: fade(f, 4, 20), transform: `translateY(${rise(f, 4)}px)` }}>
        Your logins stay on your server.
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {PROVIDERS.map((_, i) => {
          const x = x0 + i * gap;
          const at = 30 + i * 4;
          const t = interpolate(f, [at, at + 30], [0, 1], { ...clamp, easing: easeOut });
          const d = `M ${x} ${top + 44} C ${x} ${top + 150}, ${target.x} ${target.y - 140}, ${target.x} ${target.y - 4}`;
          return <path key={i} d={d} fill="none" stroke="#3a4a40" strokeWidth={2} pathLength={1} strokeDasharray="1" strokeDashoffset={1 - t} />;
        })}
      </svg>
      {PROVIDERS.map((name, i) => {
        const at = 14 + i * 4;
        return (
          <div key={name} style={{ position: "absolute", left: x0 + i * gap - 34, top: top - 34, width: 68, height: 68, borderRadius: 20, background: C.surface, border: `1px solid ${C.border}`, display: "grid", placeItems: "center", opacity: fade(f, at, 14), transform: `translateY(${rise(f, at, 20, 14)}px)` }}>
            <Mark name={name} size={34} />
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: target.x - 340,
          top: target.y,
          width: 680,
          padding: "30px 36px",
          borderRadius: 28,
          background: "#141815",
          border: "1px solid #2c4a35",
          boxShadow: `0 0 ${60 * fade(f, 64, 30)}px #5ad08a22`,
          display: "flex",
          alignItems: "center",
          gap: 24,
          opacity: fade(f, 54, 18),
          transform: `translateY(${rise(f, 54, 22, 16)}px)`,
        }}
      >
        <Logo size={64} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: sans, fontSize: 38, fontWeight: 500, color: C.text, letterSpacing: "-0.02em" }}>Your server</div>
          <div style={{ fontFamily: sans, fontSize: 23, color: C.muted, marginTop: 6 }}>Encrypted with a key that never leaves it.</div>
        </div>
        <Lock size={40} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 815, textAlign: "center", fontFamily: sans, fontSize: 30, color: C.dim, opacity: fade(f, s(3.4), 20) }}>
        No hosted copy. On purpose.
      </div>
    </AbsoluteFill>
  );
};

/* S11: where to try it. */
export const Cta: React.FC = () => {
  const f = useSceneFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f - 4, fps, config: { damping: 18, mass: 0.9 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 46, opacity: fade(f, 0, 12), paddingBottom: 120 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 30, opacity: pop, transform: `scale(${0.9 + 0.1 * pop})` }}>
        <Logo size={112} />
        <span style={{ fontFamily: sans, fontSize: 116, fontWeight: 500, letterSpacing: "-0.045em", color: C.text }}>Headroom</span>
      </div>
      <div style={{ fontFamily: sans, fontSize: 40, color: C.muted, letterSpacing: "-0.01em", opacity: fade(f, 22, 20), transform: `translateY(${rise(f, 22, 22, 16)}px)` }}>
        Free, open source, and runs on your own server.
      </div>
      <div style={{ fontFamily: mono, fontSize: 44, fontWeight: 500, color: C.text, padding: "18px 38px", borderRadius: 999, border: "1px solid #3a3a3a", background: "#141414", opacity: fade(f, 44, 20), transform: `translateY(${rise(f, 44)}px)` }}>
        headroom.theblank.club
      </div>
    </AbsoluteFill>
  );
};

/**
 * The end card's footer. It sits on the frame, not in the scene, so the scene's vertical offset cannot push it out of
 * view. OpenAI's usage policy asks for a clear disclosure that the voice is AI-generated.
 */
export const Disclosure: React.FC<{ bottom?: number }> = ({ bottom = 26 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: bottom, pointerEvents: "none" }}>
      <div style={{ fontFamily: sans, fontSize: 18, color: "#7a7a7a", opacity: fade(f, 0, 20), textAlign: "center" }}>
        Reads usage the way each provider's own app does. Not affiliated with any provider. The voiceover is AI-generated.
      </div>
    </AbsoluteFill>
  );
};
