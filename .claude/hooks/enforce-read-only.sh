#!/usr/bin/env bash
# Arbiter hook: guard designated read-only files
# Fires on: PreToolUse → Edit|Write
set -euo pipefail

FILE="${CLAUDE_TOOL_INPUT_PATH:-}"

READ_ONLY_PATTERNS=(
  "AGENTS.md"
  "LICENSE"
  "package-lock.json"
  "Cargo.lock"
)

for pattern in "${READ_ONLY_PATTERNS[@]}"; do
  if [[ "$FILE" == *"$pattern"* ]]; then
    echo "[arbiter] Read-only file — edit requires explicit justification: $FILE" >&2
    exit 1
  fi
done

exit 0
