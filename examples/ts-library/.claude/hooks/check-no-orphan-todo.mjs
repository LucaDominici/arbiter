#!/usr/bin/env node
// Arbiter hook: block orphan TODO comments (INV-21)
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { addedLinesVsHEAD, resolveToolInputPath } from './lib.mjs';

// Match comment-context TODO but not TODO(#NNN).
const ORPHAN_TODO = /(?:\/\/|\/\*|\*)\s*TODO(?!\s*\(#\d+\))/;
const EXTENSIONS = new Set([".ts",".tsx",".mts",".cts",".mjs",".cjs",".js",".jsx"]);

const file = resolveToolInputPath();
if (!file || !existsSync(file)) process.exit(0);
if (!EXTENSIONS.has(extname(file).toLowerCase())) process.exit(0);

let content;
try {
  content = readFileSync(file, 'utf-8');
} catch {
  process.stderr.write('[arbiter] ERROR: cannot read applicable source file\n');
  process.exit(2);
}

// #2539: scan only the lines THIS edit added, not the whole file — a
// pre-existing orphan-TODO-shaped line on an untouched line (this checker's
// own doc comment illustrating the pattern, or its own regex definition) must
// not block an unrelated edit elsewhere in the same file. Untracked files and
// git errors fail OPEN to the whole-file scan (never skip).
const { tracked, added } = addedLinesVsHEAD(file);
const scanLines = tracked
  ? added.map(({ line, content: text }) => [line - 1, text])
  : content.split('\n').map((text, index) => [index, text]);

const offending = scanLines
  .filter(([, line]) => ORPHAN_TODO.test(line))
  .map(([i, line]) => `${i + 1}: ${line.trim()}`);

if (offending.length > 0) {
  process.stderr.write(
    `[arbiter] INV-21: Orphan TODO found in ${file} (must reference task ID like TODO(#123)):\n`,
  );
  offending.slice(0, 3).forEach((line) => process.stderr.write(`  ${line}\n`));
  process.stderr.write(`[arbiter] Run \`arbiter explain INV-21\` for details.\n`);
  process.exit(2);
}
