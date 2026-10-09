import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

/** Near-black ground with a faint cool tint and a slow ambient light. */
export const Ground: React.FC = () => {
  const f = useCurrentFrame();
  const x = 50 + Math.sin(f / 240) * 8;
  const y = 36 + Math.cos(f / 300) * 5;
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(60% 55% at ${x}% ${y}%, rgba(150,170,200,0.10) 0%, rgba(150,170,200,0) 70%)`,
          "radial-gradient(120% 100% at 50% 50%, #111316 0%, #0a0b0d 60%, #060708 100%)",
        ].join(","),
      }}
    />
  );
};

/** Film finish over everything: grain, vignette, a touch of halation. */
export const Finish: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{ background: "radial-gradient(120% 95% at 50% 46%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 100%)" }}
      />
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0, opacity: 0.06, mixBlendMode: "overlay" }}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={f % 12} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="1920" height="1080" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
};
