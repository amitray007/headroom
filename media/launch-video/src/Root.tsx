import React from "react";
import { Composition } from "remotion";
import { Launch, type LaunchProps } from "./Launch";
import { Reframe, type ReframeProps } from "./Reframe";
import { FPS } from "./theme";

const empty: LaunchProps = { captions: [], scenes: [], total: 60 * FPS };

/** Square 1:1 cut for feeds: content in the upper part, captions below, voice and music as in the film. */
const square: ReframeProps = {
  ...empty,
  area: { cx: 540, cy: 540, w: 1000, h: 720 },
  stack: { canvas: 1080, gap: 56, block: 120 },
};

/** Product Hunt gallery frame, 1270x760: content fills the frame, no captions or sound. */
const gallery: ReframeProps = { ...empty, area: { cx: 635, cy: 380, w: 1180, h: 680 }, withAudio: false };

/** The length comes from the voice plan passed in with --props (see plan.py). */
export const Root: React.FC = () => (
  <>
    <Composition
      id="Launch"
      component={Launch}
      defaultProps={empty}
      calculateMetadata={({ props }) => ({ durationInFrames: props.total })}
      durationInFrames={empty.total}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="Square"
      component={Reframe}
      defaultProps={square}
      calculateMetadata={({ props }) => ({ durationInFrames: props.total })}
      durationInFrames={empty.total}
      fps={FPS}
      width={1080}
      height={1080}
    />
    <Composition
      id="Gallery"
      component={Reframe}
      defaultProps={gallery}
      calculateMetadata={({ props }) => ({ durationInFrames: props.total })}
      durationInFrames={empty.total}
      fps={FPS}
      width={1270}
      height={760}
    />
  </>
);
