"""Lay the video out on the voice: tighten pauses, then size each scene to its lines.
Usage: python3 plan.py <voice>   (raw lines in vo-raw/<voice>/). Writes props-<voice>.json."""
import json, os, subprocess, sys

voice = sys.argv[1]
text = {c[3].split("/")[-1].rsplit(".", 1)[0]: c[2] for c in json.load(open("captions-text.json"))}
FPS = 30
GAP, TAIL, PRE = 0.3, 0.5, 0.25
# key, design length (s), lines, where each line starts on the design timeline (s), shortest the scene may be (s)
DESIGN = [
    ("hook", 5, ["0.3"], [0.3], 4.0),
    ("problem", 6, ["5.3"], [0.3], 3.8),
    ("reveal", 4, ["11.4"], [0.4], 3.0),
    ("overview", 9, ["15.4"], [0.4], 7.6),
    ("detailed", 8, ["24.3", "28.0"], [0.3, 4.4], 6.2),
    ("timeline", 6, ["32.3"], [0.3], 4.2),
    ("wallet", 5, ["38.3"], [0.3], 4.0),
    ("alerts", 9, ["43.3", "47.6"], [0.1, 4.3], 8.0),
    ("phone", 6, ["52.3", "55.0"], [0.2, 2.2], 5.0),
    ("trust", 8, ["58.4"], [0.4], 6.4),
    ("cta", 8, ["66.4"], [0.4], 7.4),
]

def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True).stdout)

os.makedirs(f"public/vo/{voice}", exist_ok=True)
lengths = {}
for key in text:
    raw = next(f"vo-raw/{voice}/{key}.{e}" for e in ("mp3", "wav") if os.path.exists(f"vo-raw/{voice}/{key}.{e}"))
    dst = f"public/vo/{voice}/{key}.mp3"
    # Pauses over 0.35 s shrink to 0.28 s; leading and trailing silence go.
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", raw, "-af",
        "silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.35:stop_silence=0.28:stop_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse",
        "-ar", "48000", "-b:a", "192k", dst], check=True)
    lengths[key] = dur(dst)

f = lambda sec: round(sec * FPS)
scenes, captions, t = [], [], 0.0
for key, dlen, lines, offs, minimum in DESIGN:
    a = min(offs[0], PRE)
    anchors = [[0, 0]]
    for i, (line, off) in enumerate(zip(lines, offs)):
        if i:
            a += GAP
        anchors.append([f(off), f(a)])
        captions.append([round(t + a, 2), round(t + a + lengths[line] + 0.25, 2), text[line], f"vo/{voice}/{line}.mp3"])
        a += lengths[line]
    length = max(minimum, a + TAIL)
    anchors.append([f(dlen), f(length)])
    scenes.append({"key": key, "from": f(t), "frames": f(length), "anchors": anchors})
    print(f"{key:9} {length:5.2f}s (design {dlen}s)")
    t += length
for c, n in zip(captions, captions[1:]):
    c[1] = min(c[1], round(n[0] - 0.05, 2))
total = f(t)
json.dump({"captions": captions, "scenes": scenes, "total": total, "music": "music/digital-clouds.mp3"}, open(f"props-{voice}.json", "w"), indent=1)
print(f"total {t:.1f}s")
