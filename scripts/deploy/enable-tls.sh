#!/usr/bin/env bash
# Activates the TLS server block on a deployed host (SRS §3.1, §19.1, R-8).
#
# `nginx/conf.d/tls.conf.example` documents four manual steps. They were manual,
# which means they were also un-rerunnable and easy to half-apply — and step 3
# in particular asks an operator to hand-edit a tracked file under time
# pressure, during the one window where the site is already public.
#
# This performs steps 1–3 idempotently and refuses to run before the
# certificate exists, because activating the block without one leaves Nginx
# unable to start at all: `ssl_certificate` on a missing file is a hard config
# error, not a warning.
#
# Usage, from the repository root on the host, after certbot has issued:
#   bash scripts/deploy/enable-tls.sh staging.bodouralamal.com
#
# Re-running is safe and is the intended way to recover a half-applied state.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DOMAIN="${1:-}"
[[ -n "$DOMAIN" ]] || { echo "usage: $0 <domain>" >&2; exit 2; }

LIVE="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
if ! docker compose exec -T nginx test -f "$LIVE" 2>/dev/null; then
  echo "FAIL: $LIVE is not present inside the nginx container." >&2
  echo "      Issue the certificate first:" >&2
  echo "      docker compose run --rm --entrypoint certbot certbot certonly \\" >&2
  echo "        --webroot -w /var/www/certbot -d $DOMAIN" >&2
  exit 1
fi

# ── Step 2: the TLS server block, from the committed template ───────────────
sed "s/__DOMAIN__/$DOMAIN/g" nginx/conf.d/tls.conf.example > nginx/conf.d/tls.conf
echo "wrote nginx/conf.d/tls.conf for $DOMAIN"

# ── Step 3: port 80 keeps ACME and redirects everything else ────────────────
# The ACME location must survive: renewal uses the same webroot challenge, so a
# redirect-everything block would break every renewal from here on.
if grep -q "return 301 https://" nginx/conf.d/default.conf; then
  echo "nginx/conf.d/default.conf already redirects — left alone"
else
  cat > nginx/conf.d/default.conf <<'CONF'
# HTTP server (SRS §3.1) — TLS is live on this host, so this block now does
# exactly two things: serve the ACME challenge, and redirect everything else.
#
# Rewritten from the repository default by scripts/deploy/enable-tls.sh. The
# routing snippet is deliberately NOT included here any more: it is included by
# the TLS server in tls.conf, so client, API and storage are reachable over
# HTTPS only and the two blocks cannot drift (§19.0).
#
# Keep the ACME location above the redirect. Certbot renews through this same
# webroot, and a redirect-everything block breaks every future renewal.

server {
    listen 80;
    listen [::]:80;
    server_name _;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
CONF
  echo "rewrote nginx/conf.d/default.conf as ACME + redirect"
fi

docker compose exec -T nginx nginx -t
docker compose restart nginx
echo "TLS active for $DOMAIN"
