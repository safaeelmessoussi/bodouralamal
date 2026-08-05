#!/usr/bin/env bash
set -euo pipefail

# Wait until the Claude session has reset.
sleep 10800

# Prompt to send to Claude Code.
read -r -d '' PROMPT <<'EOF'
Continue M3b on `develop` from commit `ac489d5`.

The Engineering Efficiency Policy and reporting policy already integrated into the repository remain in force.

Your objective is to maximize implementation progress during this session.

Work autonomously, choosing the most efficient implementation strategy yourself. Continue implementing sequentially through the remaining roadmap without waiting for further instructions.

Priority order:

1. Complete TD-3.12 Course Schedules.
2. Complete TD-3.12 Sessions.
3. Continue with the next highest-priority remaining work.

Do not stop after completing a slice if there is sufficient remaining session budget to begin and reasonably complete another slice.

If you determine there is insufficient remaining budget to complete another meaningful slice, stop at the nearest logical boundary.

Before stopping:
- finish the current logical slice,
- run the verification appropriate for completed work,
- update all required documentation,
- commit and push,
- produce the standard completion report,
- produce a concise continuation handoff for the next session.

Use the available session budget as efficiently as possible. Prefer finishing complete vertical slices over leaving partially implemented work.

Do not pause to ask for approval unless a genuine architectural is required.
EOF

# Activate VS Code.
WINDOW=$(xdotool search --onlyvisible --name "Visual Studio Code" | head -n1)

if [ -z "${WINDOW:-}" ]; then
    echo "VS Code window not found."
    exit 1
fi

xdotool windowactivate --sync "$WINDOW"

sleep 1

xdotool type --delay 5 "$PROMPT"

sleep 0.5

xdotool key Return