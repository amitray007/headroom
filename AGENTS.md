# Working in Headroom

Headroom is a self-hosted web dashboard for AI account allowances, balances and usage.
This repository currently contains the project specification and research, not a working application.

- Read [docs/README.md](docs/README.md) for the document map and current implementation status.
- Before implementing a provider, read its dossier in `docs/providers/` and [the validation plan](docs/validation.md).
- Read [ADR 0001](docs/decisions/0001-direct-provider-clients.md) before changing architecture: an official CLI may run once for sign-in; refresh and collection are always direct HTTP from TypeScript.
- For account linking, persistence or security, read [the connection design](docs/architecture/connections.md) and [the data model](docs/architecture/data-model.md). Use its enumerations by name; do not invent state names in dossiers or code.
- Keep provider credentials, cookies, authorization codes, personal account identifiers and raw account responses out of source, fixtures, logs and shared artifacts. Use synthetic fixtures.
- Require a separate connection identity and credential boundary for every linked account. A folder path alone is not tenant isolation.
- Treat an unavailable metric as unknown, not zero. Keep monetary balances, credits, percentages and reset inventories in separate units.
- Preserve evidence labels: documented, source-inspected, prior observation, validated, and unvalidated. Label every metric `official` or `private`. A successful login does not prove quota access.
- Monitoring must not generate model requests, redeem resets or purchase credits. Mutating account actions require their own explicit user action and validated provider support.
- Zed is outside the current scope. A laptop helper is not part of the connection design. Headroom is personal self-hosted software and must not be designed as a hosted multi-user service.
- Run `mise run check` before claiming any change is done; it covers docs, format, type-aware lint, typecheck, Knip and tests. Use `mise run <task>` or `mise exec -- <command>`, never a global Bun. Update the docs index when adding a document.
- Enumerations live in `packages/core/src/enums.ts`. Add a state there and in the data model together, never in only one place.
- Pin every dependency to an exact version. Fix a lint or type error at its cause; do not add a disable directive without a one-line reason.
- Do not add copied global skills or speculative infrastructure. Record material implementation choices in `docs/decisions/`.
