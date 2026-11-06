# ADR 0006: Read-only MCP server

Status: accepted on 2026-11-07 by the owner. The route is in [the API](../architecture/api.md#mcp).

## Context

Coding agents spend the same allowances that Headroom tracks. An agent that can see how much of a limit is left, when it resets and how a plan was used over the last months can pick an account, pace long work, or tell the owner that a plan is too small. The owner asked for this through MCP, kept minimal and cheap in tokens.

Headroom already has what the agent needs: the app feed for the current state ([ADR 0004](0004-mac-app.md)), the stored history for the past ([D38](README.md)), and app tokens.

## Decision

- One endpoint, `POST /api/mcp`, on the same server. It uses Streamable HTTP through the official TypeScript SDK, `@modelcontextprotocol/server` 2.x. The SDK's `createMcpHandler` serves the 2026-07-28 revision and answers 2025-era clients statelessly, so the server keeps no MCP session.
- Authentication is an app token in `Authorization: Bearer`, the same token as the Mac app, through the same guard, with its own failed-attempt window. A session cookie does not authenticate it. Any scope works, and no tool uses the `refresh` scope (D44).
- Two tools, both annotated read-only:
  - `status`: every account's limits now, from the app feed: percent left, reset, the pace projection, charges, banked resets and the plan total.
  - `history`: each account's main limit over 7, 30 or 90 days, from the stored history: windows, average and highest peak, times at the limit, early resets, the Plan fit verdict and the estimated unused plan cost.
- Results are short plain text, one line per fact, with relative times. No structured JSON, no ids, no identity beyond the display name, no credential, no raw response.
- The Analytics model and the Plan fit verdict move from the web app to `@headroom/view-model`, so the dashboard and MCP compute one answer.

## Not included

- No tool that changes state: no refresh, reset, setting or Wallet change.
- No Rhythm report. Its hour-of-week grid suits a person; an agent gets the times at the limit from `history`.
- No notices tool and no resources or prompts. `status` already states what a notice would.
- No stdio transport. Clients that speak only stdio can use a remote-MCP bridge.

## Consequences

- An agent with the token reads the same account data as the Mac app. The owner revokes it in Settings, Devices.
- A `history` call reads stored readings and blocks the single thread while it folds them. It reads the same 90 days as Analytics, in the time zone the dashboard used last, so it reuses that fold and a call costs about as much as an Analytics visit. Before the dashboard first asks, it folds in UTC.
- The SDK adds one runtime dependency with its core package.
