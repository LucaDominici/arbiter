#!/usr/bin/env node
// Arbiter hook: block explicit 'any' types in TypeScript (INV-04)
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from "node:fs";

const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? "";
if (!file || !existsSync(file)) process.exit(0);
if (!file.endsWith(".ts") && !file.endsWith(".tsx")) process.exit(0);

let content;
try {
  content = readFileSync(file, "utf-8");
} catch {
  process.exit(0);
}

const offending = content
  .split("\n")
  .flatMap((line, i) =>
    /:\s*any\b/.test(line) ? [`${i + 1}: ${line.trim()}`] : [],
  );

if (offending.length > 0) {
  process.stderr.write(`[arbiter] INV-04: No 'any' type allowed in ${file}:\n`);
  offending.slice(0, 3).forEach((l) => process.stderr.write(`  ${l}\n`));
  process.exit(1);
}
