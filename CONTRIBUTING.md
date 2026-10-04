# Contributing to Headroom

Thanks for helping. Bug reports, provider evidence, fixes and new connectors are all welcome.

## Before you start

- Search the [issues](https://github.com/amitray007/headroom/issues) first. For a larger change, open an issue to agree on the approach before writing code.
- Never paste tokens, cookies, authorization codes, raw provider responses or personal account details into an issue, a pull request, a fixture or a log. Use synthetic values. Report security problems privately as described in [SECURITY.md](SECURITY.md).
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Read [AGENTS.md](AGENTS.md). It is short, and it holds the project rules for people and coding agents alike.

## Set up

Tool versions are pinned in `mise.toml`. Install [mise](https://mise.jdx.dev), then:

```sh
mise install && mise run install
mise run dev                  # API server with reload on :8080
mise exec -- bun run web:dev  # web app on :5173, proxying /api
```

Demo Mode (account menu) fills every view with synthetic data, so most UI work needs no provider account.

## Make a change

1. Branch from `main`.
2. Keep the change focused. Match the surrounding code: naming, comment density and idioms.
3. Add or update tests next to the code you change (`*.test.ts`, run by `bun test`). Fixtures are synthetic.
4. Run `mise run check`. It covers docs, format, type-aware lint, typecheck, Knip and tests, and CI runs the same gate.
5. Open a pull request that says what changed, why, and how you verified it.

Rules the check cannot catch:

- **Unknown is not zero.** A metric a provider does not report is unknown. Keep money, credits and percentages in separate units.
- **Enumerations live in [`packages/core/src/enums.ts`](packages/core/src/enums.ts)** and in [the data model](docs/architecture/data-model.md), always together.
- **Pin dependencies** to an exact version. Fix lint and type errors at their cause. A disable directive needs a one-line reason.
- **Record material choices** in [the decision register](docs/decisions/README.md).

## Connectors

A connector lives in `packages/connectors/<provider>` with an endpoints file, Zod schemas, synthetic fixtures and tests. Before you start, read the provider's dossier in [`docs/providers/`](docs/providers/README.md), [the connector contract](docs/architecture/connector-contract.md) and [the validation plan](docs/validation.md).

- Collection is direct HTTP from TypeScript. An official CLI may run once, for sign-in only ([ADR 0001](docs/decisions/0001-direct-provider-clients.md)).
- Label every metric `official` or `private`, and keep the evidence labels in the dossier: documented, source-inspected, prior observation, validated, unvalidated.
- Monitoring must never send a model request, redeem a reset or buy credits. A mutating action needs an explicit owner action: a confirmed press, or a rule the owner configured ([ADR 0003](docs/decisions/0003-owner-automations.md)).
- Separate authentication from data access. One failing endpoint must not turn other values into zero.
- Code ported from another project keeps its license attribution in the file header.

## Documentation

Docs are part of the product. When a path or behaviour changes, update the owning document and [the documentation index](docs/README.md). `mise run check` validates internal links, anchors and canonical state names.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
