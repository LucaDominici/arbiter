#!/usr/bin/env node
// ts-library — workflow documentation sync checker (INV-89)
// Validates that all workflow files are documented in docs/ directory.
// Exits 0 when all workflows are documented; exits 0 (WARN) when undocumented found.
// Part of the anti-drift validator family (W6).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write([
    'Usage: node scripts/check-workflow-docs-sync.mjs [options]',
    '',
    'Validates that all workflow files are documented in docs/ directory.',
    'Exits 0 when all workflows are documented; exits 0 (WARN) when undocumented found.',
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
const WORKFLOWS_DIR = join(CWD, '.github', 'workflows');
const DOCS_DIR = join(CWD, 'docs');
const EXEMPT_PREFIXES = ['_'];

if (!existsSync(WORKFLOWS_DIR)) {
  process.stdout.write('check-workflow-docs-sync: SKIP — no .github/workflows/ directory\n');
  process.exit(0);
}
if (!existsSync(DOCS_DIR)) {
  process.stdout.write('check-workflow-docs-sync: SKIP — no docs/ directory\n');
  process.exit(0);
}

function gatherDocContent(dir) {
  let content = '';
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return content;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      content += gatherDocContent(full);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      try {
        content += readFileSync(full, 'utf-8') + '\n';
      } catch { /* ignore */ }
    }
  }
  return content;
}

const docContent = gatherDocContent(DOCS_DIR);
let violations = 0;
let checked = 0;

const wfEntries = readdirSync(WORKFLOWS_DIR, { withFileTypes: true });
for (const entry of wfEntries) {
  if (!entry.isFile()) continue;
  if (!entry.name.endsWith('.yml') && !entry.name.endsWith('.yaml')) continue;
  const name = basename(entry.name, entry.name.endsWith('.yml') ? '.yml' : '.yaml');
  if (EXEMPT_PREFIXES.some((p) => entry.name.startsWith(p))) continue;
  checked++;
  if (!docContent.includes(name) && !docContent.includes(entry.name)) {
    process.stderr.write(`[WARN] workflow "${entry.name}" not referenced in any docs/ markdown (INV-89)\n`);
    violations++;
  }
}

if (violations > 0) {
  process.stdout.write(
    `check-workflow-docs-sync: WARN — ${violations}/${checked} workflow(s) not documented in docs/ (INV-89)\n`,
  );
  // Warning only — docs are often written after implementation
  process.exit(0);
}
process.stdout.write(`check-workflow-docs-sync: OK — all ${checked} workflows referenced in docs/ (INV-89)\n`);
process.exit(0);
