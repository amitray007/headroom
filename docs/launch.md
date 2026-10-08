# Launch

The plan for the public release: versioning, the Docker image, funding, the demo site, the launch video and the launch posts. Each phase says who does it and what gates it. Policy posture stays the same: Headroom is self-hosted software, never a hosted service ([roadmap](roadmap.md#working-agreements)). Remove an item when it ships.

## Decisions

| Question | Choice |
| --- | --- |
| Version numbers | [Semantic Versioning](https://semver.org) from [Conventional Commits](https://www.conventionalcommits.org): `fix:` bumps the patch, `feat:` the minor, `feat!:` or `BREAKING CHANGE:` the major |
| Release tool | release-please: it keeps one release pull request open with the next version and the changelog. Merging it tags `vX.Y.Z` |
| First version | `0.1.0`. Before `1.0.0`, a breaking change bumps the minor |
| Demo site host | GitHub Pages, live when the repository is public |
| Voiceover | Text to speech through Vercel AI Gateway, after the visuals are final. The owner shares the key then |

## Gates

1. Finish the release-readiness checks in [M6](roadmap.md#m6-actions-and-release-readiness): dependency licenses, CLI redistribution terms, attribution, deployment instructions.
2. Make the repository public. Then enable private vulnerability reporting, upload the social preview image and make the GHCR package public.
3. Merge the first release pull request to tag `v0.1.0`. Some listings count the project's age from that date.

## Phase 1: Versioning and the Docker image

Status: built on 2026-10-09. How it works is in [Releases](operations/releases.md); the decision is D33 in the [decision register](decisions/README.md).

Remaining:

1. The owner allows GitHub Actions to create pull requests (Settings > Actions > General > Workflow permissions). Without it, release-please cannot open the release pull request.
2. The owner merges the first release pull request to tag `v0.1.0`. Then remove `release-as` from `release-please-config.json`.
3. After the repository and the GHCR package are public, point the owner's Dokploy instance at `edge` or a release tag, so it stops building from source. Until then, pulling the image needs a registry login.

## Phase 2: GitHub Sponsors

Status: the Sponsors profile was already public. On 2026-10-09 the repository gained `.github/FUNDING.yml`, a README badge and a Support section. Remaining: the owner updates the profile text and tiers to name Headroom, and features the repository once it is public.

## Phase 3: Landing page and demo site

Owner: the agent. Gate: the public repository, for GitHub Pages.

- One GitHub Pages site at `amitray007.github.io/headroom`: a landing page at the root, the demo at `/demo`.
- The demo is the real web app in a static build with a demo flag. It skips sign-in, uses the Demo Mode generator in `packages/view-model`, answers every API call in the browser and shows a banner: synthetic data, deploy your own.
- The landing page carries the hero video, the "no cloud version" note, the `docker run` line and links to the repository, the demo and Sponsors.
- Preview both locally before the repository is public.

## Phase 4: Launch video

Owner: the agent builds; the owner approves each step.

1. A storyboard and a script of 60 to 75 seconds for the owner to approve:
   - Hook: the plans you pay for (Codex, Claude, Cursor, Copilot) each reset on a different clock.
   - Problem: seven dashboards, no single view of what is left.
   - Reveal: the overview, meters, reset countdowns, the timeline, the Wallet.
   - Features: notifications, an auto-reset rule, mobile, Privacy Mode.
   - Trust: your server, your tokens, no cloud version on purpose.
   - Call to action: the `docker run` line, the repository, the demo.
2. Capture: Playwright records the demo site at 2x scale, Demo Mode data only.
3. Compose in Remotion (free for individuals): camera moves over the captures, titles, transitions and a short diagram for the trust scene. Record the choice in a decision entry.
4. The owner reviews silent cuts until the visuals are final.
5. Voiceover: the agent generates the narration through Vercel AI Gateway text to speech and syncs the cuts to it. The owner enters the key privately at this step.
6. Renders:

| Output | Use |
| --- | --- |
| 16:9, 1080p, with voice | Twitter, YouTube, Product Hunt |
| 1:1, with captions | Twitter feed and LinkedIn, where sound is often off |
| 10-second loop, no audio | README hero (GIF under 5 MB, or MP4) |
| 1270 x 760 stills | Product Hunt gallery |

## GitHub Actions

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` (exists) | Pull request, push to `main` | Checks, audit, binary build, image build. Add the commit subject check |
| `release-please.yml` | Push to `main` | Keeps the release pull request current. When it merges, tags the release and calls `image.yml` |
| `image.yml` | Push to `main`, release, manual | Builds both architectures, pushes the tags above, attests provenance, smoke-tests the pushed image |
| `pages.yml` | Release, manual | Builds the landing page and the demo and deploys them to GitHub Pages |

Use least-privilege permissions in each job: `packages: write` only in `image.yml`, `pages: write` and `id-token: write` only in `pages.yml`. Pin every action to a commit SHA, as `ci.yml` does. Native `arm64` runners are free for public repositories; until then, `arm64` builds under QEMU.

Later, not now: release binaries with `SHA256SUMS`, a Docker Hub mirror.

## Deploy targets after Docker

| Target | What to build | Gate |
| --- | --- | --- |
| Railway | A template with a volume and the image. Railway pays template authors a share of the compute their template uses (25% in its docs at the time of writing) | Image |
| Render | A `render.yaml` blueprint and a "Deploy to Render" button. The service needs a persistent disk | Image |
| DigitalOcean | A 1-Click Droplet in the Marketplace: a vendor account and a Packer image that runs the container | Image, vendor approval |
| Dokploy | A template in the `Dokploy/templates` repository, tested on a real server, with a screenshot in the pull request | Image |
| Coolify | Users can deploy the compose file today. A one-click service template needs 1,000 GitHub stars | Stars |

No serverless target: Headroom needs a long-running process.

## Phase 5: Launch posts

Owner: the agent drafts; the owner posts from their own accounts.

Before the first post: the repository is public, `v0.1.0` is tagged, the image is public, the demo site is live, the README has the hero loop and Sponsors is approved.

| Order | Place | Plan |
| --- | --- | --- |
| 1 | r/selfhosted, selfh.st | Soft launch for early feedback. Fix what breaks before the larger posts |
| 2 | Hacker News, Show HN | A weekday morning, US Pacific time. Title names the problem and "self-hosted". The first comment explains the private endpoints and why there is no cloud version |
| 3 | Product Hunt and a Twitter thread, same day | A weekday launch at 12:01 a.m. Pacific. Tagline under 60 characters, the 16:9 video, the gallery stills, a maker comment |
| 4 | r/ClaudeAI, r/ChatGPTCoding, AlternativeTo, OpenAlternative, dev.to | Follow each community's self-promotion rules |
| 5 | awesome-selfhosted | Four months after `v0.1.0` |

Be direct about the policy risk in every post. Headroom reads private endpoints that the providers do not document for third parties, and each user accepts that risk for their own accounts. Never describe a private metric as official.
