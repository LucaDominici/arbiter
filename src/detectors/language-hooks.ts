import type { Language, LanguageHook } from "../wizard/types.js";

const TS_NO_ANY: LanguageHook = {
  name: "check-no-any.mjs",
  description: "No `any` type in TypeScript source files",
  body: `#!/usr/bin/env node
// Fail if a TypeScript file was edited with an explicit 'any' type
import { readFileSync, existsSync } from 'node:fs';
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? '';
if (!file.endsWith('.ts') && !file.endsWith('.tsx')) process.exit(0);
if (!existsSync(file)) process.exit(0);
if (/:\\s*any\\b/.test(readFileSync(file, 'utf-8'))) {
  process.stderr.write(\`[arbiter] INV: No 'any' type allowed: \${file}\\n\`);
  process.exit(1);
}`,
};

const RUST_NO_UNWRAP: LanguageHook = {
  name: "check-no-unwrap.mjs",
  description:
    "No `.unwrap()` calls in Rust source files (use `?` or proper error handling)",
  body: `#!/usr/bin/env node
// Fail if a Rust file was edited with an .unwrap() call
import { readFileSync, existsSync } from 'node:fs';
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? '';
if (!file.endsWith('.rs')) process.exit(0);
if (!existsSync(file)) process.exit(0);
if (/\\.unwrap\\(\\)/.test(readFileSync(file, 'utf-8'))) {
  process.stderr.write(\`[arbiter] INV: No .unwrap() allowed in Rust: \${file}\\n\`);
  process.exit(1);
}`,
};

const COMMON_NO_ORPHAN_TODO: LanguageHook = {
  name: "check-no-orphan-todo.mjs",
  description:
    "Every TODO comment must reference a task ID (e.g., // TODO(#123))",
  body: `#!/usr/bin/env node
// Fail if a file has a TODO without a task reference
import { readFileSync, existsSync } from 'node:fs';
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? '';
if (!file || !existsSync(file)) process.exit(0);
let content; try { content = readFileSync(file, 'utf-8'); } catch { process.exit(0); }
const offending = content.split('\\n').flatMap((line, i) =>
  /\\bTODO\\b/.test(line) && !/\\bTODO\\b.*\\(#\\d+\\)/.test(line) ? [\`\${i + 1}: \${line.trim()}\`] : []
);
if (offending.length > 0) {
  process.stderr.write(\`[arbiter] INV: Orphan TODO found (must include task ID like TODO(#123)): \${file}\\n\`);
  offending.slice(0, 3).forEach(l => process.stderr.write(\`  \${l}\\n\`));
  process.exit(1);
}`,
};

export function getLanguageHooks(language: Language): LanguageHook[] {
  const hooks: LanguageHook[] = [COMMON_NO_ORPHAN_TODO];
  if (language === "typescript") hooks.push(TS_NO_ANY);
  if (language === "rust") hooks.push(RUST_NO_UNWRAP);
  return hooks;
}
