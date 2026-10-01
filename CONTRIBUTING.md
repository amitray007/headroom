# Contributing to Headroom

Headroom is in the specification stage. The next implementation task is the Codex connection proof described in [the roadmap](docs/roadmap.md).

## Documentation changes

1. Read the relevant provider dossier and its cited sources.
2. State the product surface: subscription, API billing, personal account or organization account.
3. Label evidence as documented, source-inspected, prior observation or unvalidated.
4. Record the review date and direct source links. Pin source revisions when implementing an adapter.
5. Update [the documentation index](docs/README.md) if a path changes.
6. Run `make check`.

Keep one provider dossier per integration family. Put shared behavior in the architecture docs instead of repeating it in every provider file.

## Connector changes

A connector must pass [the validation plan](docs/validation.md) before it is presented as supported. Use synthetic responses for automated tests. An account owner's approval is required before a live sign-in or account mutation.

Separate authentication from data access. Record each available metric independently; one missing endpoint must not turn other values into zero. Use provider identity and workspace information to verify that snapshots belong to the expected connection. Use the state and enumeration names from the data model; the docs check rejects invented ones.

Do not add a model request just to obtain usage data. Never redeem resets or buy credits during an ordinary refresh.

## Dependency selection

Prefer documented account APIs. Where a connector calls the endpoint an official CLI uses, label it `private` and keep it behind a flag. Code ported from CLIProxyAPI or another MIT project keeps its attribution in the file header and in a NOTICE entry. Verify the license before copying code. The research catalog is a candidate list, not an installed dependency list.

## Scope of this repository

The setup contains no provider credentials or production service. There is no public issue tracker or published release yet. Commits, remotes, publication and deployment are separate maintainer actions.
