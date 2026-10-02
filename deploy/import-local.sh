#!/usr/bin/env bash
# Move an existing Headroom (database, master key, auth secret) into this deployment's volumes.
# Run on the host from the deploy directory, before or after the first `docker compose up`:
#   ./import-local.sh /path/to/folder-with/headroom.db,headroom.key,headroom.auth-secret
# Stop the old instance first and keep it stopped: two instances refreshing the same accounts
# rotate each other's sign-ins out.
set -euo pipefail

source_dir=$(cd "${1:?usage: ./import-local.sh <folder with headroom.db, headroom.key, headroom.auth-secret>}" && pwd)
for file in headroom.db headroom.key headroom.auth-secret; do
  [[ -s "$source_dir/$file" ]] || { echo "missing $source_dir/$file" >&2; exit 1; }
done

cd "$(dirname "$0")"
docker compose stop headroom >/dev/null 2>&1 || true
# A one-off root container with only the capabilities needed to copy and hand the files to the app user.
docker compose run --rm --no-deps --user root \
  --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  --volume "$source_dir:/import:ro" --entrypoint sh headroom -c '
    set -eu
    rm -f /var/lib/headroom/data/headroom.db-wal /var/lib/headroom/data/headroom.db-shm
    cp /import/headroom.db /var/lib/headroom/data/headroom.db
    cp /import/headroom.key /etc/headroom/master.key
    cp /import/headroom.auth-secret /etc/headroom/auth.secret
    chown -R headroom:headroom /var/lib/headroom/data /etc/headroom
    chmod 600 /var/lib/headroom/data/headroom.db /etc/headroom/master.key /etc/headroom/auth.secret
  '
echo "Imported. Start it with: docker compose up -d"
