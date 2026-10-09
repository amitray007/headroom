import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ClockProvider } from "./clock";
import { Finish, Ground } from "./grade";
import { EndFooter, type LaunchProps, Music, SCENES, shiftFor } from "./Launch";
import { C, s, sans } from "./theme";

/**
 * The launch film in another frame shape. Each scene still renders on the 1920x1080 stage it was designed on; the stage
 * is then scaled and moved so that the scene's content fills the target area. Used by the square cut and the stills.
 */

/** Where each scene's content sits on the stage in the clean cut: [left, top, right, bottom]. Measured from a render. */
const BOUNDS: Record<string, [number, number, number, number]> = {
  hook: [335, 304, 1581, 792],
  problem: [245, 44, 1690, 831],
  reveal: [561, 425, 1355, 674],
  overview: [160, 170, 1718, 912],
  detailed: [197, 221, 1722, 871],
  timeline: [310, 180, 1609, 923],
  wallet: [333, 163, 1586, 919],
  alerts: [151, 251, 1790, 941],
  phone: [160, 172, 1718, 947],
  trust: [451, 191, 1467, 899],
  cta: [540, 365, 1381, 734],
};

/** The box, in canvas pixels, that a scene's content is fitted into. */
export type Area = { cx: number; cy: number; w: number; h: number };

/**
 * With captions, the scaled content and the caption under it are centred together as one group, so a short scene
 * does not leave a gap above its caption. `block` is the room kept for a two-line caption.
 */
export type Stack = { canvas: number; gap: number; block: number };

const fit = (key: string, area: Area, stack?: Stack) => {
  const [l, t, r, b] = BOUNDS[key] ?? [0, 0, 1920, 1080];
  // Never enlarge: the screenshots inside would soften.
  const k = Math.min(1, area.w / (r - l), area.h / (b - t));
  const h = k * (b - t);
  const top = stack ? (stack.canvas - (h + stack.gap + stack.block)) / 2 : area.cy - h / 2;
  return { k, x: area.cx - k * ((l + r) / 2), y: top - k * t, captionTop: top + h + (stack?.gap ?? 0) };
};

/** One caption at a time, sized for a phone feed: no box, larger type, centred under the content. */
const FeedCaptions: React.FC<{ captions: LaunchProps["captions"]; top: (frame: number) => number }> = ({ captions, top }) => {
  const f = useCurrentFrame();
  return (
    <>
      {captions.map(([a, b, text]) => {
        const o = interpolate(f, [s(a), s(a) + 6, s(b) - 6, s(b)], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return o > 0 ? (
          <div
            key={a}
            style={{
              position: "absolute",
              left: 60,
              right: 60,
              top: top(s(a)),
              opacity: o,
              color: C.text,
              fontFamily: sans,
              fontSize: 44,
              fontWeight: 500,
              lineHeight: 1.3,
              letterSpacing: "-0.015em",
              textAlign: "center",
              textWrap: "balance",
            }}
          >
            {text}
          </div>
        ) : null;
      })}
    </>
  );
};

export type ReframeProps = LaunchProps & { area: Area; stack?: Stack; withAudio?: boolean };

export const Reframe: React.FC<ReframeProps> = ({ captions, scenes, total, music, area, stack, withAudio = true }) => {
  // A caption sits under the scene that is on screen when it starts.
  const captionTop = (frame: number) => {
    const scene = scenes.find((p) => frame >= p.from && frame < p.from + p.frames) ?? scenes[scenes.length - 1];
    return scene ? fit(scene.key, area, stack).captionTop : 0;
  };
  return (
  <AbsoluteFill style={{ overflow: "hidden" }}>
    <Ground />
    {scenes.map((p) => {
      const Scene = SCENES[p.key];
      const { k, x, y } = fit(p.key, area, stack);
      return Scene ? (
        <Sequence key={p.key} from={p.from} durationInFrames={p.frames} layout="none">
          <ClockProvider anchors={p.anchors}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 1920,
                height: 1080,
                transformOrigin: "0 0",
                transform: `translate(${x}px, ${y}px) scale(${k})`,
              }}
            >
              <AbsoluteFill style={{ transform: `translateY(${shiftFor(p.key, false)}px)` }}>
                <Scene />
              </AbsoluteFill>
            </div>
          </ClockProvider>
        </Sequence>
      ) : null;
    })}
    {withAudio
      ? captions.map(([a, , , file]) => (
          <Sequence key={file} from={s(a)} layout="none">
            <Audio src={staticFile(file)} />
          </Sequence>
        ))
      : null}
    {withAudio && music ? <Music src={music} captions={captions} total={total} /> : null}
    {stack ? <FeedCaptions captions={captions} top={captionTop} /> : null}
    <EndFooter scenes={scenes} bottom={30} />
    <Finish />
  </AbsoluteFill>
  );
};
