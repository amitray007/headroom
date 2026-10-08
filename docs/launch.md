# Launch

Public launch work: deploy targets, funding and listings. Each item says what it needs and what gates it. Policy posture stays the same: Headroom is self-hosted software, never a hosted service ([roadmap](roadmap.md#working-agreements)). Remove an item when it ships.

## Gates

1. Finish the release-readiness checks in [M6](roadmap.md#m6-actions-and-release-readiness): dependency licenses, CLI redistribution terms, attribution, deployment instructions.
2. Make the repository public. Then enable private vulnerability reporting and upload the social preview image.
3. Tag the first release. Some listings count the project's age from that date.

## Deploy targets

Do these in order. The image comes first because every other target pulls it.

| Target | What to build | Gate |
| --- | --- | --- |
| Docker | A multi-arch image (`linux/amd64`, `linux/arm64`) published to GHCR on each tag by a release workflow. Change `deploy/compose.yaml` to pull it, keeping `build:` as an option. Document a one-line `docker run` with one data volume. Confirm the first run needs no settings and creates the master key itself. | None |
| Railway | A template with a volume and the image. Railway pays template authors a share of the compute their template uses (25% in the docs at the time of writing). | Image |
| Render | A `render.yaml` blueprint and a "Deploy to Render" button in the README. The service needs a persistent disk. | Image |
| DigitalOcean | A 1-Click Droplet in the Marketplace: a vendor account and a Packer image that runs the container. | Image, vendor approval |
| Dokploy | A template in the `Dokploy/templates` repository. Dokploy asks for a test on a real server and a screenshot in the pull request. | Image |
| Coolify | Users can deploy the compose file today. A one-click service template needs 1,000 GitHub stars. | Stars |

No serverless target: Headroom needs a long-running process.

## Funding

- Join GitHub Sponsors and wait for approval.
- Add `.github/FUNDING.yml` with `github: amitray007` after approval. Add Polar or Ko-fi entries only if you open those accounts.
- Railway template revenue is the only income tied to deployments. Do not sell a license for the subscription connectors: OpenAI restricts its authentication for "commercial or hosted services" ([Codex dossier](providers/codex.md)).

## Listings and launch posts

Before posting:

- A README hero GIF or screenshot from Demo Mode.
- A public demo site that runs Demo Mode on synthetic data, with no sign-in.
- One sentence on why there is no cloud version: your tokens stay on your server.

Where to post:

| Place | Note |
| --- | --- |
| Product Hunt | Launch on a weekday with the demo link and the GIF |
| Hacker News (Show HN) | Lead with the self-hosted, read-only design |
| Reddit: r/selfhosted, r/ClaudeAI, r/ChatGPTCoding | Follow each subreddit's self-promotion rules |
| selfh.st weekly | Submit the release |
| AlternativeTo, OpenAlternative | List as an open source alternative to provider usage pages and paid usage trackers |
| awesome-selfhosted | Requires a first release more than 4 months old |
| Docker Hub | Mirror the image for discovery |
