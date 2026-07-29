#!/usr/bin/env bash
#
# Documentation link integrity.
#
# Fails the build on a relative Markdown link whose target file does not exist,
# or whose `#anchor` names no heading in the target document.
#
# WHY THIS EXISTS
# ---------------
# The documentation hierarchy is built on cross-references rather than
# duplication: a rule is stated once and linked to everywhere else (see
# docs/development/documentation-policy.md). That design is only as good as the
# links — a broken one turns "single source of truth" into "the truth is
# somewhere, good luck".
#
# Link integrity is mechanically checkable, so it is mechanically checked.
# ACCURACY is not, which is what code review is for.
#
# WHAT IT DELIBERATELY DOES NOT CHECK
# -----------------------------------
#   - External http(s) links. A network call in CI is a flaky build, and a dead
#     external link is not a reason to block a merge.
#   - docs/archive/**. It is a frozen historical snapshot; its links point at the
#     world as it was, and "fixing" them would defeat the purpose of a snapshot.
#   - docs/SRS.md as a SOURCE of links. It is immutable to contributors, so a
#     finding there could not be acted on anyway. It is still valid as a TARGET.
#
set -uo pipefail

fail=0
checked=0

# GitHub's anchor algorithm, applied to a heading's text:
#   lowercase · strip anything that is not alphanumeric, space, or hyphen ·
#   spaces to hyphens. Arabic characters survive as-is, which matches GitHub.
slugify() {
  # NOTE the trailing newline: without it every slug concatenates into one
  # line and `grep -x` matches nothing, so the guard reports every anchor as
  # broken. That failure mode is loud, but only because the guard was run
  # against real content before being trusted.
  printf '%s\n' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/`//g; s/\*\*//g; s/\*//g' \
    | sed -E 's/<[^>]*>//g' \
    | sed -E "s/[^[:alnum:][:space:]_-]//g" \
    | sed -E 's/^[[:space:]]+|[[:space:]]+$//g' \
    | tr ' ' '-'
}

# Every anchor a file offers: its headings, plus any explicit <a id="…"> tags.
anchors_of() {
  local file="$1"
  grep -E '^#{1,6} ' "$file" 2>/dev/null | sed -E 's/^#{1,6} //' | while IFS= read -r h; do
    slugify "$h"
  done
  grep -oE '<a id="[^"]+"' "$file" 2>/dev/null | sed -E 's/<a id="//; s/"//'
}

# Sources: every Markdown file we own, excluding the archive and the SRS.
mapfile -t sources < <(
  find . -name '*.md' \
    -not -path './node_modules/*' \
    -not -path './*/node_modules/*' \
    -not -path './.git/*' \
    -not -path './docs/archive/*' \
    -not -path './docs/SRS.md' \
    | sort
)

for src in "${sources[@]}"; do
  src_dir=$(dirname "$src")

  # Inline links: [text](target). Skip images, external URLs, and pure anchors
  # handled below.
  while IFS= read -r target; do
    [ -z "$target" ] && continue
    case "$target" in
      http://*|https://*|mailto:*|'#'*) continue ;;
    esac

    checked=$((checked + 1))

    path="${target%%#*}"
    anchor="${target#*#}"
    [ "$anchor" = "$target" ] && anchor=""

    resolved="$src_dir/$path"

    if [ ! -e "$resolved" ]; then
      echo "::error file=$src::broken link — '$path' does not exist (from $src)"
      fail=1
      continue
    fi

    # Anchor check, for Markdown targets only.
    if [ -n "$anchor" ] && [ "${resolved##*.}" = "md" ]; then
      # The SRS is a valid target but its headings carry §-numbers that do not
      # slugify predictably; skip anchor verification there rather than emit
      # noise nobody may act on.
      case "$resolved" in
        */SRS.md) continue ;;
      esac
      # Capture first, then match with a here-string — deliberately NOT
      # `anchors_of … | grep -q`. Under `pipefail`, `grep -q` exits as soon as
      # it matches, the upstream producer takes SIGPIPE (141), and the pipeline
      # reports failure even though the anchor was FOUND. That combination made
      # this guard report every anchor in the repository as broken.
      anchors=$(anchors_of "$resolved")
      if ! grep -qxF "$anchor" <<<"$anchors"; then
        echo "::error file=$src::broken anchor — '#$anchor' not found in $path (from $src)"
        fail=1
      fi
    fi
  done < <(grep -oE '\]\([^)]+\)' "$src" 2>/dev/null | sed -E 's/^\]\(//; s/\)$//')
done

if [ "$fail" -ne 0 ]; then
  echo
  echo "Documentation links are broken. Fix the link, or the heading it points at."
  echo "See docs/development/documentation-policy.md."
  exit 1
fi

echo "Documentation links OK — $checked relative links across ${#sources[@]} files."
