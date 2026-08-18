#!/usr/bin/env bash
# SRS §3.1 — `docs/openapi.json` must describe the API this implementation
# ACTUALLY SERVES, not merely an API the SRS documents.
#
# WHY THIS EXISTS AS A SECOND CHECK.
#
# `check-openapi-td3.sh` compares the COMMITTED document against the TD-3
# registry. That is a real question and it is not this one: it passes happily
# while the document is months out of date, because a stale file can still
# describe only endpoints the SRS documents. Between `ed7212b` (2026-08-11) and
# `4842def` (2026-08-18) exactly that happened — 24 served endpoints were absent
# from the generator map, the generator hard-failed on every run, and every
# guard stayed green because none of them ever regenerated.
#
# The CI job DID regenerate, but its failure surfaced at a step named
# "Regenerate docs/openapi.json", which reads as a build error rather than as a
# contract gap — and nothing in the LOCAL flow ran the generator at all. This
# script is the local half, so `scripts/ci/*.sh` sweeps catch it.
#
# It fails on all three staleness modes:
#   * a served endpoint with no generator mapping   (invented-by-omission)
#   * a mapped endpoint the router does not serve   (advertises a 404)
#   * a document that reconciles but was never regenerated after an edit
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [[ ! -d backend/node_modules ]]; then
  echo "SKIP: backend dependencies not installed; OpenAPI currency not checked."
  exit 0
fi

cd backend
exec npx tsx scripts/generate-openapi.ts --check
