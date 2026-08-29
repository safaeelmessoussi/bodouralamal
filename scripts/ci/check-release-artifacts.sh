#!/usr/bin/env bash
# A release is one verified commit, not source rebuilt on the target host.
# This guard keeps the CI publication and Compose consumption halves joined:
# exact SHA tags, revision labels, both application artifacts, and no documented
# host-build fallback.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow="$repo_root/.github/workflows/ci.yml"
release="$repo_root/docker-compose.release.yml"
deployment="$repo_root/docs/operations/deployment.md"

fail() {
  printf 'release-artifacts guard: %s\n' "$1" >&2
  exit 1
}

[[ -f "$repo_root/backend/Dockerfile" && -f "$repo_root/frontend/Dockerfile" ]] ||
  fail 'both API and web Dockerfiles must exist'

grep -Fq "if: github.event_name == 'push' && github.ref == 'refs/heads/develop'" "$workflow" ||
  fail 'release publication must be limited to pushes on develop'
grep -Fq 'needs: [guards, contract, backend, frontend]' "$workflow" ||
  fail 'release publication must wait for every verification job'
grep -Fq 'packages: write' "$workflow" ||
  fail 'the release job must declare package publication authority'
[[ "$(grep -Fc 'org.opencontainers.image.revision=$GITHUB_SHA' "$workflow")" -eq 2 ]] ||
  fail 'both images must carry the exact source revision label'
grep -Fq 'image="$image_base-api:$GITHUB_SHA"' "$workflow" ||
  fail 'the API image must use the exact commit tag'
grep -Fq 'image="$image_base-web:$GITHUB_SHA"' "$workflow" ||
  fail 'the web image must use the exact commit tag'

[[ "$(grep -Fc '${BODOUR_RELEASE_TAG:?set BODOUR_RELEASE_TAG to the exact 40-character commit}' "$release")" -eq 2 ]] ||
  fail 'the release overlay must fail closed when either image has no commit tag'
grep -Fq 'bodouralamal-api:${BODOUR_RELEASE_TAG:?' "$release" ||
  fail 'the release overlay must select the commit-tagged API image'
grep -Fq 'bodouralamal-web:${BODOUR_RELEASE_TAG:?' "$release" ||
  fail 'the release overlay must select the commit-tagged web image'

grep -Fq 'docker-compose.release.yml' "$deployment" ||
  fail 'the deployment runbook must use the release overlay'
grep -Fq 'git switch --detach "$BODOUR_RELEASE_TAG"' "$deployment" ||
  fail 'deployment must check out the already-approved commit, not the newest branch tip'
grep -Fq 'test "$(git rev-parse HEAD)" = "$BODOUR_RELEASE_TAG"' "$deployment" ||
  fail 'deployment must prove the checkout matches the release tag'
grep -Fq 'up --no-build -d' "$deployment" ||
  fail 'the deployment runbook must prohibit target-host builds'
if grep -Fq 'docker compose build api' "$deployment" ||
  grep -Fq 'docker run --rm -v "$PWD/frontend"' "$deployment"; then
  fail 'the deployment runbook must not contain target-host build commands'
fi

printf 'release-artifacts guard: exact-commit publication and no-build deployment verified\n'
