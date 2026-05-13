import type { Language, LanguageHook } from '../wizard/types.js'

const TS_NO_ANY: LanguageHook = {
  name: 'check-no-any.mjs',
  description: 'No `any` type in TypeScript source files',
  body: `#!/usr/bin/env node
// Fail if a TypeScript file was edited with an explicit 'any' type
import { readFileSync, existsSync } from 'node:fs';
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? '';
if (!file.endsWith('.ts') && !file.endsWith('.tsx')) process.exit(0);
if (!existsSync(file)) process.exit(0);
const repoRoot = process.cwd();
if (!file.startsWith(repoRoot)) process.exit(0);
if (/:\\s*any\\b/.test(readFileSync(file, 'utf-8'))) {
  process.stderr.write(\`[arbiter] INV: No 'any' type allowed: \${file}\\n\`);
  process.exit(1);
}`,
}

const RUST_NO_UNWRAP: LanguageHook = {
  name: 'check-no-unwrap.mjs',
  description: 'No `.unwrap()` calls in Rust source files (use `?` or proper error handling)',
  body: `#!/usr/bin/env node
// Fail if a Rust file was edited with an .unwrap() call
import { readFileSync, existsSync } from 'node:fs';
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? '';
if (!file.endsWith('.rs')) process.exit(0);
if (!existsSync(file)) process.exit(0);
const repoRoot = process.cwd();
if (!file.startsWith(repoRoot)) process.exit(0);
if (/\\.unwrap\\(\\)/.test(readFileSync(file, 'utf-8'))) {
  process.stderr.write(\`[arbiter] INV: No .unwrap() allowed in Rust: \${file}\\n\`);
  process.exit(1);
}`,
}

const COMMON_NO_ORPHAN_TODO: LanguageHook = {
  name: 'check-no-orphan-todo.mjs',
  description: 'Every TODO comment must reference a task ID (e.g., // TODO(#123))',
  body: `#!/usr/bin/env node
// Fail if a file has a TODO without a task reference
import { readFileSync, existsSync } from 'node:fs';
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? '';
if (!file || !existsSync(file)) process.exit(0);
const repoRoot = process.cwd();
if (!file.startsWith(repoRoot)) process.exit(0);
let content; try { content = readFileSync(file, 'utf-8'); } catch { process.exit(0); }
const offending = content.split('\\n').flatMap((line, i) =>
  /\\bTODO\\b/.test(line) && !/\\bTODO\\b.*\\(#\\d+\\)/.test(line) ? [\`\${i + 1}: \${line.trim()}\`] : []
);
if (offending.length > 0) {
  process.stderr.write(\`[arbiter] INV: Orphan TODO found (must include task ID like TODO(#123)): \${file}\\n\`);
  offending.slice(0, 3).forEach(l => process.stderr.write(\`  \${l}\\n\`));
  process.exit(1);
}`,
}

const GO_NO_UNCHECKED_ERR: LanguageHook = {
  name: 'check-no-unchecked-err.mjs',
  description:
    "No discarded error returns in Go source files (no '_ = ' patterns that ignore errors)",
  body: `#!/usr/bin/env node
// Fail if a Go file discards an error return with _ = pattern
import { readFileSync, existsSync } from 'node:fs';
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? '';
if (!file.endsWith('.go')) process.exit(0);
if (!existsSync(file)) process.exit(0);
const repoRoot = process.cwd();
if (!file.startsWith(repoRoot)) process.exit(0);
const lines = readFileSync(file, 'utf-8').split('\\n');
const offending = lines.flatMap((line, i) =>
  /^\\s*_\\s*=\\s*\\S+/.test(line) && !line.trimStart().startsWith('//') ? [\`\${i + 1}: \${line.trim()}\`] : []
);
if (offending.length > 0) {
  process.stderr.write(\`[arbiter] INV: Unchecked error (no '_ = ' patterns allowed): \${file}\\n\`);
  offending.slice(0, 3).forEach(l => process.stderr.write(\`  \${l}\\n\`));
  process.exit(1);
}`,
}

