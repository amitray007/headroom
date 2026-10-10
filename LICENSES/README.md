# Licenses

Headroom's own code is under the [MIT License](../LICENSE). This folder holds the license texts of the work that Headroom uses from other projects. [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) lists every one of them with its copyright notice and license text.

| File | What it covers |
| --- | --- |
| `cliproxyapi.txt` | [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), MIT. Sign-in flows and endpoint details in the connectors |
| `openusage.txt` | [OpenUsage](https://github.com/robinebers/openusage), MIT. Endpoints, headers and response shapes in the connectors |
| `pi-cursor.txt` | [pi-cursor](https://github.com/Rahularya01/pi-cursor), MIT. The Cursor sign-in flow |
| `arc.txt` | [Arc](https://github.com/kuratlielia/arc-library), MIT. Component styles in the web app |
| `lucide.txt` | [Lucide](https://github.com/lucide-icons/lucide), ISC. The webhook icon |
| `bun.md` | [Bun](https://github.com/oven-sh/bun)'s list of the libraries in its runtime, which every `headroom` binary contains |
| `codex-notice.txt` | The NOTICE file of the [Codex CLI](https://github.com/openai/codex), which the Docker image installs |
| `Apache-2.0.txt` | The Apache License 2.0, for the Codex and Grok CLIs and for packages that ship without a license file |
| `MIT.txt` | The MIT License template, for packages that ship without a license file |

Each upstream file is copied verbatim from the project's repository. To add a project, copy its license file here, add it to `PORTED` in [scripts/notices.ts](../scripts/notices.ts), then run `mise run notices`.
