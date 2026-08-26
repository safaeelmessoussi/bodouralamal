#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
shared="$repo_root/nginx/snippets/storage-proxy.conf"
routing="$repo_root/nginx/snippets/app-routing.conf"

fail() {
  printf 'storage-edge guard: %s\n' "$1" >&2
  exit 1
}

[[ "$(grep -Fc 'error_page 418 = @storage_unsigned_trailer_denied;' "$shared")" -eq 1 ]] ||
  fail 'shared proxy must dispatch the defensive denial exactly once'
[[ "$(grep -Fc 'if ($http_x_amz_content_sha256 ~* "STREAMING-UNSIGNED-PAYLOAD-TRAILER") { return 418; }' "$shared")" -eq 1 ]] ||
  fail 'shared proxy must reject the vendor-named unsigned trailer mode exactly once'
filter_line="$(grep -nF 'if ($http_x_amz_content_sha256 ~* "STREAMING-UNSIGNED-PAYLOAD-TRAILER") { return 418; }' "$shared" | cut -d: -f1)"
rewrite_line="$(grep -nF 'rewrite ^/(?:_storage_public_read/)?storage/(.*)$ /$1 break;' "$shared" | cut -d: -f1)"
[[ "$filter_line" -lt "$rewrite_line" ]] ||
  fail 'edge policy must precede the terminating storage-prefix rewrite'
[[ "$(grep -Fc 'location @storage_unsigned_trailer_denied {' "$routing")" -eq 1 ]] ||
  fail 'the internal Nginx denial location must exist exactly once'
[[ "$(grep -Fc 'add_header X-Bodour-Storage-Policy "unsigned-trailer-denied" always;' "$routing")" -eq 1 ]] ||
  fail 'the Nginx-owned denial must remain distinguishable from an upstream response'

# Every external MinIO request must pass through the shared snippet. A direct
# proxy_pass in another Nginx file could otherwise omit the defensive filter.
#
# **`grep -r`, not `rg`.** This check was written with ripgrep, which is not a
# POSIX tool and is absent from many environments — and the failure was SILENT:
# `if rg ... | grep -q .` evaluates to false when `rg` is missing, so the guard
# printed success while a real bypass sat in the tree. Proven by injecting one.
# A guard that cannot fail is not protection (see docs/development/testing.md).
if grep -rnE --include='*.conf' 'proxy_pass[[:space:]]+\$minio_upstream' "$repo_root/nginx" \
  | grep -v '/storage-proxy\.conf:' | grep -q .; then
  fail 'a MinIO proxy path bypasses the shared storage-proxy snippet'
fi

include_count="$(grep -Fc 'include /etc/nginx/snippets/storage-proxy.conf;' "$routing")"
[[ "$include_count" -ge 4 ]] ||
  fail 'not every public/private storage route includes the shared proxy policy'

printf 'storage-edge guard: shared unsigned-trailer denial and proxy coverage verified\n'
