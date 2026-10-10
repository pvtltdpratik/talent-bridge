#!/usr/bin/env bash
# Deploys a release on the SERVER (run there, as the deploy user, after the plan is approved).
# Usage:  ./deploy.sh <path-to-release.tar.gz>
#
# What it does (and nothing else):
#   1. unpack the release into releases/<timestamp>
#   2. install production dependencies for server/ (client is pre-built on the build machine)
#   3. run database migrations against DATABASE_URL (idempotent)
#   4. switch the `current` symlink and reload PM2
#   5. health-check; roll back automatically if the API does not come up
#
# Secrets live in /var/www/talentbridge/shared/server.env (chmod 600). This script never prints them.
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/talentbridge}"
ARCHIVE="${1:?usage: deploy.sh <release.tar.gz>}"
STAMP="$(date +%Y%m%d%H%M%S)"
RELEASE="$APP_ROOT/releases/$STAMP"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/health}"

[ -f "$APP_ROOT/shared/server.env" ] || { echo "missing $APP_ROOT/shared/server.env"; exit 1; }
[ "$(stat -c %a "$APP_ROOT/shared/server.env")" = "600" ] || { echo "server.env must be chmod 600"; exit 1; }

PREVIOUS="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"

echo "==> unpacking $ARCHIVE"
mkdir -p "$RELEASE"
tar -xzf "$ARCHIVE" -C "$RELEASE"

echo "==> installing server dependencies"
( cd "$RELEASE/server" && npm ci --omit=dev )

echo "==> applying migrations"
( cd "$RELEASE/server" && DOTENV_CONFIG_PATH="$APP_ROOT/shared/server.env" node scripts/migrate.js )

echo "==> switching release"
ln -sfn "$RELEASE" "$APP_ROOT/current"
pm2 startOrReload "$RELEASE/deploy/ecosystem.config.cjs" --env production
pm2 save >/dev/null

echo "==> health check"
ok=0
for i in $(seq 1 20); do
  if curl -fsS "$HEALTH_URL" | grep -q '"status":"ok"'; then ok=1; break; fi
  sleep 2
done

if [ "$ok" -ne 1 ]; then
  echo "!! health check failed, rolling back"
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    ln -sfn "$PREVIOUS" "$APP_ROOT/current"
    pm2 startOrReload "$PREVIOUS/deploy/ecosystem.config.cjs" --env production
    echo "rolled back to $PREVIOUS"
  fi
  exit 1
fi

echo "==> OK: $STAMP is live"
# keep the last 5 releases
ls -1dt "$APP_ROOT"/releases/* | tail -n +6 | xargs -r rm -rf
