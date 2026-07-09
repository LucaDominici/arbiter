#!/usr/bin/env node
// ts-library — CI tier presence gate (INV-72)
// Gate: verify the required CI workflow files exist in .github/workflows/.
// The required set is fixed at generation time as the inverse of the workflow
// generation predicates (collaboration mode peer-review × governance L1).
// Exits 0: all required present.
// Exits 1: one or more missing.
// Part of the anti-drift validator family (W6).
// Usage: node scripts/check-ci-tiers.mjs [--help]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write('Usage: node scripts/check-ci-tiers.mjs [--help]\nVerify all required CI tier workflow files exist.\n');
  process.exit(0);
}

const CWD = process.cwd();
const WORKFLOWS_DIR = join(CWD, '.github', 'workflows');

// Required CI-tier files for this project (collaboration mode + governance level
// resolved at generation time — INV-72).
const REQUIRED_TIERS = [
  '01-pr-fast.yml',
  '02-pr-extended.yml',
  '03-human-approval.yml',
];

const missing = REQUIRED_TIERS.filter((f) => !existsSync(join(WORKFLOWS_DIR, f)));


if (missing.length === 0) {
  console.log(`  check-ci-tiers: all ${REQUIRED_TIERS.length} required CI tier workflow(s) present`);
  process.exit(0);
}

if (missing.length > 0) {
  console.log(`  check-ci-tiers: ${missing.length} missing workflow file(s):`);
  for (const f of missing) {
    console.log(`    missing: .github/workflows/${f}`);
  }
}
process.exit(1);
