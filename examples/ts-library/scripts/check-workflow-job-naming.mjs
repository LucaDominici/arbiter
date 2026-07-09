#!/usr/bin/env node
// ts-library — workflow job naming convention drift detector (INV-89)
// Validates that all workflow jobs have explicit name: fields.
// Exits 0 when all jobs have names; exits 1 when unnamed jobs are found.
// Part of the anti-drift validator family (W6).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write([
    'Usage: node scripts/check-workflow-job-naming.mjs [options]',
    '',
    'Validates that all workflow jobs have explicit name: fields.',
    'Exits 0 when all jobs have names; exits 1 when unnamed jobs are found.',
    '',
    'Options:',
    '  --dir <path>    Root directory to scan (default: cwd)',
    '  --help, -h      Show this help and exit',
    '',
  ].join('\n'));
  process.exit(0);
}

const dirArg = args.indexOf('--dir');
const CWD = dirArg >= 0 && args[dirArg + 1] ? resolve(args[dirArg + 1]) : process.cwd();
const JOB_ID_RE = /^  ([a-z][a-z0-9_-]*):\s*$/;
const JOB_NAME_RE = /^    name:/;

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
  const lines = content.split('\n');
  let inJobs = false;
  let pendingJobId = null;
  let pendingLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('jobs:')) { inJobs = true; continue; }
    if (!inJobs) continue;
    if (pendingJobId) {
      if (JOB_NAME_RE.test(line)) {
        pendingJobId = null;
      } else if (line.startsWith('    runs-on:') || line.startsWith('    steps:') || line.startsWith('    needs:')) {
        process.stderr.write(`[FAIL] job "${pendingJobId}" in ${file}:${pendingLineIdx + 1} has no name: field\n`);
        violations++;
        pendingJobId = null;
      } else if (JOB_ID_RE.test(line)) {
        process.stderr.write(`[FAIL] job "${pendingJobId}" in ${file}:${pendingLineIdx + 1} has no name: field\n`);
        violations++;
        const m = JOB_ID_RE.exec(line);
        pendingJobId = m ? m[1] : null;
        pendingLineIdx = i;
      }
    } else {
      const m = JOB_ID_RE.exec(line);
      if (m) { pendingJobId = m[1]; pendingLineIdx = i; }
    }
  }
  if (pendingJobId) {
    process.stderr.write(`[FAIL] job "${pendingJobId}" in ${file}:${pendingLineIdx + 1} has no name: field\n`);
    violations++;
  }
}

if (violations > 0) {
  process.stderr.write(`check-workflow-job-naming: FAIL — ${violations} workflow job(s) missing name: field (INV-89)\n`);
  process.exit(1);
}
process.stdout.write(
  `check-workflow-job-naming: OK — all workflow jobs have name: fields (INV-89, ${yamlFiles.length} files scanned)\n`,
);
process.exit(0);
