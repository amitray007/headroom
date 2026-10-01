# Connection lifecycle

A Connect starts a bounded login attempt on the server. Its result is a connection with encrypted credentials that outlive the attempt. The owner has exactly three actions on a connection: **Connect**, **Reconnect** and **Disconnect**. Refresh is automatic and never an owner action; an internal "Refresh now" control may exist for diagnosis and changes no state.

**Status: proposed application behavior. Provider mechanisms are documented in the dossiers.**

## Owner actions

| Action | When it is offered | What it does |
| --- | --- | --- |
| Connect | Always, per enabled provider | Starts a new attempt and creates a new connection on success |
| Reconnect | Only when the connection is `reconnect_required` | Starts a new attempt bound to the existing connection; on success replaces its credentials and keeps its history, label and selection |
| Disconnect | Always on an existing connection | Stops jobs, revokes at the provider where a documented endpoint exists, deletes the credential row; history deletion is a separate retention choice |

Cancel is part of an attempt, not an action on a connection: it kills any CLI process, deletes the attempt directory and removes the attempt. There is no owner-facing "refresh token", "re-authorize" or "repair" action. If credentials stop working, the connection shows `reconnect_required` with a reason, and Reconnect is the one button.

## Browser flow

1. The signed-in owner chooses a provider whose connector is enabled, or presses Reconnect on a connection.
2. The backend creates a login attempt with a random identifier and an expiry. For a CLI login it also creates a temporary per-connection config directory; for a direct OAuth client it stores a PKCE verifier and state server-side.
3. The connector returns a typed next step: a URL to open, a device code to enter, a field to paste a redirected URL or code into, an account to choose, a key to enter, or a credential file to paste.
4. The browser shows only that step and polls the attempt status. No persistent HTTP connection is needed.
5. The connector finishes the exchange: the CLI completes and writes its file, the provider token endpoint answers the poll, or the pasted input is consumed.
6. The backend reads identity and runs one read-only collection with the new credentials.
7. The backend stores the encrypted credentials, capabilities and first snapshot, deletes any temporary directory, and marks the connection `ready` or `partial`.

Closing a browser tab does not cancel an attempt. Let it expire or provide an explicit Cancel control. The next page load can resume displaying a still-valid attempt.

## Login methods

| Method | Browser step | Server behavior | Candidates |
| --- | --- | --- | --- |
| CLI login | Open the URL or enter the device code the CLI printed; paste a code back when the CLI asks | Spawn the pinned official CLI headless with a per-connection config directory and an allowlisted environment; parse only the URL, code and terminal state; feed the pasted code to stdin; read and encrypt the credentials file it writes; delete the directory | Codex, Claude, Grok |
| Device code | Open provider URL, enter the shown code, approve | Poll the provider token endpoint until approved, denied or expired | Copilot; fallback for Codex and Grok |
| Pasted redirect | Open provider URL, approve, paste the redirected URL or displayed code | Verify state, exchange the code with the stored PKCE verifier | Antigravity; fallback for Claude |
| Approval with polling | Open provider URL and approve | Poll the provider with the stored verifier | Cursor member |
| API key | Create a key on the provider site and paste it once | Validate scope, resolve account or team, require selection when several | Vercel, Cursor admin, Grok API |
| Credential import | Paste the contents of an existing CLI or CLIProxyAPI auth file | Validate shape, read identity, re-encrypt, never write the plaintext back | Codex, Claude, Grok |

Never rewrite a provider's registered localhost redirect into the dashboard's domain. A remote server's localhost is not the browser user's localhost. The pasted-redirect step and the CLIs' own headless modes exist because of that.

## CLI login runner

The runner is a plain `Bun.spawn` or pseudo-terminal wrapper in the backend, never a virtual shell. It sets only the CLI's config-directory variable (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GROK_HOME` or the documented equivalent) plus `PATH` and `HOME` pointing inside the attempt's directory. It bounds runtime and output, redacts everything except the URL, code and exit state, and kills the process on expiry or cancel. The CLI is used for sign-in only. Refresh and collection are direct HTTP against the stored token, and the CLI never runs again for that connection.

## Attempt states

| State | Meaning | Allowed next step |
| --- | --- | --- |
| `created` | Owned attempt exists | Connector produces the first next step |
| `awaiting_user` | The user must act on the provider site | Provider result, cancel or expiry |
| `awaiting_input` | Headroom needs a pasted code, redirected URL, key, file or account choice | Submit input, cancel or expiry |
| `validating` | Credentials obtained; identity and data access are being checked | `succeeded` or `failed` |
| `succeeded` | Connection saved | Read the connection |
| `failed` | Definitive failure with a sanitized reason | Start a new attempt |
| `expired` | Deadline elapsed | Start a new attempt |
| `cancelled` | User cancelled and temporary state was removed | Start a new attempt |

These are the only attempt states. Dossiers use these names.

## Connection states

