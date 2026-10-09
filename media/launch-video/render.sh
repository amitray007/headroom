#!/bin/bash
# Render the launch assets into ../exports. Usage: ./render.sh <target>...
#   launch   the 16:9 film, with captions burned in and without, plus SRT/VTT subtitles and the poster
#   square   the 1:1 cut for feeds, with captions burned in and without, plus the subtitles
#   stills   the Product Hunt gallery, 1270x760 PNG
#   loop     the silent README loop (GIF and MP4), cut from the clean film; needs `launch` first
#   all      every target above
# Needs the music track in public/music (see ../README.md) and ffmpeg on PATH. Run through mise: `mise exec -- ./render.sh all`.
set -euo pipefail
cd "$(dirname "$0")"
EXPORTS=../exports
VOICE=shimmer

render() { # render <composition> <props> <out.mp4>
  npx remotion render src/index.ts "$1" "$3" --props="$2" --concurrency=8 --crf=18 --log=error
}

# Loudness for social playback: -16 LUFS integrated, -1.5 dBTP peaks.
loudnorm() { # loudnorm <in.mp4> <out.mp4>
  ffmpeg -loglevel error -y -i "$1" -c:v copy -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 192k -movflags +faststart "$2"
}

launch() {
  mkdir -p out "$EXPORTS/launch"
  render Launch "props-$VOICE.json" out/raw-captions.mp4
  render Launch "props-$VOICE-clean.json" out/raw-clean.mp4
  loudnorm out/raw-captions.mp4 "$EXPORTS/launch/headroom-launch-captions.mp4"
  loudnorm out/raw-clean.mp4 "$EXPORTS/launch/headroom-launch.mp4"
  python3 subs.py "$VOICE"
  cp "out/headroom-launch-$VOICE.srt" "$EXPORTS/launch/headroom-launch.srt"
  cp "out/headroom-launch-$VOICE.vtt" "$EXPORTS/launch/headroom-launch.vtt"
  # The poster is the logo reveal.
  ffmpeg -loglevel error -y -ss 9.5 -i "$EXPORTS/launch/headroom-launch.mp4" -frames:v 1 -q:v 3 "$EXPORTS/launch/headroom-launch-poster.jpg"
  # The landing page plays a smaller copy (site/README.md).
  ffmpeg -loglevel error -y -i "$EXPORTS/launch/headroom-launch.mp4" -c:v libx264 -crf 25 -preset slow -pix_fmt yuv420p \
    -c:a aac -b:a 128k -movflags +faststart ../../site/media/headroom-launch.mp4
  cp "$EXPORTS/launch/headroom-launch-poster.jpg" "$EXPORTS/launch/headroom-launch.vtt" ../../site/media/
}

square() {
  mkdir -p out "$EXPORTS/square"
  render Square "props-$VOICE-clean.json" out/raw-square-captions.mp4
  render SquareClean "props-$VOICE-clean.json" out/raw-square.mp4
  loudnorm out/raw-square-captions.mp4 "$EXPORTS/square/headroom-launch-square-captions.mp4"
  loudnorm out/raw-square.mp4 "$EXPORTS/square/headroom-launch-square.mp4"
  # The square cut keeps the film's timing, so the film's subtitles fit it.
  python3 subs.py "$VOICE"
  cp "out/headroom-launch-$VOICE.srt" "$EXPORTS/square/headroom-launch-square.srt"
  cp "out/headroom-launch-$VOICE.vtt" "$EXPORTS/square/headroom-launch-square.vtt"
}

stills() {
  mkdir -p "$EXPORTS/product-hunt"
  # name, then the frame: the moment each scene is fully built.
  while read -r name frame; do
    npx remotion still src/index.ts Gallery "$EXPORTS/product-hunt/$name.png" --frame="$frame" --props="props-$VOICE-clean.json" --log=error
  done <<'FRAMES'
01-headroom 310
02-every-limit 545
03-which-account 745
04-timeline 870
05-wallet 990
06-alerts 1080
07-automations 1240
08-your-server 1585
FRAMES
}

loop() {
  mkdir -p out "$EXPORTS/readme"
  local src="$EXPORTS/launch/headroom-launch.mp4"
  # Overview through Wallet (11.5 s to 33.4 s of the film, past the fade-in), 1.5x speed, no sound.
  ffmpeg -loglevel error -y -ss 11.5 -to 33.4 -i "$src" -an -vf "setpts=PTS/1.5,fps=30,scale=1280:-2:flags=lanczos" \
    -c:v libx264 -crf 24 -pix_fmt yuv420p -movflags +faststart "$EXPORTS/readme/headroom-loop.mp4"
  ffmpeg -loglevel error -y -i "$EXPORTS/readme/headroom-loop.mp4" \
    -vf "fps=15,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
    -loop 0 "$EXPORTS/readme/headroom-loop.gif"
}

[ $# -gt 0 ] || { sed -n '2,8p' "$0"; exit 2; }
for target in "$@"; do
  case "$target" in
    launch | square | stills | loop) "$target" ;;
    all) launch; square; stills; loop ;;
    *) echo "unknown target: $target" >&2; exit 2 ;;
  esac
done
ls -la "$EXPORTS"/*
