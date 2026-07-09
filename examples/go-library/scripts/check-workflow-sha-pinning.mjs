#!/usr/bin/env node
// go-library — workflow SHA-pinning drift detector (INV-89)
// Validates that all third-party GitHub Actions references in .github/ are SHA-pinned.
// Exits 0 when all refs are SHA-pinned; exits 1 when tag/branch refs are found.
// Part of the anti-drift validator family (W6).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write([
    'Usage: node scripts/check-workflow-sha-pinning.mjs [options]',
    '',
    'Validates that all GitHub Actions references in .github/ are SHA-pinned.',
    'Exits 0 when all refs are SHA-pinned; exits 1 when tag/branch refs are found.',
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
const SHA_RE = /^[0-9a-f]{40}$/;
const USES_RE = /^\s*(?:-\s+)?uses:\s+(?:"([^"]+)"|'([^']+)'|(\S+))/;

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

const yamlFiles = [
  ...collectYamlFiles(join(CWD, '.github', 'workflows')),
  ...collectYamlFiles(join(CWD, '.github', 'actions')),
];

let violations = 0;

for (const file of yamlFiles) {
  let content;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    continue;
  }
  for (const line of content.split('\n')) {
    const m = USES_RE.exec(line);
    if (!m) continue;
    const ref = m[1] ?? m[2] ?? m[3];
    if (!ref || ref.startsWith('.')) continue;
    const atIdx = ref.lastIndexOf('@');
    if (atIdx < 0) continue;
    const pin = ref.slice(atIdx + 1);
    if (!SHA_RE.test(pin)) {
      process.stderr.write(`[FAIL] non-SHA action reference: ${ref} in ${file}\n`);
      violations++;
    }
  }
}

if (violations > 0) {
  process.stderr.write(
    `check-workflow-sha-pinning: FAIL — ${violations} non-SHA-pinned action reference(s) found (INV-89)\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `check-workflow-sha-pinning: OK — all action references are SHA-pinned (INV-89, ${yamlFiles.length} files scanned)\n`,
);
process.exit(0);
