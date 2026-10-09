import React, { createContext, useContext } from "react";
import { interpolate, useCurrentFrame } from "remotion";

/** Maps a scene's real frame to the frame its animations were designed against. */
type Clock = (frame: number) => number;
const SceneClock = createContext<Clock>((f) => f);

/**
 * Each scene is designed on a fixed timeline. When the voice makes a scene shorter or longer, its animation is
 * stretched piecewise between anchors (design frame, real frame), so a swap still lands just before its line.
 */
export const ClockProvider: React.FC<{ anchors: [number, number][]; children: React.ReactNode }> = ({ anchors, children }) => {
  const design = anchors.map((a) => a[0]);
  const real = anchors.map((a) => a[1]);
  const map: Clock = (f) => interpolate(f, real, design, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <SceneClock.Provider value={map}>{children}</SceneClock.Provider>;
};

export const useSceneFrame = (): number => {
  const map = useContext(SceneClock);
  return map(useCurrentFrame());
};
