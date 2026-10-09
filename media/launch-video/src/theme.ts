import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";
import { Easing, interpolate } from "remotion";

export const sans = loadGeist("normal", { weights: ["400", "500", "600"] }).fontFamily;
export const mono = loadGeistMono("normal", { weights: ["400", "500"] }).fontFamily;

export const C = {
  bg: "#121212",
  deep: "#0a0a0a",
  surface: "#1a1a1a",
  border: "#2e2e2e",
  text: "#ededed",
  muted: "#a1a1a1",
  dim: "#6b6b6b",
  green: "#5ad08a",
};

export const FPS = 30;
export const s = (sec: number) => Math.round(sec * FPS);

/** The app's entrance curve. */
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

export const fade = (f: number, from: number, len = 18) =>
  interpolate(f, [from, from + len], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });

export const rise = (f: number, from: number, len = 24, dist = 28) =>
  interpolate(f, [from, from + len], [dist, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });

/** Scene timing in seconds, matching the storyboard. */
export const SCENES = {
  hook: [0, 5],
  problem: [5, 11],
  reveal: [11, 15],
  overview: [15, 24],
  detailed: [24, 32],
  timeline: [32, 38],
  wallet: [38, 43],
  alerts: [43, 52],
  phone: [52, 58],
  trust: [58, 66],
  cta: [66, 74],
} as const;

export const CAPTIONS: [number, number, string, string][] = [
  [0.3, 3.91, "Claude. Codex. Cursor. Copilot. You pay for all of them.", "vo/0.3.mp3"],
  [5.3, 8.98, "Each one resets on its own clock, in its own dashboard.", "vo/5.3.mp3"],
  [11.4, 13.98, "Headroom puts them all on one screen.", "vo/11.4.mp3"],
  [15.4, 23.07, "Each account gets a panel: its session and weekly limits, credits and banked resets, with a countdown to the next reset.", "vo/15.4.mp3"],
  [24.3, 28.34, "Detailed sorts every account by how close it is to its limit.", "vo/24.3.mp3"],
  [28.4, 30.6, "Compare names the one to use next.", "vo/28.0.mp3"],
  [32.3, 35.41, "Timeline shows when your headroom comes back.", "vo/32.3.mp3"],
  [38.3, 41.72, "Wallet adds up what it all costs, in one currency.", "vo/38.3.mp3"],
  [43.1, 47.19, "Get a warning on Telegram or by webhook before you run out.", "vo/43.3.mp3"],
  [47.3, 52.1, "Automations use a banked Codex reset, log top-ups and watch your budgets.", "vo/47.6.mp3"],
  [52.2, 53.89, "It works on your phone.", "vo/52.3.mp3"],
  [54.2, 58.17, "And Privacy Mode blurs emails when you share your screen.", "vo/55.0.mp3"],
  [58.4, 63.98, "There's no hosted version, on purpose. Your logins stay encrypted on your own server.", "vo/58.4.mp3"],
  [66.4, 73.42, "Run it on your own server. It's free and open source. Try the live demo at headroom.theblank.club.", "vo/66.4.mp3"],
];
