#!/usr/bin/env node
// go-library — PII scanner (INV-12)
// Scans source and test files for email, phone (E.164), and credit-card patterns.
// Reads suppressions/pii-allowlist.json to skip known fixtures/test data.
// Exit 1 on any unallowlisted PII find — HARD gate (no grace period).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = process.cwd();

const ALLOWLIST_PATH = join(ROOT, 'suppressions', 'pii-allowlist.json');
let allowlist = [];
if (existsSync(ALLOWLIST_PATH)) {
  try {
    const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8'));
    if (!Array.isArray(parsed)) {
      console.error('[PII] ERROR: suppressions/pii-allowlist.json must be a JSON array');
      process.exit(1);
    }
    allowlist = parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`[PII] ERROR: suppressions/pii-allowlist.json contains invalid JSON: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

const SCAN_DIRS = ['src', 'test', 'tests', '__tests__', 'spec'].filter(
  (d) => existsSync(join(ROOT, d)),
);

const SKIP_EXTENSIONS = new Set([
  '.lock', '.lockb', '.png', '.jpg', '.jpeg', '.gif', '.svg',
  '.wasm', '.bin', '.pdf', '.ico', '.zip', '.tar', '.gz',
]);

const PII_PATTERNS = [
  { label: 'email', re: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g },
  { label: 'phone-E164', re: /\+\d{7,15}\b/g },
  {
    label: 'credit-card',
    re: /\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12})\b/g,
  },
];

function isAllowed(filePath, lineNum, matchStr) {
  const rel = relative(ROOT, filePath).split('\\').join('/');
  return allowlist.some((entry) => {
    const hasFile = typeof entry.file === 'string' && entry.file.length > 0;
    const hasLine = typeof entry.line === 'number';
    const hasPattern = typeof entry.pattern === 'string' && entry.pattern.length > 0;
    // Specificity floor (#1669): a suppression must be NARROW — either an exact (file + line)
    // pair, or an exact match string. A bare file-only / line-only entry (or a substring file /
    // pattern) is rejected so one under-specified entry cannot blanket-disable this HARD gate.
    if (!(hasPattern || (hasFile && hasLine))) return false;
    // File is matched by path segment (exact file, or a directory prefix), never by substring:
    // {"file":"src"} or {"file":"r"} no longer match every path that merely contains the string.
    if (hasFile) {
      const ef = entry.file.split('\\').join('/');
      const prefix = ef.endsWith('/') ? ef : ef + '/';
      if (rel !== ef && !rel.startsWith(prefix)) return false;
    }
    if (hasLine && entry.line !== lineNum) return false;
    // Pattern is matched EXACTLY, not substring-contained: {"pattern":"@"} no longer suppresses
    // every email.
    if (hasPattern && matchStr !== entry.pattern) return false;
    return true;
  });
}

function scanFile(filePath) {
  if (SKIP_EXTENSIONS.has(extname(filePath))) return [];
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const findings = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { label, re } of PII_PATTERNS) {
      const matches = [...line.matchAll(new RegExp(re.source, 'g'))];
      for (const m of matches) {
        if (!isAllowed(filePath, i + 1, m[0])) {
          findings.push({ file: relative(ROOT, filePath), line: i + 1, label, match: m[0] });
        }
      }
    }
  }
  return findings;
}

function walk(dir, results = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, results);
    } else {
      results.push(full);
    }
  }
  return results;
}

const allFiles = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const allFindings = allFiles.flatMap(scanFile);

if (allFindings.length === 0) {
  console.log('[PII] No PII patterns found.');
  process.exit(0);
}

console.error('[PII] PII patterns detected — add suppressions/pii-allowlist.json entries to suppress known test fixtures:\n');
for (const f of allFindings.slice(0, 20)) {
  console.error(`  ${f.file}:${f.line} [${f.label}] ${f.match}`);
}
if (allFindings.length > 20) {
  console.error(`  ... and ${allFindings.length - 20} more`);
}
process.exit(1);
