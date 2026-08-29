#!/usr/bin/env bash
# Activates the TLS server block on a deployed host (SRS §3.1, §19.1, R-8).
#
# `nginx/conf.d/tls.conf.example` used to require hand-editing the tracked HTTP
# server while the site was public. Release HTTP now always serves ACME and
# redirects everything else; this script generates only the ignored,
# host-specific TLS server block.
#
# This activates TLS idempotently and refuses to run before the
# certificate exists, because activating the block without one leaves Nginx
# unable to start at all: `ssl_certificate` on a missing file is a hard config
# error, not a warning.
#
# Usage, from the repository root on the host, after certbot has issued and
# with BODOUR_RELEASE_TAG still set to the deployed full commit:
#   bash scripts/deploy/enable-tls.sh staging.bodouralamal.com staging
#   bash scripts/deploy/enable-tls.sh bodouralamal.com production
#
# Re-running is safe and is the intended way to recover a half-applied state.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DOMAIN="${1:-}"
TIER="${2:-}"
[[ -n "$DOMAIN" ]] || { echo "usage: $0 <domain> <staging|production>" >&2; exit 2; }
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] || {
  echo "FAIL: domain must be a plain DNS name." >&2
  exit 2
}

case "$TIER" in
  staging)
    compose=(docker compose -f docker-compose.yml -f docker-compose.release.yml -f docker-compose.staging.yml)
    ;;
  production)
    compose=(docker compose -f docker-compose.yml -f docker-compose.release.yml -f docker-compose.production.yml)
    ;;
  *)
    echo "usage: $0 <domain> <staging|production>" >&2
    exit 2
    ;;
esac

[[ "${BODOUR_RELEASE_TAG:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "FAIL: BODOUR_RELEASE_TAG must be the deployed 40-character commit." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$BODOUR_RELEASE_TAG" ]] || {
  echo "FAIL: checkout HEAD does not match BODOUR_RELEASE_TAG." >&2
  exit 1
}

LIVE="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
if ! "${compose[@]}" exec -T nginx test -f "$LIVE" 2>/dev/null; then
  echo "FAIL: $LIVE is not present inside the nginx container." >&2
  echo "      Issue the certificate first:" >&2
  printf '      %q ' "${compose[@]}" >&2
  echo "run --rm --entrypoint certbot certbot certonly \\" >&2
  echo "        --webroot -w /var/www/certbot -d $DOMAIN" >&2
  exit 1
fi

# ── Step 2: the TLS server block, from the committed template ───────────────
sed "s/__DOMAIN__/$DOMAIN/g" nginx/conf.d/tls.conf.example > nginx/conf.d/tls.conf
echo "wrote nginx/conf.d/tls.conf for $DOMAIN"

# RECREATE, never restart. `nginx/nginx.conf` is a SINGLE-FILE bind mount, and
# Docker resolves those to the inode present at container start. `git pull` and
# `git reset` REPLACE a file rather than editing it in place, so the container
# keeps serving the old inode and a restart changes nothing — the host file and
# the running config silently disagree. This cost one confusing
# `unknown "hsts" variable` on a file that plainly contained the map.
"${compose[@]}" up --no-build -d --force-recreate --no-deps nginx
sleep 2
"${compose[@]}" exec -T nginx nginx -t
echo "TLS active for $DOMAIN"
