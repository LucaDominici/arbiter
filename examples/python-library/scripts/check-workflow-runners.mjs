#!/usr/bin/env node
// python-library — workflow runner label drift detector (INV-89)
// Validates that all workflow jobs use the expected runner label.
// Exits 0 when all runners match; exits 0 (WARN) when unexpected labels found (informational).
// Part of the anti-drift validator family (W6).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write([
    'Usage: node scripts/check-workflow-runners.mjs [options]',
    '',
    'Validates that all workflow jobs use the expected runner label.',
    'Exits 0 when all runners match; exits 0 (WARN) when unexpected labels found (informational).',
    '',
    'Options:',
    '  --dir <path>        Root directory to scan (default: cwd)',
    '  --runner <label>    Expected runner label (default: ubuntu-latest)',
    '  --help, -h          Show this help and exit',
    '',
  ].join('\n'));
  process.exit(0);
}

const dirArg = args.indexOf('--dir');
const CWD = dirArg >= 0 && args[dirArg + 1] ? resolve(args[dirArg + 1]) : process.cwd();
const runnerArg = args.indexOf('--runner');
const EXPECTED_RUNNER = runnerArg >= 0 && args[runnerArg + 1] ? args[runnerArg + 1] : 'ubuntu-latest';
const RUNS_ON_RE = /^\s*runs-on:\s+(.+)$/;

function collectYamlFiles(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectYamlFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
      results.push(full);
    }
  }
  return results;
}

const yamlFiles = collectYamlFiles(join(CWD, '.github', 'workflows'));
let violations = 0;

for (const file of yamlFiles) {
  let content;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    continue;
  }
  for (const line of content.split('\n')) {
    const m = RUNS_ON_RE.exec(line);
    if (!m) continue;
    const runner = m[1].trim().replace(/^['"]|['"]$/g, '');
    if (runner.startsWith('${{') || runner.startsWith('$CI_')) continue;
    if (runner !== EXPECTED_RUNNER) {
      process.stderr.write(`[WARN] unexpected runner: "${runner}" (expected "${EXPECTED_RUNNER}") in ${file}\n`);
      violations++;
    }
  }
}

if (violations > 0) {
  process.stdout.write(
    `check-workflow-runners: WARN — ${violations} job(s) use non-standard runner label (INV-89)\n`,
  );
  // Informational only — exits 0 to allow runner customization
  process.exit(0);
}
process.stdout.write(
  `check-workflow-runners: OK — all jobs use expected runner "${EXPECTED_RUNNER}" (INV-89, ${yamlFiles.length} files scanned)\n`,
);
process.exit(0);
