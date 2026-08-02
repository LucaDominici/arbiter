#!/usr/bin/env node
// Fail if a Go file discards an error return with _ = pattern
import { readFileSync, existsSync } from 'node:fs';
import { resolveToolInputPath } from './lib.mjs';
const file = resolveToolInputPath();
if (!file.endsWith('.go')) process.exit(0);
if (!existsSync(file)) process.exit(0);
const repoRoot = process.cwd();
if (!file.startsWith(repoRoot)) process.exit(0);
const lines = readFileSync(file, 'utf-8').split('\n');
const offending = lines.flatMap((line, i) =>
  /^\s*_\s*=\s*\S+/.test(line) && !line.trimStart().startsWith('//') ? [`${i + 1}: ${line.trim()}`] : []
);
if (offending.length > 0) {
  process.stderr.write(`[arbiter] INV: Unchecked error (no '_ = ' patterns allowed): ${file}\n`);
  offending.slice(0, 3).forEach(l => process.stderr.write(`  ${l}\n`));
  process.exit(2);
}