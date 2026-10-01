# syntax=docker/dockerfile:1.7
# Build the single binary, then ship it with the pinned login-only CLIs.

FROM oven/bun:1.4.2 AS build
WORKDIR /src
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/connectors/claude/package.json packages/connectors/claude/package.json
COPY packages/connectors/codex/package.json packages/connectors/codex/package.json
COPY packages/connectors/grok/package.json packages/connectors/grok/package.json
COPY packages/connectors/vercel-ai-gateway/package.json packages/connectors/vercel-ai-gateway/package.json
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.2-slim AS runtime
# Pinned official CLIs, used once per Connect for sign-in only. Versions match ADR 0002.
RUN bun add -g @openai/codex@0.159.3 @anthropic-ai/claude-code@2.1.286 && codex --version && claude --version
# Grok ships a prebuilt binary through its official installer; GROK_BIN_DIR places it, HOME holds the download.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /opt/grok && GROK_BIN_DIR=/usr/local/bin HOME=/opt/grok bash -c "$(curl -fsSL https://x.ai/cli/install.sh)" \
  && grok --version
RUN useradd --system --uid 10001 --create-home --home-dir /var/lib/headroom headroom \
  && mkdir -p /var/lib/headroom/data /etc/headroom \
  && chown -R headroom:headroom /var/lib/headroom /etc/headroom
COPY --from=build /src/dist/headroom /usr/local/bin/headroom
COPY --from=build /src/apps/web/dist /usr/local/share/headroom/web
USER headroom
ENV HEADROOM_DATA_DIR=/var/lib/headroom/data \
    HEADROOM_MASTER_KEY_FILE=/etc/headroom/master.key \
    HEADROOM_AUTH_SECRET_FILE=/etc/headroom/auth.secret \
    HEADROOM_PORT=8080 \
    HEADROOM_WEB_DIR=/usr/local/share/headroom/web
VOLUME ["/var/lib/headroom/data", "/etc/headroom"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["headroom"]
