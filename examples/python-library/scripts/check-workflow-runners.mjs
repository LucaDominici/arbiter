#!/usr/bin/env node
// python-library — workflow runner label drift detector (INV-89)
// Validates that all workflow jobs use the expected runner label.
// Enforcing: exits 1 on unexpected labels. Use --runner or the `${{ ... }}` /
// `$CI_` expression forms for legitimate runner-label customization.
// Part of the anti-drift validator family (W6).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);

// #2675 Codex round-1/2/3: a --dir must never be read as "use the default" when it cannot be
// honored, or the caller's own fixture-less SKIP paths silently report clean on the LIVE repo
// instead of the intended (missing) target. Accepts both `--dir value` and `--dir=value`, "last
// flag wins" across both forms, and refuses BEFORE the --help scan below — otherwise
// `--dir --help` would swallow --help as --dir's value and print help instead of refusing.
let dirGiven = false;
let dirValue;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dir') {
    dirGiven = true;
    dirValue = args[i + 1];
  } else if (a.startsWith('--dir=')) {
    dirGiven = true;
    dirValue = a.slice('--dir='.length);
  }
}
if (dirGiven && (dirValue === undefined || dirValue === '' || dirValue.startsWith('--'))) {
  process.stderr.write('check-workflow-runners: --dir requires a path argument\n');
  process.exit(2);
}

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write([
    'Usage: node scripts/check-workflow-runners.mjs [options]',
    '',
    'Validates that all workflow jobs use the expected runner label.',
    'Enforcing: exits 1 on unexpected labels (runner customization via --runner',
    'or ${{ ... }} / $CI_ expressions is allowed).',
    '',
    'Options:',
    '  --dir <path>        Root directory to scan (default: cwd)',
    '  --runner <label>    Expected runner label (default: ubuntu-latest)',
    '  --help, -h          Show this help and exit',
    '',
  ].join('\n'));
  process.exit(0);
}

let CWD = process.cwd();
if (dirGiven) {
  CWD = resolve(dirValue);
  if (!existsSync(CWD) || !statSync(CWD).isDirectory()) {
    process.stderr.write(`check-workflow-runners: --dir ${dirValue} does not exist or is not a directory\n`);
    process.exit(2);
  }
}
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
      process.stderr.write(`[FAIL] unexpected runner: "${runner}" (expected "${EXPECTED_RUNNER}") in ${file}\n`);
      violations++;
    }
  }
}

if (violations > 0) {
  process.stdout.write(
    `check-workflow-runners: FAIL — ${violations} job(s) use non-standard runner label (INV-89). ` +
      `Use "${EXPECTED_RUNNER}", pass --runner <label>, or use a \${{ ... }}/$CI_ expression for runner customization.\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `check-workflow-runners: OK — all jobs use expected runner "${EXPECTED_RUNNER}" (INV-89, ${yamlFiles.length} files scanned)\n`,
);
process.exit(0);
