#!/usr/bin/env bash
# Arbiter hook: check commit message format after git commit
# Fires on: PostToolUse → Bash
set -euo pipefail

COMMAND="${CLAUDE_TOOL_INPUT_COMMAND:-}"

# Only act on git commit commands
if ! echo "$COMMAND" | grep -qE '^git commit'; then
  exit 0
fi

# Get last commit message
MSG=$(git log -1 --format="%s" 2>/dev/null || echo "")

# Check conventional commit format: type(scope): summary
if ! echo "$MSG" | grep -qE '^(feat|fix|refactor|test|docs|ci|chore|perf|style|build|revert)(\([^)]+\))?: .{1,72}$'; then
  echo "[arbiter] Commit message does not follow convention: $MSG" >&2
  echo "[arbiter] Expected: type(scope): summary (e.g., feat(auth): add login)" >&2
  # Warning only — not blocking post-commit
fi

exit 0
