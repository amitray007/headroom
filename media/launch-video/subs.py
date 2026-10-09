"""Write SRT and VTT subtitle files from a render's props. Usage: python3 subs.py <voice>"""
import json, sys
voice = sys.argv[1]
caps = json.load(open(f"props-{voice}.json"))["captions"]
def stamp(t, sep):
    ms = round(t * 1000); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s_, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s_:02d}{sep}{ms:03d}"
srt = "\n".join(f"{i}\n{stamp(a, ',')} --> {stamp(b, ',')}\n{t}\n" for i, (a, b, t, _) in enumerate(caps, 1))
vtt = "WEBVTT\n\n" + "\n".join(f"{stamp(a, '.')} --> {stamp(b, '.')}\n{t}\n" for a, b, t, _ in caps)
open(f"out/headroom-launch-{voice}.srt", "w", encoding="utf-8").write(srt)
open(f"out/headroom-launch-{voice}.vtt", "w", encoding="utf-8").write(vtt)
print(srt.splitlines()[:4], len(caps), "cues")
