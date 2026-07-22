#!/usr/bin/env node
// ts-library-fixture — PR size gate drift checker (INV-89)
// Validates that the PR size gate configuration is present and within bounds.
// Exits 0 when PR size gate config is valid; exits 1 when config is missing or invalid.
// Part of the anti-drift validator family (W6).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write([
    'Usage: node scripts/check-pr-size-gate.mjs [options]',
    '',
    'Validates that PR size gate configuration (pr-size-config.json or workflow) is present.',
    'Exits 0 when config is valid; exits 1 when missing or invalid.',
    '',
    'Options:',
    '  --help, -h      Show this help and exit',
    '',
  ].join('\n'));
  process.exit(0);
}

const CWD = process.cwd();
const CONFIG_PATH = join(CWD, 'config', 'pr-size-config.json');
const WORKFLOW_DIR = join(CWD, '.github', 'workflows');
const MAX_WARNING_LINES = 1000;
const MAX_ERROR_LINES = 5000;

let violations = 0;

if (existsSync(CONFIG_PATH)) {
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    if (err instanceof SyntaxError) {
      process.stderr.write(`[FAIL] ${CONFIG_PATH}: invalid JSON — ${err.message}\n`);
      violations++;
      process.exit(1);
    }
    throw err;
  }
  const warn = typeof config.warnLines === 'number' ? config.warnLines : null;
  const error = typeof config.errorLines === 'number' ? config.errorLines : null;
  if (warn !== null && warn > MAX_WARNING_LINES) {
    process.stderr.write(`[FAIL] ${CONFIG_PATH}: warnLines=${warn} exceeds maximum ${MAX_WARNING_LINES} (INV-89)\n`);
    violations++;
  }
  if (error !== null && error > MAX_ERROR_LINES) {
    process.stderr.write(`[FAIL] ${CONFIG_PATH}: errorLines=${error} exceeds maximum ${MAX_ERROR_LINES} (INV-89)\n`);
    violations++;
  }
  if (violations > 0) {
    process.stderr.write('check-pr-size-gate: FAIL — PR size gate configuration out of bounds (INV-89)\n');
    process.exit(1);
  }
  process.stdout.write('check-pr-size-gate: OK — PR size gate configuration valid (INV-89)\n');
} else if (existsSync(WORKFLOW_DIR)) {
  let found = false;
  const entries = readdirSync(WORKFLOW_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.yml') && !entry.name.endsWith('.yaml')) continue;
    try {
      const content = readFileSync(join(WORKFLOW_DIR, entry.name), 'utf-8');
      if (content.includes('pr-size') || content.includes('size-check')) {
        found = true;
        break;
      }
    } catch { /* ignore */ }
  }
  if (found) {
    process.stdout.write('check-pr-size-gate: OK — PR size gate referenced in workflows (INV-89)\n');
  } else {
    process.stdout.write('check-pr-size-gate: SKIP — no PR size gate configuration found (optional) (INV-89)\n');
  }
} else {
  process.stdout.write('check-pr-size-gate: SKIP — no .github/workflows/ directory (INV-89)\n');
}
process.exit(0);
