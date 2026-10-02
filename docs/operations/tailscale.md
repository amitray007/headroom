# Self-hosting on a tailnet

Headroom runs as two containers: the app, and a Tailscale node that serves it over HTTPS at `https://<TS_HOSTNAME>.<tailnet>.ts.net`. The app publishes no port, so only devices on your tailnet can reach it. Funnel stays off.

Files: [`deploy/compose.yaml`](../../deploy/compose.yaml), [`deploy/ts/serve.json`](../../deploy/ts/serve.json), [`deploy/.env.example`](../../deploy/.env.example), [`deploy/import-local.sh`](../../deploy/import-local.sh). Requirements and storage rules: [Deployment and credential storage](../architecture/deployment.md).

## Before you start

1. A Linux host with Docker Engine and Compose v2, or a Dokploy server.
2. In the Tailscale admin console, DNS page: turn on MagicDNS and HTTPS Certificates.
3. In Settings, Keys: generate an auth key. Turn off Reusable and Ephemeral, and turn on Pre-approved if device approval is on. If your access rules use tags, tag the key, for example `tag:server`, and allow your own devices to reach that tag on port 443.

## Environment

| Variable | Required | Value |
| --- | --- | --- |
| `TS_AUTHKEY` | Yes | The auth key. Keep it in the deployment environment only. After the first start the node identity lives in the `ts-state` volume and the key is no longer used. |
| `TS_HOSTNAME` | No, default `headroom` | The node name. It becomes the first part of the address. |
| `TS_EXTRA_ARGS` | No | Extra `tailscale up` flags, for example `--advertise-tags=tag:server`. |
| `HEADROOM_PUBLIC_URL` | Yes | Exactly `https://<TS_HOSTNAME>.<tailnet>.ts.net`, no trailing slash. Passkeys, secure cookies, origin checks and the "Open Headroom" link in notifications use it. Find the tailnet name on the admin console DNS page. |
| `HEADROOM_ENABLED_PROVIDERS` | No, default all seven | Comma list of `codex`, `claude`, `grok`, `antigravity`, `copilot`, `cursor`, `vercel_ai_gateway`. |
| `HEADROOM_LOG_LEVEL` | No, default `info` | `debug`, `info`, `warn` or `error`. |
| `HEADROOM_REFRESH_INTERVAL_SECONDS` | No, default `900` | The first value of the Refresh Every setting. The setting wins after that. |
| `HEADROOM_STALE_AFTER_SECONDS` | No, default `43200` | When an account shows as stale. |
| `TZ` | No, default `UTC` | Time zone for dates in Telegram and webhook messages, for example `Asia/Kolkata`. |

The image fixes the rest: port 8080, data in `/var/lib/headroom/data`, keys in `/etc/headroom`. Leave `HEADROOM_TRUST_PROXY` unset. Every request then comes from the Tailscale container's address, so the sign-in rate limit is shared, which suits one owner.

## Deploy with Dokploy

1. Create a Compose service from this repository. Set the compose path to `./deploy/compose.yaml`.
2. In Environment, set `TS_AUTHKEY`, `HEADROOM_PUBLIC_URL` and any optional values.
3. Do not add a domain in Dokploy. Tailscale serves the app.
4. Deploy, then open the address from a device on your tailnet.

## Deploy with Docker Compose

```sh
git clone https://github.com/amitray007/headroom.git && cd headroom/deploy
cp .env.example .env    # then fill in TS_AUTHKEY and HEADROOM_PUBLIC_URL
docker compose up -d --build
docker compose exec tailscale tailscale serve status
```

The first start creates the master key and the auth secret in the `headroom-secrets` volume. Open the address and create the owner account.

## Move an existing instance

Your local data works on the server: one database file and two secret files.

1. Stop the local instance and keep it stopped. Two instances that refresh the same accounts rotate each other's sign-ins out.
2. Make a consistent copy on the old machine: `sqlite3 .data/headroom.db ".backup /tmp/headroom-move/headroom.db"`, then copy `.state/headroom.key` and `.state/headroom.auth-secret` into `/tmp/headroom-move/`.
3. Copy the folder to the server over your tailnet, for example with `scp -r`.
4. On the server, from `deploy/`: `./import-local.sh /path/to/headroom-move`, then `docker compose up -d`.
5. Delete the copies. The key file decrypts every stored sign-in.

A passkey belongs to the address it was made on. After the move, sign in with your password and add a new passkey in Account.

## Back up

Back up both volumes together: `headroom-data` and `headroom-secrets`. The database alone is useless without `master.key`, and the key alone holds no data. Stop the app for a consistent copy:

```sh
docker compose stop headroom
docker run --rm -v headroom_headroom-data:/data -v headroom_headroom-secrets:/keys -v "$PWD":/out \
  busybox tar czf /out/headroom-backup.tgz /data /keys
docker compose start headroom
```

Store the archive somewhere private. It holds the key.

## Update

```sh
git pull && docker compose up -d --build
```

Migrations run at start. Back up first when a release notes a migration.

## Check and troubleshoot

- `docker compose ps` shows `headroom` as healthy.
- `docker compose exec tailscale tailscale status` lists the node; `tailscale serve status` shows the proxy to `http://headroom:8080`.
- From a device outside the tailnet, the address must not load.
- Sign-in fails or passkeys refuse: `HEADROOM_PUBLIC_URL` does not match the address in the browser.
- "502" from Serve: the app is not healthy yet, or the service name or port in `ts/serve.json` changed.
- The node has a new name with `-1` after a restart: the `ts-state` volume was lost, so Tailscale made a new node. Remove the old one in the admin console.
