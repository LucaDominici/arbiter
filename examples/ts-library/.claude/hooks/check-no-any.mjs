#!/usr/bin/env node
// Fail if a TypeScript file was edited with an explicit 'any' type
import { readFileSync, existsSync } from 'node:fs';
import { resolveToolInputPath } from './lib.mjs';
const file = resolveToolInputPath();
if (!file.endsWith('.ts') && !file.endsWith('.tsx')) process.exit(0);
if (!existsSync(file)) process.exit(0);
const repoRoot = process.cwd();
if (!file.startsWith(repoRoot)) process.exit(0);
if (/:\s*any\b/.test(readFileSync(file, 'utf-8'))) {
  process.stderr.write(`[arbiter] INV-04: No 'any' type allowed: ${file}\n`);
  process.stderr.write(`[arbiter] Run \`arbiter explain INV-04\` for details.\n`);
  process.exit(2);
}