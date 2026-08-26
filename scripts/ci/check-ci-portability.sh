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

printf 'ci-portability guard: every CI guard searches with POSIX grep\n'
