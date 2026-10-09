# Media

Videos, audio, subtitles and images for launching and presenting Headroom. Put new media here too: the source in its own folder, the finished files in `exports/`.

| Folder | What it holds |
| --- | --- |
| `launch-video/` | The source of the launch film: a [Remotion](https://www.remotion.dev) project, its screenshots, the voice lines and the scripts that build every export |
| `exports/launch/` | The 16:9 film, 1920x1080, about one minute |
| `exports/square/` | The 1:1 cut for social feeds, 1080x1080 |
| `exports/product-hunt/` | Gallery images for Product Hunt, 1270x760 |
| `exports/readme/` | The silent loop at the top of the README |

## The exports

| File | Use |
| --- | --- |
| `launch/headroom-launch.mp4` | The film without burned-in captions. The landing page plays a smaller copy of it from `site/media/` |
| `launch/headroom-launch-captions.mp4` | The film with captions burned in, for players without subtitle support |
| `launch/headroom-launch.srt`, `.vtt` | Subtitles for the film without captions: SRT for X and LinkedIn uploads, VTT for the web |
| `launch/headroom-launch-poster.jpg` | The still a player shows before the film starts |
| `square/headroom-launch-square.mp4` | The 1:1 cut, captions burned in, for feeds that autoplay without sound |
| `product-hunt/01-headroom.png` to `08-your-server.png` | Eight gallery images, in the order the film shows them. The first is the cover |
| `readme/headroom-loop.gif` | The README loop: Overview, Compare, Timeline and Wallet at 1.5x speed. `headroom-loop.mp4` is the same loop for places that play video |

## Render

The renders need Node, which `launch-video/mise.toml` pins, and `ffmpeg` on the `PATH`.

1. Download the music track (see [Credits](#credits)) to `launch-video/public/music/digital-clouds.mp3`. Git ignores it.
2. Install the packages: `cd media/launch-video && mise exec -- npm ci`.
3. Render: `mise exec -- ./render.sh all`, or one target: `launch`, `square`, `stills` or `loop`. The loop is cut from the film, so render `launch` first.

`launch` also refreshes the copy that the landing page plays, in `site/media/`.

To preview and edit the scenes, run `mise exec -- npx remotion studio src/index.ts`. The scene timing comes from the voice: `plan.py` fits each scene to its voice lines and writes `props-shimmer.json`.

## Credits

- **Voiceover:** generated with OpenAI's `tts-1-hd` model and the `shimmer` voice, through the Vercel AI Gateway (`tts.mjs`). OpenAI's usage policy requires a clear disclosure that the voice is AI-generated. The film's last frame says so. Say it in the post text too when you share the film.
- **Music:** "Digital Clouds" from [Mixkit](https://mixkit.co/free-stock-music/) (track 175, `https://assets.mixkit.co/music/175/175.mp3`), under the Mixkit Stock Music Free License. The license covers the track inside the finished videos. It does not cover sharing the track file itself, so the file is not in this repository.
- **Screenshots:** Headroom in Demo Mode. Every account is synthetic, on reserved `example` domains.
- **Provider logos:** the marks in `launch-video/public/*.svg` belong to their owners. They name the services Headroom supports.
- **Type:** Geist and Geist Mono, under the SIL Open Font License, loaded through `@remotion/google-fonts`.
- **Remotion:** free for individuals and small teams. See the [Remotion license](https://www.remotion.dev/license).
