#!/usr/bin/env bash
# **No CI guard may depend on a tool that is not guaranteed to exist.**
#
# ## The defect this exists for (2026-08-26)
#
# Three guards were written with `ripgrep`. Their prohibition checks had the
# shape:
#
#     if rg -n 'forbidden-pattern' dir | grep -q .; then fail '...'; fi
#
# When `rg` is absent the command writes `rg: command not found` to stderr and
# produces no stdout, so the `if` condition is FALSE, the guard prints its
# success line and exits 0 — **while the thing it forbids sits in the tree.**
# It was proven by injecting a real `proxy_pass $minio_upstream` bypass: the
# guard passed.
#
# Two of the three checks made inert this way were the ones protecting Owner
# decisions — that no Nginx path bypasses the storage edge filter, and that
# automatic quarantine destruction stays disabled.
#
# ## The rule
#
# A guard is protection only if it can fail (see `docs/development/testing.md`).
# Search inside `scripts/ci/` with POSIX `grep`, which is guaranteed on every
# runner and in every container this project uses. If a guard ever genuinely
# needs a richer tool, it must assert the tool exists FIRST, so a missing
# dependency is loud rather than silently permissive.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ci_dir="$repo_root/scripts/ci"
workflow="$repo_root/.github/workflows/ci.yml"

# Tools that are NOT part of a base POSIX/coreutils environment and whose
# absence would be swallowed by a pipeline condition.
NON_PORTABLE='rg|fdfind|\bfd\b|ag|ack|ripgrep'

offenders="$(
  grep -rnE --include='*.sh' "(^|[|;&(]|[[:space:]])(${NON_PORTABLE})[[:space:]]" "$ci_dir" \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' \
    | grep -v 'check-ci-portability\.sh' || true
)"

if [[ -n "$offenders" ]]; then
  echo "ci-portability guard: a CI guard invokes a non-guaranteed search tool." >&2
  echo "A missing tool makes a prohibition check silently pass. Use grep." >&2
  echo "$offenders" >&2
  exit 1
fi

# GitHub's temporary compatibility override can make an obsolete JavaScript
# action look healthy while its declared runtime is already unsupported. The
# Document Owner approved the current Node 24 action lines on 2026-08-30. Keep
# every official checkout/setup invocation on those maintained majors; inputs
# and cache semantics remain explicit in the workflow itself.
if ! grep -qE 'uses: actions/checkout@v7$' "$workflow" ||
  ! grep -qE 'uses: actions/setup-node@v7$' "$workflow"; then
  echo 'ci-portability guard: checkout and setup-node must use the approved v7 Node 24 lines.' >&2
  exit 1
fi
unsupported_actions="$({
  grep -nE 'uses: actions/(checkout|setup-node)@' "$workflow" || true
} | grep -vE 'uses: actions/(checkout|setup-node)@v7$' || true)"
if [[ -n "$unsupported_actions" ]]; then
  echo 'ci-portability guard: an official JavaScript action uses an unapproved runtime major.' >&2
  echo "$unsupported_actions" >&2
  exit 1
fi

# `check-no-pii-logs.sh` deliberately uses the TypeScript compiler API to
# distinguish executable property access from comments and generated examples.
# That is stronger than grep, but it also means the guard is NOT dependency
# free. Pin its placement after the backend job's locked install so a warm Local
# node_modules can never hide another clean-checkout failure.
if awk '
  /^  guards:/ { inside = 1 }
  /^  contract:/ { inside = 0 }
  inside && /check-no-pii-logs\.sh/ { found = 1 }
  END { exit found ? 0 : 1 }
' "$workflow"; then
  echo 'ci-portability guard: the TypeScript-backed no-PII guard cannot run in the dependency-free job.' >&2
  exit 1
fi
if ! awk '
  /^  backend:/ { inside = 1 }
  /^  integration:/ { inside = 0 }
  inside && /run: npm ci/ { installed = 1 }
  inside && /run: bash \.\.\/scripts\/ci\/check-no-pii-logs\.sh/ && installed { found = 1 }
  END { exit found ? 0 : 1 }
' "$workflow"; then
  echo 'ci-portability guard: the syntax-aware no-PII guard must run after backend npm ci.' >&2
  exit 1
fi

printf 'ci-portability guard: searches are portable, official actions use Node 24 lines, and the TypeScript guard follows npm ci\n'
