---
name: provider-connector
description: Change, add or review a Headroom provider connector in `packages/connectors/`. Use when a provider metric parses wrong, a response shape changes, a provider needs a new endpoint or a new provider is added, or when reviewing a connector pull request.
---

# Provider connector

A connector reads one provider's quota and balance data over direct HTTP. Its rules live in four documents; read the ones the change touches before writing code:

- the provider's dossier, `docs/providers/<provider>.md`: endpoints, metric labels, evidence;
- [the connector contract](../../../docs/architecture/connector-contract.md): adapter obligations, error categories, version policy;
- [the validation plan](../../../docs/validation.md): what counts as proof per provider;
- [ADR 0001](../../../docs/decisions/0001-direct-provider-clients.md) when sign-in changes.

## Fix or extend a connector

1. **Reproduce with a fixture.** Add a synthetic response to `src/fixtures/` in the reported shape. Replace every email, id, name, token and URL with an invented value. Write the test that fails on it before you change code.
2. **Change the parser at its schema.** Response shapes are Zod schemas in `src/schemas.ts`; endpoints and headers live only in `src/endpoints.ts`. Call only endpoints the dossier lists; a new endpoint goes into the dossier first, with its evidence label.
3. **Keep unknown unknown.** A missing or unparseable value is `invalid_response` for that one metric, and the other metrics keep their values. Never default to 0. Money, credits and percentages stay in separate units. Add a schema-drift fixture when the change touches parsing.
4. **Bump the version.** Any endpoint, header or parser change raises `<provider>ConnectorVersion` in `src/index.ts`.
5. **Update the dossier.** Each touched metric keeps its `official` or `private` label and an evidence label: documented, source-inspected, prior observation, validated or unvalidated. A fixture test proves the parser, so the label is at most source-inspected; only the owner's live run makes it validated.
6. **States.** A new state goes into `packages/core/src/enums.ts` and [the data model](../../../docs/architecture/data-model.md) in the same commit.

## Add a provider

Do every step above, and also wire the package in. Copy the layout of an existing connector, such as `packages/connectors/cursor`:

- `package.json` with exact dependency versions, and a `knip.json` workspace entry;
- the dependency in `apps/server/package.json` and the registration in `apps/server/src/index.ts`;
- the provider name in `enums.ts`;
- a dossier, a row in `docs/providers/README.md` and the docs index, and a provider gate row in the validation plan.

## Review a connector pull request

Apply the same list to the diff, and read each new fixture for real data: a plausible email, a long random id or a real organization name means a captured response. Ask the author to replace it before any other review.

## Boundaries

Agents never run a connector against a real account, and monitoring never sends a model request, redeems a reset or buys credits. Live checks are the owner's; record them in the evidence register.

## Done when

- The new test failed before the change and passes after it.
- `mise run check` passes.
- The connector version, the dossier and the enums match the change.
- The pull request shows the before and after parse under Showcase ([PR showcase skill](../pr-showcase/SKILL.md)).
