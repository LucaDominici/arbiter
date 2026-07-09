#!/usr/bin/env node
// Fail if a Python file uses a bare 'except:' clause
import { readFileSync, existsSync } from 'node:fs';
import { resolveToolInputPath } from './lib.mjs';
const file = resolveToolInputPath();
if (!file.endsWith('.py')) process.exit(0);
if (!existsSync(file)) process.exit(0);
const repoRoot = process.cwd();
if (!file.startsWith(repoRoot)) process.exit(0);
const lines = readFileSync(file, 'utf-8').split('\n');
const offending = lines.flatMap((line, i) =>
  /\bexcept\s*:/.test(line) && !line.trimStart().startsWith('#') ? [`${i + 1}: ${line.trim()}`] : []
);
if (offending.length > 0) {
  process.stderr.write(`[arbiter] INV: Bare except clause found (specify exception type): ${file}\n`);
  offending.slice(0, 3).forEach(l => process.stderr.write(`  ${l}\n`));
  process.exit(1);
}