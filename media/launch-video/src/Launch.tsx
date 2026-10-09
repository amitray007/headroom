import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ClockProvider } from "./clock";
import { Finish, Ground } from "./grade";
import { Caption } from "./parts";
import { Cta, Disclosure, Hook, Problem, Reveal, Trust } from "./scenes";
import { Alerts, DetailedCompare, Overview, PhonePrivacy, Timeline, Wallet } from "./staged";
import { s } from "./theme";

export type Caps = [number, number, string, string][];
export type ScenePlan = { key: string; from: number; frames: number; anchors: [number, number][] };
export type LaunchProps = { captions: Caps; scenes: ScenePlan[]; total: number; music?: string; showCaptions?: boolean };

/**
 * Where each scene's content is centred today (px from the top, averaged over its phases). With captions the
 * content centres in the space above them (470); without, in the frame (540). The opening three scenes centre
 * themselves in the full frame already.
 */
const CENTRE: Record<string, number> = {
  overview: 466,
  detailed: 430,
  timeline: 472,
  wallet: 489,
  alerts: 455,
  phone: 490,
  trust: 490,
  cta: 480,
};
export const shiftFor = (key: string, withCaptions: boolean) =>
  CENTRE[key] === undefined ? 0 : (withCaptions ? 470 : 540) - CENTRE[key];

export const SCENES: Record<string, React.FC> = {
  hook: Hook,
  problem: Problem,
  reveal: Reveal,
  overview: Overview,
  detailed: DetailedCompare,
  timeline: Timeline,
  wallet: Wallet,
  alerts: Alerts,
  phone: PhonePrivacy,
  trust: Trust,
  cta: Cta,
};

const Captions: React.FC<{ captions: Caps }> = ({ captions }) => {
  const f = useCurrentFrame();
  return (
    <>
      {captions.map(([a, b, text]) => {
        const o = interpolate(f, [s(a), s(a) + 6, s(b) - 6, s(b)], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return o > 0 ? <Caption key={a} text={text} opacity={o} /> : null;
      })}
    </>
  );
};

/** The music bed: in quickly, a little lower under the voice, out over the last two seconds. */
export const Music: React.FC<{ src: string; captions: Caps; total: number }> = ({ src, captions, total }) => {
  const { fps } = useVideoConfig();
  const speaking = (f: number) =>
    Math.max(
      0,
      ...captions.map(([a, b]) =>
        interpolate(f, [s(a) - 6, s(a), s(b), s(b) + 8], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      ),
    );
  return (
    <Audio
      src={staticFile(src)}
      loop
      volume={(f) => {
        const edge = interpolate(f, [0, 12, total - 2 * fps, total], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return edge * (0.15 - 0.075 * speaking(f));
      }}
    />
  );
};

/** The disclosure footer, four seconds into the end card. */
export const EndFooter: React.FC<{ scenes: ScenePlan[]; bottom?: number }> = ({ scenes, bottom }) => {
  const cta = scenes.find((p) => p.key === "cta");
  return cta ? (
    <Sequence from={cta.from + s(4)} layout="none">
      <Disclosure bottom={bottom} />
    </Sequence>
  ) : null;
};

export const Launch: React.FC<LaunchProps> = ({ captions, scenes, total, music, showCaptions = true }) => (
  <AbsoluteFill>
    <Ground />
    {scenes.map((p) => {
      const Scene = SCENES[p.key];
      return (
        <Sequence key={p.key} from={p.from} durationInFrames={p.frames} layout="none">
          <ClockProvider anchors={p.anchors}>
            <AbsoluteFill style={{ transform: `translateY(${shiftFor(p.key, showCaptions)}px)` }}>
              <Scene />
            </AbsoluteFill>
          </ClockProvider>
        </Sequence>
      );
    })}
    {captions.map(([a, , , file]) => (
      <Sequence key={file} from={s(a)} layout="none">
        <Audio src={staticFile(file)} />
      </Sequence>
    ))}
    {music ? <Music src={music} captions={captions} total={total} /> : null}
    {showCaptions ? <Captions captions={captions} /> : null}
    <EndFooter scenes={scenes} />
    <Finish />
  </AbsoluteFill>
);
