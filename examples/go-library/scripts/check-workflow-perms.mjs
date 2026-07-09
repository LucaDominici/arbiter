#!/usr/bin/env node
// go-library — workflow top-level permissions gate (INV-76)
// Gate: verify all .github/workflows/*.yml files declare top-level permissions.
// Exits 0: all workflows pass.
// Exits 1: one or more missing the top-level permissions declaration.
// Part of the anti-drift validator family (W6).
// Usage: node scripts/check-workflow-perms.mjs [--help]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write('Usage: node scripts/check-workflow-perms.mjs [--help]\nVerify all workflow files declare top-level permissions.\n');
  process.exit(0);
}

const CWD = process.cwd();
const WORKFLOWS_DIR = join(CWD, '.github', 'workflows');

if (!existsSync(WORKFLOWS_DIR)) {
  console.log('  check-workflow-perms: no .github/workflows directory — skipping');
  process.exit(0);
}

const files = readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => join(WORKFLOWS_DIR, f));

// A top-level permissions block must exist AND must not be the broad 'write-all'
// shortcut. Per-scope 'write' values are allowed (they are intentional and
// auditable); 'write-all' is a hidden wildcard that defeats least-privilege.
const violations = [];
for (const file of files) {
  const content = readFileSync(file, 'utf-8');
  const topLevel = content.match(/^permissions:[ \t]*(.*)$/m);
  if (!topLevel) {
    violations.push({ file: file.replace(CWD + '/', ''), reason: 'missing top-level permissions' });
    continue;
  }
  const inline = topLevel[1].trim();
  if (inline === 'write-all') {
    violations.push({ file: file.replace(CWD + '/', ''), reason: "top-level 'write-all' is forbidden" });
  }
}

if (violations.length === 0) {
  console.log('  check-workflow-perms: all workflows declare top-level permissions (not write-all)');
  process.exit(0);
}

console.log(`  check-workflow-perms: ${violations.length} workflow(s) failed permission check:`);
for (const v of violations) {
  console.log(`    ${v.reason}: ${v.file}`);
}
process.exit(1);
