#!/usr/bin/env node
// Test naming convention gate for python-library
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


// Python: test files must match test_*.py. Support/helper modules with no
// `def test_*` of their own (e.g. the a11y `run_axe.py` helper a *_test.py
// file imports — same category as Java's step-definition/glue exemption
// above) legitimately live under tests/ without matching the convention —
// content-based exemption, not a bare filename check (#1840 F4 tranche-3:
// arbiter's OWN generated tests/e2e/a11y/run_axe.py tripped this gate on
// every python web-archetype init before this fix).
walk('tests', (file, name) => {
  if (!name.endsWith('.py')) return;
  if (name === '__init__.py' || name === 'conftest.py') return;
  if (name.startsWith('test_')) return;
  let content = '';
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    return;
  }
  const looksLikeTestEntryPoint = /^\s*def\s+test_/m.test(content);
  if (looksLikeTestEntryPoint) {
    flag(file, 'test file must be named test_*.py');
  }
});


if (violations > 0) {
  console.error(`\n[NAMING] ${violations} violation(s) found. Rename files to follow the convention.\n`);
  process.exit(1);
} else {
  console.log('[NAMING] All test files follow naming convention.');
}
