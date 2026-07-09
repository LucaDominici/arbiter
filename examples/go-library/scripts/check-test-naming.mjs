#!/usr/bin/env node
// Test naming convention gate for go-library
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


// Go: all test files must end in _test.go (enforced by the Go toolchain)
walk('.', (file, name) => {
  if (!name.endsWith('.go')) return;
  const dir = file.replace(/\/[^/]+$/, '');
  if (dir.includes('vendor') || dir.includes('.git')) return;
  // A file that imports "testing" but is not named *_test.go is a violation
  let content = '';
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    return;
  }
  if (content.includes('"testing"') && !name.endsWith('_test.go')) {
    flag(file, 'test file must be named *_test.go');
  }
});


if (violations > 0) {
  console.error(`\n[NAMING] ${violations} violation(s) found. Rename files to follow the convention.\n`);
  process.exit(1);
} else {
  console.log('[NAMING] All test files follow naming convention.');
}
