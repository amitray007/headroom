# Security policy

Headroom stores sign-in credentials for your AI accounts. We take reports about it seriously.

## Report a vulnerability

Do not open a public issue. Report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. Include:

- what an attacker can do, and what they need first (network position, a session, local access);
- the steps to reproduce, with synthetic data only;
- the affected version or commit.

Never include real tokens, cookies, authorization codes or provider responses. The maintainer aims to answer within a week. Fixes ship as soon as they are ready, and reporters are credited unless they ask not to be.

## Supported versions

Security fixes go to `main` and ship in the next release. The latest release is the supported version; update to it before you report a problem that an older version may cause.

## Threat model

Headroom is single-owner software for a server you control, ideally reachable only from your own network (see [Self-hosting on a tailnet](docs/operations/tailscale.md)). In scope:

- authentication, sessions and cross-site request handling;
- the encryption of stored credentials and notification secrets;
- leaks of credentials or provider data into logs, error messages, API responses, notifications or the browser;
- requests a connector sends, including redirects and timeouts;
- the container image and deployment files.

Out of scope: an attacker with root on the host or read access to both the database and the master key, and changes in a provider's private endpoints.

## How Headroom protects credentials

- Each account's credentials are sealed with AES-256-GCM, bound to that account. The master key sits outside the database, and the database files are readable by the app user only.
- One owner account. Sign-up closes atomically after the first account. Sessions are checked against the database on every API call.
- Provider requests time out after 20 seconds. A redirect to another host drops every credential header, and a downgrade to plain HTTP is refused.
- Provider errors become fixed messages. Raw responses are never stored or shown, and CLI sign-in output is redacted.
- Monitoring is read-only. The one account action, using a banked Codex reset, needs an owner setting plus a press-and-hold or an auto-reset rule the owner configured. Headroom never buys credits.

Details: [Deployment and credential storage](docs/architecture/deployment.md) and [Connections](docs/architecture/connections.md).
