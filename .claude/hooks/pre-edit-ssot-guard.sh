#!/usr/bin/env bash
# Arbiter hook: warn when editing governance/SSOT documents
# Fires on: PreToolUse → Edit|Write
set -euo pipefail

FILE="${CLAUDE_TOOL_INPUT_PATH:-}"

SSOT_PATTERNS=(
  "AGENTS.md"
  ".claude/CLAUDE.md"
  ".agents/CODEX.md"
  "docs/METHOD/"
  "docs/SYSTEM/DECISIONS"
)

for pattern in "${SSOT_PATTERNS[@]}"; do
  if [[ "$FILE" == *"$pattern"* ]]; then
    echo "[arbiter] SSOT guard: editing governance file — ensure change is intentional: $FILE" >&2
    # Warning only, not blocking
    exit 0
  fi
done

exit 0
