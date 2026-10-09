# Packaging

The npm and PyPI packages wrap the release binaries. They contain no other code and are built from the assets of a
GitHub release `v<version>`: `headroom-<os>-<arch>.tar.gz` for darwin-arm64, darwin-x64, linux-x64 and linux-arm64,
plus `SHA256SUMS`. Both builders check every archive against `SHA256SUMS` before they read it.

| Folder        | Holds                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| `npm/main`    | Template for `headroomhq`: the launcher `bin/headroom.js`, no dependencies |
| `npm/platform`| Template for the four `headroomhq-<os>-<arch>` packages                   |
| `pypi`        | The `headroomhq` Python module that runs the bundled binary               |

Builders: `scripts/package-npm.ts` and `scripts/package-pypi.py`. Both take `--version X.Y.Z --assets <dir> --out <dir>`.
`scripts/packaging.test.ts` builds both from a stand-in binary and, if `uv` is installed, installs the host wheel.

## npm

`headroomhq` lists the four platform packages as `optionalDependencies` at the exact same version. npm installs only
the one that matches `os` and `cpu`. The launcher resolves that package, starts its binary with inherited stdio,
forwards SIGINT, SIGTERM and SIGHUP, and returns the exit code. It prints the curl installer as the alternative when
the platform is unsupported or the optional package is missing (`--omit=optional`). There are no install scripts.

The command is exposed as `headroom` and `headroomhq`, so `npx headroomhq`, `bunx headroomhq` and
`pnpm dlx headroomhq` all work through this one package.

## PyPI

One wheel per platform, with no sdist: the package is a prebuilt binary, so a source build has nothing to compile
and would only fail on machines without a wheel. The wheels are written with `zipfile`, so no build backend is
needed. The binary keeps its exec bit in the zip, and `main()` restores it at runtime if an installer dropped it.

| Release asset | Wheel tag                                                  |
| ------------- | ---------------------------------------------------------- |
| darwin-arm64  | `py3-none-macosx_11_0_arm64`                               |
| darwin-x64    | `py3-none-macosx_10_15_x86_64`                             |
| linux-x64     | `py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64`      |
| linux-arm64   | `py3-none-manylinux_2_17_aarch64.manylinux2014_aarch64`    |

The Bun 1.4.2 Linux binaries (cross-compiled, both architectures) need glibc 2.17 at most, so the 2.17 tags are
accurate. Re-check with the `GLIBC_*` symbol versions in the binary after a Bun upgrade. musl (Alpine) is not
supported.

`uvx headroomhq`, `pipx run headroomhq` and `uv tool install headroomhq` work because the wheel installs a console
script named `headroomhq` as well as `headroom`.

## Publishing

`.github/workflows/packages.yml` builds both sets from the release assets (`workflow_call` with `version`, or run it
by hand). It publishes only when the repository variables below are `true`. Publishing is idempotent: npm skips a
version that exists, and the PyPI step uses `skip-existing`. npm provenance and PyPI attestations switch on when the
repository is public.

One-time steps for the maintainer:

1. npm: create a granular access token with read and write access to the `headroomhq*` packages. Store it as the
   repository secret `NPM_TOKEN`. Set the repository variable `NPM_PUBLISH` to `true`. Each new package name needs its
   first publish with this token. Afterwards, add a trusted publisher for each of the five packages (owner
   `amitray007`, repository `headroom`, workflow `packages.yml`) and delete the token. The job already has
   `id-token: write`.
2. PyPI: add a pending trusted publisher for project `headroomhq` (owner `amitray007`, repository `headroom`,
   workflow `packages.yml`, environment `pypi`). Create the `pypi` environment in the repository settings. Set the
   repository variable `PYPI_PUBLISH` to `true`.
3. Run the workflow by hand once with an existing release version to publish the first packages.

The workflow reads the version from the release tag. It does not rebuild any binary.
