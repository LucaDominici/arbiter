#!/usr/bin/env bash
# Arbiter hook: block dangerous bash commands
# Fires on: PreToolUse → Bash
set -euo pipefail

COMMAND="${CLAUDE_TOOL_INPUT_COMMAND:-}"

DANGEROUS_PATTERNS=(
  "rm -rf /"
  "rm -rf ~"
  "git push --force"
  "git push -f "
  "git reset --hard"
  "DROP TABLE"
  "DROP DATABASE"
  "sudo rm"
  "> /dev/sda"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qF "$pattern"; then
    echo "[arbiter] Blocked dangerous command: $COMMAND" >&2
    exit 1
  fi
done

exit 0
