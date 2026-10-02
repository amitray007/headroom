# Provider marks

Brand marks fetched from [SVGL](https://svgl.app) on 2026-10-02 for identification of the connected
service inside a personal dashboard. Each mark belongs to its owner; check the owner's brand
guidelines before any public distribution. Monochrome marks (Codex, Cursor, Copilot, Grok, Vercel)
are recoloured to `currentColor`; Claude and Antigravity keep their brand colours.

`telegram.svg` is the Telegram mark from SVGL (fetched 2026-10-03) and keeps its brand colours. It marks the Telegram destination on the Delivery tab.

`avatar.svg` is a DiceBear "Voxel Art" identicon (CC0 1.0), generated from the seed `headroom` on
2026-10-02 at `https://api.dicebear.com/10.x/voxel-art/svg?seed=headroom`. The app would seed it
with the owner's username.

The favicons and app icons are in `apps/web/public` (served from the site root). They are generated from the mark geometry in `src/ui/logo-geometry.ts` with `mise exec -- bun scripts/brand.ts`, which needs headless Chrome.

## Account avatar

The signed-in avatar is loaded from DiceBear's "Voxel Bot" style, seeded with the owner's username:
`https://api.dicebear.com/10.x/voxel-bot/svg?tags=animation&seed=<username>`. The username is sent to
DiceBear with that request. The server's Content Security Policy allows `https://api.dicebear.com` for images
only. `avatar.svg` stays as the offline fallback and as the face shown while the remote one loads.
