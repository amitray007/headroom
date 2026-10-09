// Generate voiceover lines through Vercel AI Gateway text to speech.
// The key is read from the macOS Keychain (service headroom-ai-gateway) and never printed.
// Usage: node tts.mjs <model> <voice> <outdir> [instructions-file] [--lines all|audition]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [model, voice, outdir, instructionsFile, , which = "all"] = process.argv.slice(2);
const key = execFileSync("security", ["find-generic-password", "-s", "headroom-ai-gateway", "-w"], { encoding: "utf8" }).trim();
const instructions = instructionsFile ? readFileSync(instructionsFile, "utf8").trim() : undefined;

// The spoken lines, keyed by caption start (seconds). The address is spelled out for speech.
const LINES = JSON.parse(readFileSync(new URL("./lines.json", import.meta.url), "utf8"));
const AUDITION = ["0.3", "11.4", "47.6"];

const ext = model.startsWith("google/") ? "wav" : "mp3";
mkdirSync(outdir, { recursive: true });
const picked = which === "audition" ? AUDITION : Object.keys(LINES);
for (const at of picked) {
  const body = { text: LINES[at], voice, outputFormat: ext };
  if (instructions && model.startsWith("google/")) body.instructions = instructions;
  if (instructions && model.startsWith("openai/")) body.instructions = instructions;
  if (process.env.SPEED) body.speed = Number(process.env.SPEED);
  if (model.startsWith("microsoft/") && process.env.AZURE_STYLE) body.providerOptions = { azure: { style: process.env.AZURE_STYLE, styleDegree: 1.3 } };
  let res;
  // The free tier allows 5 requests a minute per model: wait as told and try again.
  for (let attempt = 0; attempt < 6; attempt++) {
  res = await fetch("https://ai-gateway.vercel.sh/v4/ai/speech-model", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "ai-gateway-protocol-version": "0.0.1",
      "ai-speech-model-specification-version": "4",
      "ai-model-id": model,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status !== 429) break;
  const text = await res.text();
  const wait = Number(/Retry after (\d+)s/.exec(text)?.[1] ?? 15) + 1;
  console.error(`${at}: rate limited, waiting ${wait}s`);
  await new Promise((r) => setTimeout(r, wait * 1000));
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.audio) {
    console.error(`${at}: HTTP ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
    process.exitCode = 1;
    continue;
  }
  const file = join(outdir, `${at}.${ext}`);
  writeFileSync(file, Buffer.from(json.audio, "base64"));
  if (json.warnings?.length) console.error(`${at}: warnings ${JSON.stringify(json.warnings)}`);
  console.log(`${at} -> ${file}`);
}
