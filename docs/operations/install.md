# Install Headroom

Headroom ships as one binary with the web app inside. Pick the way that suits the machine. Every way gives the same program.

Each release carries four archives: `headroom-darwin-arm64.tar.gz`, `headroom-darwin-x64.tar.gz`, `headroom-linux-arm64.tar.gz` and `headroom-linux-x64.tar.gz`. A `SHA256SUMS` file lists their checksums. Windows has no binary yet. Use [Docker](#docker).

## The installer

```sh
curl -fsSL https://headroom.theblank.club/install | sh
```

The script finds your system and CPU, downloads the archive and `SHA256SUMS` from the GitHub release, checks the checksum, and puts `headroom` in `~/.local/bin`. On macOS it also clears the quarantine flag. A checksum mismatch stops the install and changes nothing. Run it again to upgrade.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HEADROOM_VERSION` | latest | Release to install, such as `0.2.0` |
| `HEADROOM_INSTALL_DIR` | `~/.local/bin` | Where `headroom` goes |
| `HEADROOM_DOWNLOAD_BASE` | `https://github.com/amitray007/headroom/releases` | Releases URL prefix. For tests against a local folder |

If `~/.local/bin` is not on your `PATH`, the script prints the line to add for bash, zsh and fish.

Then run:

```sh
headroom --open              # serve on 127.0.0.1:8080 and open the dashboard
headroom service install     # start at login
```

## Homebrew

```sh
brew tap amitray007/headroom https://github.com/amitray007/headroom
brew install amitray007/headroom/headroom
headroom --open
brew services start headroom   # start now and at every login
```

This repository is the tap: the formula is `Formula/headroom.rb`. Homebrew finds a tap by itself only when its repository is named `homebrew-*`, so the first command gives the address once. Installing by the full name also trusts that one formula, as [Tap Trust](https://docs.brew.sh/Tap-Trust) requires. `brew services` runs `headroom start` and writes its log to `$(brew --prefix)/var/log/headroom.log`. Update with `brew upgrade headroom`.

## Package runners

These run the same binary without a manual download. The npm and PyPI packages are named `headroomhq`.

```sh
npx headroomhq          # or: bunx headroomhq
uvx headroomhq          # or: pipx run headroomhq
```

For a permanent install: `npm i -g headroomhq` or `uv tool install headroomhq`.

## mise

```sh
mise use -g github:amitray007/headroom
```

## Docker

```sh
docker run -d --name headroom -p 8080:8080 \
  -v headroom-data:/var/lib/headroom/data -v headroom-secrets:/etc/headroom \
  ghcr.io/amitray007/headroom:latest
```

Open <http://localhost:8080>. The first start creates the master key and the session secret in the `headroom-secrets` volume. Back up both volumes together. For compose files and a Tailscale setup, see the [README](../../README.md#quick-start) and [Self-hosting on a tailnet](tailscale.md).

## Sign-in CLIs

Codex, Claude and Grok sign in through their official command-line tools. Headroom runs the tool once, for the sign-in only. Install the tool on the machine that runs Headroom: `codex`, `claude` or `grok`. Without it, use Import in the Connect page and paste the credentials file instead. The other providers need no CLI.

A login service starts with the `PATH` from the moment you ran `service install`. Install the CLIs first, or run `headroom service install` again after you add them.

## Where data lives

| | macOS | Linux |
| --- | --- | --- |
| Database | `~/Library/Application Support/Headroom/data` | `${XDG_DATA_HOME:-~/.local/share}/headroom/data` |
| Master key and session secret | `~/Library/Application Support/Headroom` | `${XDG_CONFIG_HOME:-~/.config}/headroom` |

`headroom paths` prints the exact locations on your machine. Back up the key with the database: without the key, every account must be reconnected. The environment variables in the [README](../../README.md#configuration) move any of these.

## Start at login

```sh
headroom service install     # launchd agent on macOS, systemd user unit on Linux
headroom service status
headroom service uninstall
```

Run it from the installed binary, not from `bun`. On a headless Linux server also run `loginctl enable-linger $USER`. With Homebrew, use `brew services` instead.

## Update

| Installed with | Update with |
| --- | --- |
| Installer | `headroom update`, or run the installer again |
| Homebrew | `brew upgrade headroom` |
| npm | `npm i -g headroomhq@latest` |
| uv or pipx | `uv tool upgrade headroomhq` or `pipx upgrade headroomhq` |
| mise | `mise upgrade github:amitray007/headroom` |
| Docker | `docker pull ghcr.io/amitray007/headroom:latest`, then recreate the container |

`headroom update` finds how the binary was installed. For the installer it reads the latest GitHub release, downloads the archive, checks it against `SHA256SUMS`, and replaces the file in place. `headroom update --check` only reports. For the other ways it prints the command above.

A running server keeps the old version until it restarts. Restart a login service with `launchctl kickstart -k gui/$(id -u)/club.theblank.headroom` on macOS or `systemctl --user restart headroom` on Linux.

## Uninstall

1. Run `headroom service uninstall`, or `brew services stop headroom`.
2. Remove the binary: `rm ~/.local/bin/headroom`, `brew uninstall headroom`, or the package manager's own command.
3. To delete your data, remove the data and key folders from the table above. This erases every connected account and the history. Skip it if you may come back.

## Maintainers

`release-please.yml` publishes a release and its archives. [homebrew.yml](../../.github/workflows/homebrew.yml) then renders `Formula/headroom.rb` with `scripts/render-formula.ts <version> <SHA256SUMS>` and commits it to `main` as `chore(brew): headroom <version>`, with the workflow's own token. The installer is `site/install.sh`; the site build publishes it at `/install`.
