#!/usr/bin/env bash
# Arbiter hook: block orphan TODO comments (INV-06)
# Fires on: PostToolUse → Edit|Write
set -euo pipefail

FILE="${CLAUDE_TOOL_INPUT_PATH:-}"
[[ -z "$FILE" || ! -f "$FILE" ]] && exit 0

# Skip binary files and lock files
case "$FILE" in
  *.lock|*.lockb|*.png|*.jpg|*.jpeg|*.gif|*.svg|*.wasm|*.bin) exit 0 ;;
esac

# Find TODOs without task IDs like TODO(#123) or TODO: #123
if grep -nE '\bTODO\b' "$FILE" 2>/dev/null | grep -qvE '\bTODO\b.*\(#[0-9]+\)'; then
  OFFENDING=$(grep -nE '\bTODO\b' "$FILE" | grep -vE '\bTODO\b.*\(#[0-9]+\)' | head -3)
  echo "[arbiter] INV-06: Orphan TODO found in $FILE (must reference task ID like TODO(#123)):" >&2
  echo "$OFFENDING" >&2
  exit 1
fi

exit 0
