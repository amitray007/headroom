# Glossary

| Term | Meaning |
| --- | --- |
| Dashboard user | A person authenticated to Headroom |
| Connection | One linked provider account/workspace owned by a dashboard user |
| Login attempt | A temporary approval workflow that can succeed, fail, expire or be cancelled |
| Credential store | The encrypted `credentials` table; one row and one writer per connection |
| Connector | One TypeScript module per provider: sign-in, refresh, identity, collection and actions |
| CLI login runner | Backend wrapper that spawns a pinned official CLI once for sign-in, bounded and redacted; never used for refresh |
| Credential import | Pasting an existing CLI or CLIProxyAPI auth file into Headroom, which re-encrypts it |
| Interface label | `official` for a documented API, `private` for an endpoint the official client calls without published terms |
| Scope | Whose data a connection sees: `individual`, `member`, `team_admin` or `organization` |
| Next step | The one typed action the browser shows during an attempt: open a URL, enter a device code, paste a redirect, select an account or enter a key |
| Collector | The read-only part of a connector that fetches observations |
| Snapshot | A timestamped provider observation, independent of a chart or cache refresh |
| Quota bucket | A provider-defined allowance with a unit, scope and often a renewal window |
| Session limit | A provider's named short-window allowance; not necessarily the lifetime of a chat session |
| Weekly limit | A provider-defined weekly bucket; do not assume a calendar-week boundary |
| Model limit | A bucket scoped to a model or model group, possibly overlapping broader limits |
| Reset time | The time a bucket is expected to renew |
| Reset count | An inventory of redeemable resets, not elapsed weeks or resets observed by Headroom |
| Redeemable reset | A reset grant currently eligible to consume, possibly fewer than the total inventory |
| Credits | A provider-specific unit; not automatically USD or tokens |
| Prepaid balance | Money or credit units remaining in an account wallet |
| Spend | Consumption charged during a specified period |
| Spending cap | A configured ceiling, not the account's included allowance |
| ACP | Agent Client Protocol; a client/agent protocol, not a universal billing API |
| Device authorization | Approval on a provider website while a remote process polls for completion |
| Pasted redirect | Browser sign-in that ends on the provider's registered localhost URL; the user pastes that URL or the displayed code into Headroom |
| Callback bridge | Optional listener on a provider's registered localhost port that forwards into Headroom for users who port-forward; not required |
| Documented | Described by the provider's official documentation or protocol |
| Source-inspected | Implemented in reviewed code; may use an unsupported private interface |
| Prior observation | Reported result from earlier account checks; not reproduced during this project setup |
| Unvalidated | A proposal or source-based candidate without the required runtime evidence |
