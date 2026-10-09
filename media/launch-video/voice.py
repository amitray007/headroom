"""Build one voice version: tighten pauses, fit each line to its scene, write the render props.
Usage: python3 voice.py <name>   (raw lines already in vo-raw/<name>/)"""
import json, subprocess, sys, os
name = sys.argv[1]
lines = json.load(open("lines.json"))
captions = {c[3].split("/")[-1].rsplit(".", 1)[0]: c[2] for c in json.load(open("captions-text.json"))}
STARTS = {"0.3": 0.3, "5.3": 5.3, "11.4": 11.4, "15.4": 15.4, "24.3": 24.3, "28.0": 28.4, "32.3": 32.3, "38.3": 38.3,
          "43.3": 43.1, "47.6": 47.3, "52.3": 52.2, "55.0": 54.2, "58.4": 58.4, "66.4": 66.4}
keys = list(lines)
def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True).stdout)
os.makedirs(f"public/vo/{name}", exist_ok=True)
out = []
prev_end = 0.0
for i, k in enumerate(keys):
    raw = next(f"vo-raw/{name}/{k}.{e}" for e in ("mp3", "wav") if os.path.exists(f"vo-raw/{name}/{k}.{e}"))
    # A line that ran long pushes the next one back a little, never forward.
    start = round(max(STARTS[k], prev_end + 0.15), 2)
    slot = (STARTS[keys[i + 1]] - 0.15 if i + 1 < len(keys) else 73.6) - start
    tight = f"/tmp/vo-{name}-{k}.wav"
    # Pauses over 0.35 s shrink to 0.28 s; leading and trailing silence go.
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", raw, "-af",
        "silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.35:stop_silence=0.28:stop_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse",
        "-ar", "48000", tight], check=True)
    d = dur(tight)
    tempo = max(1.0, d / slot)
    if tempo > 1.22:
        print(f"!! {name} {k}: {d:.2f}s in a {slot:.2f}s slot needs x{tempo:.2f}; capped at 1.22")
        tempo = 1.22
    dst = f"public/vo/{name}/{k}.mp3"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tight, "-af", f"atempo={tempo:.4f}", "-b:a", "192k", dst], check=True)
    d2 = dur(dst)
    prev_end = start + d2
    out.append([start, round(start + d2 + 0.3, 2), captions[k], f"vo/{name}/{k}.mp3"])
    print(f"{name} {k:5} {d:5.2f}s -> {d2:5.2f}s (slot {slot:4.2f}, x{tempo:.2f})")
for a, b in zip(out, out[1:]):
    a[1] = min(a[1], round(b[0] - 0.05, 2))
json.dump({"captions": out}, open(f"props-{name}.json", "w"), indent=1)
