#!/usr/bin/env bash
# Fail if a TypeScript file was edited with an explicit 'any' type
FILE="$CLAUDE_TOOL_INPUT_PATH"
[[ "$FILE" != *.ts && "$FILE" != *.tsx ]] && exit 0
if grep -qE ':\s*any\b' "$FILE" 2>/dev/null; then
  echo "[arbiter] INV: No 'any' type allowed: $FILE" >&2
  exit 1
fi