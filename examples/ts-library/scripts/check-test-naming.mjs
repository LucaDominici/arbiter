#!/usr/bin/env node
// Test naming convention gate for ts-library
// Flags test files that don't follow the project's naming convention.
// Exit 1 if violations found (HARD gate — L1+).
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let violations = 0;

function walk(dir, fn) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(full, fn);
    } else {
      fn(full, entry);
    }
  }
}

function flag(file, message) {
  console.error(`[NAMING] ${file}: ${message}`);
  violations++;
}


import { walkRepo } from './lib/glob-walk.mjs';
// TypeScript: test files must match *.test.ts or *.spec.ts. Walk via the shared, cycle-safe
// helper (#1521) — its SKIP_DIRS already prune node_modules/.git/dist/build/coverage/.coverage.
function checkTs(root) {
  for (const rel of walkRepo(root)) {
    if (!rel.endsWith('.ts') || rel.endsWith('.d.ts')) continue;
    const full = join(root, rel);
    const looksLikeTest =
      rel.endsWith('.test.ts') || rel.endsWith('.spec.ts');
    let content = '';
    try {
      content = readFileSync(full, 'utf-8');
    } catch {
      continue;
    }
    const hasTestImport =
      content.includes("from 'vitest'") ||
      content.includes('from "vitest"') ||
      content.includes("from '@jest") ||
      content.includes('from "@jest') ||
      (content.includes("describe(") && content.includes("it("));
    if (hasTestImport && !looksLikeTest) {
      flag(full, 'test file must be named *.test.ts or *.spec.ts');
    }
  }
}
checkTs('src');
checkTs('__tests__');


if (violations > 0) {
  console.error(`\n[NAMING] ${violations} violation(s) found. Rename files to follow the convention.\n`);
  process.exit(1);
} else {
  console.log('[NAMING] All test files follow naming convention.');
}
