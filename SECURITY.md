# Security and credential handling

Headroom has no deployed service or released application yet. This file defines requirements for implementation; it is not a claim that those controls already exist.

## Sensitive information

Do not put API keys, access tokens, refresh tokens, browser cookies, authorization codes, raw login output or personal account responses in issues, documentation, fixtures or logs. Use synthetic examples.

Browser approval must happen on the provider's verified domain. Headroom must not collect provider passwords or MFA codes. A provider-returned authorization code may be passed to its waiting login process when that supported flow requires it; treat that code as a short-lived secret.

## Runtime boundaries

- Authenticate the dashboard user before starting a provider login.
- Authorize every attempt, connection, snapshot and action against its owner.
- Give a connector call only the selected connection's credentials. Headroom is single-owner software; do not present it as multi-tenant.
- Keep token storage private and encrypted at rest. Keep the encryption key outside the database and version control.
- Protect API routes against cross-site requests and bind every login attempt to its initiating user.
- Restrict login URLs to the expected provider domains. A pasted redirect URL or displayed code is a short-lived secret: consume it once, never log it, never store it after the exchange.
- Start the process with an allowlisted environment. Never pass host tokens such as `GH_TOKEN` or `XAI_API_KEY` into a connector.
- Keep one credential writer per connection under a lease. Persist a rotated refresh token before using the new access token.
- Remove access when disconnected. Distinguish local deletion from provider-side token revocation.

See [the deployment design](docs/architecture/deployment.md) for storage and isolation requirements.

## Reporting

A private reporting channel must be established before a public release. Until then, do not publish a security report that contains credentials or private account details. Contact the maintainer through an already established private channel.
