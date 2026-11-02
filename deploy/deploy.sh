#!/usr/bin/env bash
set -Eeuo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
umask 077
sha=${1:?Usage: deploy.sh COMMIT_SHA}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 2; }
base=/srv/webank
archive="$base/incoming/$sha.tgz"
exec 9>"$base/deploy.lock"
flock -w 300 9
test -f "$archive"
# A retry gets a fresh directory; the running release is never overwritten.
release=$(mktemp -d "$base/releases/$sha.XXXXXX")
tar -xzf "$archive" --no-same-owner -C "$release"
app="$release/voice-bank"
test -f "$app/dist/server/wrangler.json"
cd "$app"
export NODE_OPTIONS=--max-old-space-size=384
npm ci --include=dev --include=optional --no-audit --no-fund
mkdir -p "$base/shared/.wrangler/state"
ln -s "$base/shared/.wrangler" .wrangler
ln -s "$base/shared/.dev.vars" .dev.vars
# Paths in the generated Wrangler config are relative to dist/server.
python3 - <<'PY'
import json
from pathlib import Path
p = Path('dist/server/wrangler.json')
config = json.loads(p.read_text())
for db in config.get('d1_databases', []):
    if db['binding'] == 'DB':
        db['migrations_dir'] = '../../drizzle'
p.write_text(json.dumps(config))
PY
# Wrangler tracks applied D1 migrations and only applies new SQL files.
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js \
  d1 migrations apply DB --local --config dist/server/wrangler.json \
  --persist-to "$base/shared/.wrangler/state"
previous=$(readlink -f "$base/current" || true)
ln -s "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
sudo /usr/bin/systemctl restart webank.service
for attempt in $(seq 1 45); do
  if curl --fail --silent --max-time 5 http://127.0.0.1:5173/api/bank >/dev/null; then
    rm -f "$archive"
    python3 - <<'PY'
from pathlib import Path
import shutil
import sys
base = Path('/srv/webank')
current = (base / 'current').resolve()
try:
    releases = sorted((base / 'releases').iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in releases[3:]:
        try:
            if old.is_dir() and old.resolve() != current:
                shutil.rmtree(old)
        except OSError as error:
            print(f'WARNING: App is healthy; could not clean old release {old}: {error}', file=sys.stderr)
except OSError as error:
    print(f'WARNING: App is healthy; could not inspect old releases: {error}', file=sys.stderr)
PY
    echo "Deployed $sha"
    exit 0
  fi
  sleep 2
done
echo 'Health check failed; restoring previous app release.' >&2
if [[ -n $previous && -d $previous ]]; then
  ln -s "$previous" "$base/current.next"
  mv -Tf "$base/current.next" "$base/current"
  sudo /usr/bin/systemctl restart webank.service
fi
# Database changes are not rolled back. Keep migrations backward compatible.
exit 1
