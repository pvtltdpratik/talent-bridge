#!/usr/bin/env bash
# Run on your build machine (laptop / CI), from the repository root, to produce release.tar.gz.
# It runs the quality gates first so a broken build can never be packaged.
set -euo pipefail

echo "==> secret scan";           node scripts/check-secrets.js
echo "==> server tests + lint";   ( cd server && npm ci && npm test && npm run lint )
echo "==> client tests + lint";   ( cd client && npm ci && npm test && npm run lint )
echo "==> client production build"; ( cd client && npm run build )

OUT="release-$(date +%Y%m%d%H%M%S).tar.gz"
tar -czf "$OUT" \
  --exclude='server/node_modules' --exclude='client/node_modules' --exclude='client/src' \
  --exclude='**/.env' --exclude='**/.env.*' --exclude='*.pem' --exclude='.git' --exclude='.claude' \
  server/src server/scripts server/package.json server/package-lock.json \
  client/dist supabase/migrations deploy
echo "==> built $OUT ($(du -h "$OUT" | cut -f1))"