const PY_NO_BARE_EXCEPT: LanguageHook = {
  name: 'check-no-bare-except.mjs',
  description: 'No bare except clauses in Python source files (always specify exception type)',
  body: `#!/usr/bin/env node
// Fail if a Python file uses a bare 'except:' clause
import { readFileSync, existsSync } from 'node:fs';
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? '';
if (!file.endsWith('.py')) process.exit(0);
if (!existsSync(file)) process.exit(0);
const repoRoot = process.cwd();
if (!file.startsWith(repoRoot)) process.exit(0);
const lines = readFileSync(file, 'utf-8').split('\\n');
const offending = lines.flatMap((line, i) =>
  /\\bexcept\\s*:/.test(line) && !line.trimStart().startsWith('#') ? [\`\${i + 1}: \${line.trim()}\`] : []
);
if (offending.length > 0) {
  process.stderr.write(\`[arbiter] INV: Bare except clause found (specify exception type): \${file}\\n\`);
  offending.slice(0, 3).forEach(l => process.stderr.write(\`  \${l}\\n\`));
  process.exit(1);
}`,
}

const JAVA_NO_RAW_TYPES: LanguageHook = {
  name: 'check-no-raw-types.mjs',
  description: 'No raw generic types in Java source files (always use type parameters)',
  body: `#!/usr/bin/env node
// Fail if a Java file uses raw generic types (unparameterized generics)
import { readFileSync, existsSync } from 'node:fs';
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? '';
if (!file.endsWith('.java')) process.exit(0);
if (!existsSync(file)) process.exit(0);
const repoRoot = process.cwd();
if (!file.startsWith(repoRoot)) process.exit(0);
const lines = readFileSync(file, 'utf-8').split('\\n');
const offending = lines.flatMap((line, i) => {
  const t = line.trimStart();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return [];
  return /\\b(List|Map|Set|Collection|ArrayList|HashMap|HashSet|LinkedList|Queue|Deque|Iterator|Optional)\\b(?!<)/.test(line) ? [\`\${i + 1}: \${line.trim()}\`] : [];
});
if (offending.length > 0) {
  process.stderr.write(\`[arbiter] INV: Raw generic type found (always use type parameters like List<String>): \${file}\\n\`);
  offending.slice(0, 3).forEach(l => process.stderr.write(\`  \${l}\\n\`));
  process.exit(1);
}`,
}

const JAVA_NO_MOCKMVC: LanguageHook = {
  name: 'check-no-mockmvc.mjs',
  description: 'No MockMvc usage in Java test files — use RestAssured for integration tests',
  body: `#!/usr/bin/env node
// Fail if a Java file imports or uses MockMvc (use RestAssured instead)
import { readFileSync, existsSync } from 'node:fs';
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? '';
if (!file.endsWith('.java')) process.exit(0);
if (!existsSync(file)) process.exit(0);
const repoRoot = process.cwd();
if (!file.startsWith(repoRoot)) process.exit(0);
const content = readFileSync(file, 'utf-8');
if (/\\b(MockMvc|AutoConfigureMockMvc|MockMvcBuilders|MockMvcRequestBuilders|MockMvcResultMatchers)\\b/.test(content)) {
  process.stderr.write(\`[arbiter] INV-29: MockMvc is forbidden — use RestAssured for integration tests: \${file}\\n\`);
  process.exit(1);
}`,
}

export function getLanguageHooks(language: Language): LanguageHook[] {
  const hooks: LanguageHook[] = [COMMON_NO_ORPHAN_TODO]
  if (language === 'typescript' || language === 'multi') hooks.push(TS_NO_ANY)
  if (language === 'rust') hooks.push(RUST_NO_UNWRAP)
  if (language === 'go') hooks.push(GO_NO_UNCHECKED_ERR)
  if (language === 'python') hooks.push(PY_NO_BARE_EXCEPT)
  if (language === 'java' || language === 'multi') hooks.push(JAVA_NO_RAW_TYPES, JAVA_NO_MOCKMVC)
  return hooks
}
