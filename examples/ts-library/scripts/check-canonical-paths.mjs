#!/usr/bin/env node
// ts-library-fixture — canonical-paths gate (INV-50)
// Gate: verify every redirect target in CANONICAL_PATHS.md exists on disk.
// Exits 0: all redirect targets exist, or no CANONICAL_PATHS.md found.
// Exits 1: one or more redirect targets are missing (dangling aliases).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CWD = process.cwd();
const CANONICAL_PATHS_FILE = join(CWD, 'docs', 'METHOD', 'CANONICAL_PATHS.md');

if (!existsSync(CANONICAL_PATHS_FILE)) {
  console.log('  check-canonical-paths: no CANONICAL_PATHS.md found — skipping');
  process.exit(0);
}

const content = readFileSync(CANONICAL_PATHS_FILE, 'utf-8');

const ROW_PATTERN = /^\|[^|]*\|\s*`([^`]+)`\s*\|/gm;

const dangling = [];
for (const match of content.matchAll(ROW_PATTERN)) {
  const target = match[1].trim();
  const abs = join(CWD, target);
  if (!existsSync(abs)) {
    dangling.push(target);
  }
}

if (dangling.length === 0) {
  console.log('  check-canonical-paths: all redirect targets exist');
  process.exit(0);
}

console.log(`  check-canonical-paths: ${dangling.length} dangling alias(es) in CANONICAL_PATHS.md:`);
for (const target of dangling) {
  console.log(`    dangling: ${target}`);
}
process.exit(1);
