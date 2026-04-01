import type { Language, LanguageHook } from "../wizard/types.js";

const TS_NO_ANY: LanguageHook = {
  name: "check-no-any.sh",
  description: "No `any` type in TypeScript source files",
  body: `#!/usr/bin/env bash
# Fail if a TypeScript file was edited with an explicit 'any' type
FILE="$CLAUDE_TOOL_INPUT_PATH"
[[ "$FILE" != *.ts && "$FILE" != *.tsx ]] && exit 0
if grep -qE ':\\s*any\\b' "$FILE" 2>/dev/null; then
  echo "[arbiter] INV: No 'any' type allowed: $FILE" >&2
  exit 1
fi`,
};

const RUST_NO_UNWRAP: LanguageHook = {
  name: "check-no-unwrap.sh",
  description:
    "No `.unwrap()` calls in Rust source files (use `?` or proper error handling)",
  body: `#!/usr/bin/env bash
# Fail if a Rust file was edited with an .unwrap() call
FILE="$CLAUDE_TOOL_INPUT_PATH"
[[ "$FILE" != *.rs ]] && exit 0
if grep -qE '\\.unwrap\\(\\)' "$FILE" 2>/dev/null; then
  echo "[arbiter] INV: No .unwrap() allowed in Rust: $FILE" >&2
  exit 1
fi`,
};

const COMMON_NO_ORPHAN_TODO: LanguageHook = {
  name: "check-no-orphan-todo.sh",
  description:
    "Every TODO comment must reference a task ID (e.g., // TODO(#123))",
  body: `#!/usr/bin/env bash
# Fail if a file has a TODO without a task reference
FILE="$CLAUDE_TOOL_INPUT_PATH"
if grep -qE '\\bTODO\\b(?!.*\\(#[0-9]+\\))' "$FILE" 2>/dev/null; then
  echo "[arbiter] INV: Orphan TODO found (must include task ID like TODO(#123)): $FILE" >&2
  exit 1
fi`,
};

export function getLanguageHooks(language: Language): LanguageHook[] {
  const hooks: LanguageHook[] = [COMMON_NO_ORPHAN_TODO];
  if (language === "typescript") hooks.push(TS_NO_ANY);
  if (language === "rust") hooks.push(RUST_NO_UNWRAP);
  return hooks;
}
