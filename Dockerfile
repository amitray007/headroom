# syntax=docker/dockerfile:1.7
# Build the single binary, then ship it with the official login-only CLIs.

# The build stage runs on the builder's own platform and cross-compiles the binary for the target,
# so a multi-arch build emulates only the runtime stage.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.2 AS build
ARG TARGETARCH
WORKDIR /src
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/view-model/package.json packages/view-model/package.json
COPY packages/connectors/antigravity/package.json packages/connectors/antigravity/package.json
COPY packages/connectors/claude/package.json packages/connectors/claude/package.json
COPY packages/connectors/codex/package.json packages/connectors/codex/package.json
COPY packages/connectors/copilot/package.json packages/connectors/copilot/package.json
COPY packages/connectors/cursor/package.json packages/connectors/cursor/package.json
COPY packages/connectors/grok/package.json packages/connectors/grok/package.json
COPY packages/connectors/vercel-ai-gateway/package.json packages/connectors/vercel-ai-gateway/package.json
RUN bun install --frozen-lockfile
COPY . .
RUN case "$TARGETARCH" in \
      amd64) bun_target=bun-linux-x64 ;; \
      arm64) bun_target=bun-linux-arm64 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
  && bun run web:build && bun run build:server --target="$bun_target"

FROM oven/bun:1.4.2-slim AS runtime
# The official CLIs, used once per Connect for sign-in only, installed unmodified from each vendor.
# The image workflow passes the current releases: Codex's latest, Claude Code's stable channel and Grok's
# stable release, and it smoke-tests a sign-in with each before the image gets a public tag. The defaults
# are the versions last validated by hand, for local builds. The CLIs install outside root's home so the
# unprivileged app user can run them.
ARG CODEX_VERSION=0.159.3
ARG CLAUDE_CODE_VERSION=2.1.286
ENV BUN_INSTALL_GLOBAL_DIR=/opt/bun-global
RUN bun add -g "@openai/codex@${CODEX_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  && codex --version && claude --version
# Grok ships a prebuilt static binary. The vendor installer does not check a checksum, so the binary is
# fetched directly and verified against a SHA-256 per architecture. The image workflow reads the version
# from https://x.ai/cli/stable and hashes both binaries; for a local build, change all three ARGs together.
ARG TARGETARCH
ARG GROK_VERSION=1.0.46
ARG GROK_SHA256_AMD64=41626a53292324140b92556b9d42ff5542e3dcd04aff85eafb8689dd4adb44fc
ARG GROK_SHA256_ARM64=45b0943e736f00a249b9cf02af2be9e0749d97c09a6f55cfcf3029a1a836f23e
LABEL club.theblank.headroom.codex-version="${CODEX_VERSION}" \
      club.theblank.headroom.claude-code-version="${CLAUDE_CODE_VERSION}" \
      club.theblank.headroom.grok-version="${GROK_VERSION}"
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && case "$TARGETARCH" in \
       amd64) grok_arch=x86_64; grok_sha="$GROK_SHA256_AMD64" ;; \
       arm64) grok_arch=aarch64; grok_sha="$GROK_SHA256_ARM64" ;; \
       *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
     esac \
  && curl -fsSL -o /tmp/grok "https://x.ai/cli/grok-${GROK_VERSION}-linux-${grok_arch}" \
  && echo "${grok_sha}  /tmp/grok" | sha256sum -c - \
  && install -m 0755 /tmp/grok /usr/local/bin/grok && rm /tmp/grok \
  && grok --version
RUN useradd --system --uid 10001 --create-home --home-dir /var/lib/headroom headroom \
  && mkdir -p /var/lib/headroom/data /etc/headroom \
  && chown -R headroom:headroom /var/lib/headroom /etc/headroom
COPY --from=build /src/dist/headroom /usr/local/bin/headroom
COPY --from=build /src/apps/web/dist /usr/local/share/headroom/web
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/doc/headroom/
COPY LICENSES /usr/share/doc/headroom/LICENSES
USER headroom
# The login CLIs must run as the app user, not only as root.
RUN codex --version && claude --version && grok --version
ENV HEADROOM_DATA_DIR=/var/lib/headroom/data \
    HEADROOM_MASTER_KEY_FILE=/etc/headroom/master.key \
    HEADROOM_AUTH_SECRET_FILE=/etc/headroom/auth.secret \
    HEADROOM_HOST=0.0.0.0 \
    HEADROOM_PORT=8080 \
    HEADROOM_WEB_DIR=/usr/local/share/headroom/web
VOLUME ["/var/lib/headroom/data", "/etc/headroom"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["headroom"]
