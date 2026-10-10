# Releases

How Headroom chooses a version, publishes it and rolls it back. The decision is D33 in the [decision register](../decisions/README.md).

## Commit subjects

Every commit subject on `main` is a [Conventional Commit](https://www.conventionalcommits.org). The type decides the next version:

| Subject | Next version from 0.4.2 | After 1.0, from 1.2.3 |
| --- | --- | --- |
| `fix: ...`, `perf: ...` | 0.4.3 | 1.2.4 |
| `feat: ...` | 0.4.3 | 1.3.0 |
| `feat!: ...` or a `BREAKING CHANGE:` footer | 0.5.0 | 2.0.0 |
| `docs`, `test`, `refactor`, `build`, `ci`, `chore`, `style` | no release | no release |

A scope is optional: `fix(codex): ...`. The `commits` job in CI rejects a subject without a type. Run `scripts/check_commits.sh origin/main HEAD` before a push to check the same thing locally.

Before 1.0, a feature bumps only the patch, so releases go 0.1.0, 0.1.1, 0.1.2. A breaking change still bumps the minor, so a user who pins `0.4` never receives one. Raise the minor or major version on purpose with the `Release As` workflow below.

## Cutting a release

1. A push to `main` runs the `Release` workflow. It opens or updates one pull request, "chore(main): release X.Y.Z", with the version bump and the `CHANGELOG.md` entry.
2. Merge that pull request when you want to ship. Release-please then tags `vX.Y.Z`, creates the GitHub release and calls the `Image` workflow. It also calls the `Pages` workflow, which redeploys the site.
3. The `Image` workflow installs the current sign-in CLIs (D37), builds `linux/amd64` and `linux/arm64`, pushes the image as `sha-<short>`, smoke-tests it and only then adds the public tags. The smoke test checks the version, the health check and a started and cancelled sign-in with Codex, Claude Code and Grok.

To ship a minor or major version instead of the next patch:

1. Open Actions > Release As > Run workflow on `main`.
2. Choose `minor` (0.4.2 to 0.5.0) or `major` (0.4.2 to 1.0.0), or type an exact version.
3. The workflow adds an empty commit `chore: release X.Y.Z` with a `Release-As: X.Y.Z` footer to `main` and runs `Release`, which retitles the release pull request to that version.
4. Merge the pull request as usual.

The same footer works from a terminal: `git commit --allow-empty -m "chore: release 0.5.0" -m "Release-As: 0.5.0"`, then push. Commits after that release return to the patch default.

Release-please updates `package.json` and `apps/server/src/version.ts`, so `headroom --version` and `/healthz` report the release.

## Image tags

| Event | Tags on `ghcr.io/amitray007/headroom` |
| --- | --- |
| Push to `main` | `edge`, `sha-<short>` |
| Release 0.4.2 | `0.4.2`, `0.4`, `latest`, `sha-<short>` |
| Release 1.2.3 | `1.2.3`, `1.2`, `1`, `latest`, `sha-<short>` |

Each image carries OCI labels, a build provenance attestation and an SBOM. A failed smoke test publishes no public tag, so `latest` stays on the previous release.

## Binaries

The `Binaries` workflow attaches a standalone binary, with the web UI embedded, to each GitHub release. Each platform builds on a runner of its own architecture, so the smoke test runs the real binary.

| Asset | Runner |
| --- | --- |
| `headroom-darwin-arm64.tar.gz` | `macos-15` |
| `headroom-darwin-x64.tar.gz` | `macos-15-intel` |
| `headroom-linux-x64.tar.gz` | `ubuntu-24.04` |
| `headroom-linux-arm64.tar.gz` | `ubuntu-24.04-arm` |

Each archive holds exactly `headroom` (mode 0755), `LICENSE` and `THIRD_PARTY_NOTICES.md` at its root. `SHA256SUMS` lists every archive as `<sha256>  <filename>`, sorted by filename. Check a download with `sha256sum -c SHA256SUMS` (`shasum -a 256 -c` on macOS).

How a build runs:

1. Each leg builds the web UI and the binary, then runs `scripts/smoke-binary.sh`. The script checks `--version` and `--help`, starts the server on a free port with a temporary home, and checks that `/healthz` reports the version and `/` serves the web UI.
2. The `publish` job runs only after all four legs pass. It writes `SHA256SUMS`, verifies it and uploads the files with `gh release upload --clobber`. A failed leg uploads nothing. Only this job has `contents: write`.
3. The release workflow must call `binaries.yml` with `contents: write`, `id-token: write` and `attestations: write`. A called workflow cannot hold more permission than its caller.

Signing: the macOS binaries are signed ad hoc (`codesign --sign -`), which gives Apple silicon the signature it requires to run. They are not notarized. A file downloaded by `curl`, Homebrew, npm or pip gets no quarantine flag, so Gatekeeper does not block it. A file saved by a browser does get the flag; clear it with `xattr -d com.apple.quarantine headroom`.

Provenance: the `publish` job attests the archives with `actions/attest-build-provenance` only while the repository is public. Verify one with `gh attestation verify <archive> --repo amitray007/headroom`.

To rebuild the assets of an existing release, open Actions > Binaries > Run workflow, type the version without the `v` and keep `publish` on. The workflow builds from the tag `vX.Y.Z` and replaces the assets on that release. Turn `publish` off to build and test without uploading.

## The public site

The `Pages` workflow runs `mise run site:build` and deploys `dist-site/` to GitHub Pages: the landing page from `site/index.html` at the root and the demo (D34) at `demo/`. It runs after each release and by hand from the Actions tab, so the site shows the released app, not `main`. The `site` job in CI builds it on every pull request. How the build works is in [site/README.md](../../site/README.md).

## Rolling back

- A user pins the previous release: `ghcr.io/amitray007/headroom:0.4.1`.
- To move `latest` back, point it at the previous release's digest:

```sh
docker buildx imagetools create -t ghcr.io/amitray007/headroom:latest ghcr.io/amitray007/headroom:0.4.1
```

- Then ship the fix as a new `fix:` release. Do not delete or move a version tag: other people may have pulled it.

Database migrations run forward only. Before an upgrade that names a migration in the changelog, back up the data and key volumes together.
