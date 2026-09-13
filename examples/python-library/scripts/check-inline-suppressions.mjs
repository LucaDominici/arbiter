#!/usr/bin/env node
// python-library — inline suppression checker (INV-31)
// Validates arbiter-suppress directives in source files.
// Directive form: arbiter-suppress(INV-NN, until=YYYY-MM-DD, reason="...", owner=@user)
// Part of the anti-drift validator family (W6).
// Usage: node scripts/check-inline-suppressions.mjs [--help]

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { walkRepo } from './lib/glob-walk.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write('Usage: node scripts/check-inline-suppressions.mjs [--help]\nValidates arbiter-suppress directives in source files.\n');
  process.exit(0);
}

const REASON_MIN_LEN = 10;
const WARN_DAYS = 30;
const DIRECTIVE_RE = /\/\/\s*arbiter-suppress\(([^)]+)\)/g;
const SCANNED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx',
  '.java', '.kt', '.rs', '.py', '.rb', '.go',
]);
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__tests__']);
const KNOWN_INV_IDS = new Set([
  'INV-01','INV-02','INV-03','INV-04','INV-05','INV-06','INV-07',
  'INV-08','INV-09','INV-10','INV-11','INV-12','INV-13','INV-14',
  'INV-15','INV-16','INV-17','INV-18','INV-19','INV-20','INV-21',
  'INV-22','INV-23','INV-24','INV-25','INV-26','INV-27','INV-28',
  'INV-29','INV-30','INV-31','INV-32','INV-33','INV-34','INV-35',
  'INV-36','INV-37','INV-38','INV-39',
]);

function checkExpiry(dateStr, label, file, counters) {
  const expiry = new Date(dateStr);
  if (isNaN(expiry.getTime())) {
    process.stderr.write(`[FAIL] ${file}: ${label} — invalid until/expiresAt (not a date): ${dateStr}\n`);
    counters.failed++;
    return;
  }
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffMs < 0) {
    process.stderr.write(`[FAIL] ${file}: ${label} — expired (until/expiresAt: ${dateStr})\n`);
    counters.failed++;
  } else if (diffDays <= WARN_DAYS) {
    process.stderr.write(`[WARN] ${file}: ${label} expires in ${diffDays} day(s) (${dateStr})\n`);
    counters.warnings++;
  }
}

function validateEntry(entry, label, file, counters) {
  const required = ['reason', 'owner', 'expiresAt'];
  let valid = true;
  for (const field of required) {
    if (!entry[field]) {
      process.stderr.write(`[FAIL] ${file}: ${label} — missing required field: ${field}\n`);
      counters.failed++;
      valid = false;
    }
  }
  if (!valid) return;
  if (entry.reason.length < REASON_MIN_LEN) {
    process.stderr.write(`[FAIL] ${file}: ${label} — reason must be at least ${REASON_MIN_LEN} characters\n`);
    counters.failed++;
    return;
  }
  checkExpiry(entry.expiresAt, label, file, counters);
}

