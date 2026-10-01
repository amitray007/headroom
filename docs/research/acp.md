# ACP assessment

ACP can standardize communication between Headroom's server and some provider agents. It does not replace the provider-specific quota or balance connector.

Reviewed: 2026-10-01. This is a protocol assessment, not an implemented Headroom integration.

## Useful protocol features

Agents advertise authentication methods during initialization. The client can invoke agent-managed authentication, or support a separate interactive terminal login when that method is advertised. Logout is optional and must be capability-checked. Terminal login does not have a standard machine-readable output contract. [ACP authentication](https://agentclientprotocol.com/protocol/v1/authentication)

The backend can run an agent as a subprocess using JSON-RPC over standard input/output. A web frontend can talk to Headroom while Headroom speaks ACP internally. Native browser-to-agent transport is not required. Streamable HTTP remains a draft on the reviewed transport page. [ACP transports](https://agentclientprotocol.com/protocol/v1/transports)

The [TypeScript SDK](https://agentclientprotocol.com/libraries/typescript) is a candidate for the protocol plumbing. It is not an account vault, job supervisor or usage database.

## Metric boundary

Standard usage updates describe context token use, context-window size and optional cumulative session cost. They do not define the requested account-wide weekly quotas, prepaid wallets or banked reset inventories. [Session usage specification](https://agentclientprotocol.com/announcements/session-usage-stabilized)

Provider extensions may expose more, but an adapter must verify and version them. The Codex ACP implementation has its own rate-limit handling and an issue about exposing structured snapshots rather than text-only status. Prefer the native account protocol for that data where its use is permitted. [Codex ACP source](https://github.com/agentclientprotocol/codex-acp/blob/main/src/CodexAcpServer.ts), [rate-limit issue](https://github.com/agentclientprotocol/codex-acp/issues/227)

## Authentication boundary

ACP does not turn a localhost OAuth callback into a remote web callback. It does not register an OAuth application, grant a new scope, remove MFA or change provider authentication terms. Use the underlying provider's supported device, polling or returned-code flow.

For example, the Codex ACP bridge advertises a device-code method when the client supports URL elicitation. That is useful orchestration, but it inherits Codex's deployment restrictions and account protocol. [Authentication source](https://github.com/agentclientprotocol/codex-acp/blob/main/src/CodexAuthMethod.ts)

## Headroom decision

ACP is out of scope for collection and sign-in. [ADR 0001](../decisions/0001-direct-provider-clients.md) makes every connector a direct HTTP client, so there is no agent process for ACP to talk to. This assessment stays as the record of why.

The web Connect UI belongs to Headroom. Authentication eligibility belongs to the provider. Credential refresh has one owner per connector. See [the connection lifecycle](../architecture/connections.md).
