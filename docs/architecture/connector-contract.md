# Connector contract

Each provider is one TypeScript module that implements one interface. The application never learns provider specifics beyond the typed values below. This is a specification, not code in the repository.

## Operations

| Operation | Input | Result |
| --- | --- | --- |
| `BeginConnect` | Attempt, method, provider options, optional existing connection for Reconnect | First next step and connector-private attempt state |
| `SubmitInput` | Attempt and one typed input: pasted redirect URL, displayed code, API key, account or team selection | Next step, or credentials ready for validation |
| `PollConnect` | Attempt | Still waiting, credentials ready, or terminal error; used by device-code and polling flows, and by a next step that asks to be polled while input is awaited |
| `CancelConnect` | Attempt | Cleanup of connector-private state |
| `Identity` | Credentials | Provider account id, workspace or team choices, display label, assurance level |
| `Capabilities` | Credentials, identity | Per-metric and per-action availability with interface label and evidence level |
| `Collect` | Credentials, identity, requested metric groups | Normalized snapshot plus per-metric failures |
| `Refresh` | Credentials | `refreshed` with new credentials, `not_refreshable`, `transient` with retry guidance, or `rejected` (definitive) |
| `Classify` | Provider response or error | `transient`, `capability`, `definitive`; the application applies the lifecycle rules from the class |
| `Disconnect` | Credentials | Revocation result: `revoked`, `local_only` or `failed` |
| `PerformAction` | Credentials, explicit action, idempotency key | Outcome or `uncertain`; deferred feature |

Connector-private attempt state (PKCE verifier, device auth id, poll interval, CLI process handle and directory path) is stored by the application in the attempt row, encrypted, and handed back on every call. Connectors keep no memory between calls. A CLI login attempt is the one case that cannot survive a process restart: on restart the runner marks it `failed` and the user starts again.

A connector that uses CLI login implements `BeginConnect` by asking the shared CLI runner for a process with the provider's command, config-directory variable and output patterns. The runner owns spawning, bounding and redaction; the connector owns reading and validating the credentials file it produces.

## Next-step variants

- `open_url`: provider approval URL and expiry.
- `device_code`: verification URL, user code and expiry. The polling credential never reaches the browser.
- `paste_redirect`: approval URL plus a field that accepts the redirected URL or the displayed code; the connector extracts code and state.
- `select_account`: list of accounts or teams with stable ids and labels; the user picks one.
- `api_key`: fields for that provider and a link to its key page.
- `paste_file`: a field for the contents of an existing CLI or CLIProxyAPI auth file, with the expected file name shown.

These are Headroom interface choices. A provider supports only the variants its dossier lists.

## Adapter obligations

Call the exact endpoints the dossier lists and nothing else. Keep every endpoint, header set and response shape in one file per provider, validated with a Zod schema, with a synthetic fixture for success, partial response and schema drift. A Zod parse failure is `invalid_response` for that metric only.

Return unsupported metrics explicitly. Preserve unknown provider buckets as diagnostic metadata only after redaction; do not invent a familiar model label for an opaque key.

Never log a request or response body. Log the endpoint name, status code, duration and a sanitized error class.

Label each metric `official` or `private` from the dossier. A private endpoint that starts returning a different shape yields `invalid_response` for that metric and leaves the others intact.

## Error categories

Use `approval_expired`, `approval_denied`, `authentication_required`, `permission_denied`, `rate_limited`, `provider_unavailable`, `unsupported_metric`, `identity_mismatch`, `invalid_response`, `selection_required` and `internal_error`. Each carries a class: `authentication_required` and `identity_mismatch` are definitive; `permission_denied`, `unsupported_metric` and `invalid_response` are capability; `rate_limited` and `provider_unavailable` are transient. Attach a safe user message and retry guidance. Never return a token-bearing URL or exception body.

## Version policy

Record the connector version and fixture version in every snapshot and capability row. A change to an endpoint, header or parser bumps the connector version and repeats that provider's validation checks.