function parseArgs(argsStr) {
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (const ch of argsStr) {
    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = true; quoteChar = ch; current += ch;
    } else if (inQuote && ch === quoteChar) {
      inQuote = false; quoteChar = ''; current += ch;
    } else if (!inQuote && ch === ',') {
      parts.push(current.trim()); current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const QUOTE_CHARS = new Set(['`', '"', "'"]);

// A `/` starts a regex literal, not division or a comment, when it is not `//`
// or `/*` and the previous non-space character is one that can only precede an
// expression (assignment, call-arg, grouping, etc.) or the `/` is at the start
// of the line. `}` and `)` are deliberately excluded (#2671, round 3): they close a
// block/object or a call/grouping, so a following `/` is division on the result,
// not a new expression -- e.g. `{} / "text"` divides, it does not open a regex.
function isRegexLiteralStart(line, i) {
  if (line[i] !== '/' || line[i + 1] === '/' || line[i + 1] === '*') return false;
  let j = i - 1;
  while (j >= 0 && /\s/.test(line[j])) j -= 1;
  if (j < 0) return true;
  return '=([,:[!&|?{;'.includes(line[j]);
}

// Finds the index just past the end of a regex literal starting at `i` (the
// opening `/`), skipping escaped characters (so a `\/` inside the regex does not
// end it early). Returns line.length + 1 for an unterminated regex.
function regexLiteralEnd(line, i) {
  let j = i + 1;
  while (j < line.length && line[j] !== '/') {
    j += line[j] === '\\' ? 2 : 1;
  }
  return j + 1;
}

function isInsideStringLiteral(line, idx) {
  // Single-line string-state tracker (documented limit, #2671): walks from line start
  // to idx, toggling in-string state on unescaped ', ", or `. Directives only count
  // when in a real `//` comment — not when the syntax appears as text inside a string
  // literal (e.g. a hook file documenting the directive format in a template string,
  // which would otherwise be parsed as a real, malformed directive and FAIL the gate
  // on its own advisory text). Not a lexer: a multi-line template literal opened on an
  // earlier line is invisible (real suppressions are single-line `//` comments, so this
  // only risks false positives on contrived multi-line strings, never false negatives).
  // A `/regex/` literal is recognized and its content (including quotes inside, e.g. an
  // apostrophe) is skipped without toggling string state. Once a real (non-string) `//`
  // comment start is seen before idx, the rest of the line is a comment and any quotes
  // in it are ignored, so idx is never reported as "inside a string" merely because of
  // a quote in a trailing comment.
  let i = 0;
  let inStr = false;
  let quote = '';
  while (i < idx) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) { inStr = false; quote = ''; }
      i += 1;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') return false;
    if (isRegexLiteralStart(line, i)) {
      i = regexLiteralEnd(line, i);
      continue;
    }
    if (QUOTE_CHARS.has(ch)) { inStr = true; quote = ch; }
    i += 1;
  }
  return inStr;
}

function parseDirective(argsStr) {
  const parts = parseArgs(argsStr);
  if (parts.length === 0) return null;
  const result = {};
  const firstPart = parts[0];
  if (/^INV-\d+$/.test(firstPart) || !firstPart.includes('=')) result.invId = firstPart;
  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf('=');
    if (eqIdx === -1) continue;
    const key = parts[i].slice(0, eqIdx).trim();
    let val = parts[i].slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function scanFile(filePath, counters) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    DIRECTIVE_RE.lastIndex = 0;
    let match;
    while ((match = DIRECTIVE_RE.exec(lines[i])) !== null) {
      if (isInsideStringLiteral(lines[i], match.index)) continue;
      const label = `${filePath}:${i + 1}`;
      const parsed = parseDirective(match[1]);
      if (!parsed || !parsed.invId) {
        process.stderr.write(`[FAIL] ${label} — missing or malformed INV-NN identifier\n`);
        counters.failed++;
        continue;
      }
      if (!KNOWN_INV_IDS.has(parsed.invId)) {
        process.stderr.write(`[FAIL] ${label} — unknown invariant ID: ${parsed.invId}\n`);
        counters.failed++;
        continue;
      }
      validateEntry({ reason: parsed.reason, owner: parsed.owner, expiresAt: parsed.until },
        label, filePath, counters);
    }
  }
}

function walkDir(dir, counters) {
  // Cycle-safe walk via the shared helper (#1521): walkRepo prunes vendor trees and never recurses
  // into a symlinked directory. Re-apply this script's own IGNORED_DIRS as a path-segment filter so
  // the visited set is identical, minus the symlink-cycle bug.
  for (const rel of walkRepo(resolve(dir))) {
    if (rel.split('/').some((seg) => IGNORED_DIRS.has(seg))) continue;
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    const ext = name.slice(name.lastIndexOf('.'));
    if (SCANNED_EXTENSIONS.has(ext)) scanFile(join(dir, rel), counters);
  }
}

const targetDir = process.argv[2] ?? '.';
const counters = { failed: 0, warnings: 0 };
walkDir(targetDir, counters);
if (counters.warnings > 0) {
  process.stderr.write(`[WARN] ${counters.warnings} suppression(s) expiring within 30 days\n`);
}
process.exit(counters.failed > 0 ? 1 : 0);