| State | Meaning | Owner sees |
| --- | --- | --- |
| `ready` | Credentials valid; every validated metric collected on the last successful run | Metrics with data age |
| `partial` | Credentials valid; one or more requested metrics unavailable, with reasons on the capabilities | Metrics plus a per-metric reason |
| `reconnect_required` | Credentials definitively unusable; see reasons below | Last snapshot with its age, the reason, and the Reconnect button |
| `paused` | Owner paused scheduling; credentials retained | Last snapshot, a Resume control |

Authentication state and metric health are separate. A `ready` connection can have a failed latest run. Metric availability lives on capabilities and metric rows, not on the connection.

## Automatic refresh

Refresh is the connector's job and runs inside the collection lease, never as a separate owner-visible step.

1. **Before a run.** If the credential has a known expiry and it is within the refresh lead (default five minutes, provider-overridable), refresh first. Expiry comes from the token's `exp` claim or an `expires_at` field in the credentials file, whichever the dossier names.
2. **Unknown expiry.** If the provider gives no expiry, do not refresh proactively. Collect, and refresh reactively on a 401.
3. **Reactively.** On a 401 from a collection endpoint, refresh once and retry the request once. A second 401 is definitive.
4. **Persist first.** A rotated refresh token is written to the credential row before the new access token is used. If the process dies between the provider rotating and Headroom persisting, the next run gets `invalid_grant`, which is definitive and correctly leads to Reconnect rather than a silent loop.
5. **No refresh token.** Providers that issue non-expiring or non-refreshable credentials (API keys, GitHub OAuth app tokens) skip refresh. A 401 there is immediately definitive.

Refresh needs the provider's token endpoint and the public client id the official CLI uses. Those constants are embedded per connector and listed in each dossier. This is the one place the CLI-login route still carries a provider constant.

## Failure classification

Every failed request is classified before it can change anything. Only definitive failures change connection state.

| Signal | Class | Effect |
| --- | --- | --- |
| Refresh returns `invalid_grant`, `invalid_token` or an equivalent documented rejection | Definitive | `reconnect_required`, reason `refresh_rejected` |
| 401 that survives one refresh and retry, or 401 where no refresh exists | Definitive | `reconnect_required`, reason `token_rejected` |
| Identity read returns a different account or workspace than stored | Definitive | `reconnect_required`, reason `identity_changed`; never overwrite silently |
| 403 or a documented permission response on one metric | Capability | That metric `not_authorized`; connection `partial`; no reconnect |
| Provider-specific "account shape" responses, such as Grok's 412 for team logins | Capability | That metric unavailable with the dossier's reason; connection `partial` |
| 429 or `Retry-After` | Transient | Run `rate_limited`; schedule by `Retry-After` or backoff; state unchanged |
| 5xx, timeout, DNS or TLS failure | Transient | Run `provider_unavailable`; backoff with jitter; state unchanged |
| Schema validation failure on one endpoint | Capability | That metric `invalid_response`; others stored; connector version flagged |

A transient failure never produces a Reconnect prompt. A definitive failure never retries automatically.

## Staleness

Transient failures can continue for days while the connection stays `ready`. The card therefore always shows data age from `last_success_at`, and when that age exceeds the staleness threshold (default twelve hours, provider-overridable) the card shows a "no fresh data since" notice and the run error class. Staleness is information, not a state change, and does not offer Reconnect. Notification outside the dashboard is deferred to M5.

## Reconnect

Reconnect starts an attempt with the existing connection id. The new credentials must resolve to the same provider account id and workspace; a mismatch ends the attempt as `failed` with `identity_changed` and offers the owner Connect as a new connection instead. On success the credential row is replaced, `reconnect_reason` is cleared, the capabilities are re-read, and history continues unbroken.

What the owner re-enters depends on the method:

| Method | Owner re-enters |
| --- | --- |
| CLI login | Completes the provider sign-in again from the device code or pasted code |
| Device code, pasted redirect, approval poll | Approves again on the provider site |
| API key | A new key; the stored team or account selection is kept |
| Credential import | A fresh file from the CLI |

Provider-side invalidation is a validation item per dossier: for example `grok login` replaces the cached session, so a later sign-in elsewhere may make Headroom's token definitive-fail.

## Scheduling

Use a per-connection lease for login, refresh, collection and actions. Bound every request with a timeout. Respect `Retry-After` and apply backoff with jitter. Never trigger a model request as a health check. An internal "Refresh now" control enqueues one run under the same lease and rate limit and is otherwise identical to a scheduled run.

Store attempt time, successful observation time and a sanitized error separately. A failed run never produces a fresh-looking copy of old values.

## First proof

Implement Codex first: `codex login --device-auth` in the runner from a browser on another device, read and encrypt its `auth.json`, identity from the token, `wham/usage` collection, process restart, proactive refresh, a forced `invalid_grant` leading to `reconnect_required`, and Reconnect restoring the same connection. Then connect a second Codex account and prove no credential or snapshot crosses between them. See [validation](../validation.md).
