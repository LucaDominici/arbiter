#!/usr/bin/env node
// ts-library-fixture — knowledge-map updater
// Utility: regenerate **Lines:** counts in KNOWLEDGE_MAP.md from actual doc sizes.
// Exits 0 always (utility, not a gate).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CWD = process.cwd();
const KM_FILE = join(CWD, 'docs', 'METHOD', 'KNOWLEDGE_MAP.md');

if (!existsSync(KM_FILE)) {
  console.log('  knowledge-map-update: no KNOWLEDGE_MAP.md found — skipping');
  process.exit(0);
}

let content = readFileSync(KM_FILE, 'utf-8');

const LOCATION_LINES_PATTERN = /(\*\*Location:\*\*\s+`([^`]+)`[^\n]*\n)(\*\*Lines:\*\*\s+\d+)/g;

let updated = 0;
content = content.replace(LOCATION_LINES_PATTERN, (match, locLine, filePath) => {
  const abs = join(CWD, filePath);
  if (!existsSync(abs)) return match;
  const text = readFileSync(abs, 'utf-8');
  const actual = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  updated++;
  return `${locLine}**Lines:** ${actual}`;
});

writeFileSync(KM_FILE, content, 'utf-8');
console.log(`  knowledge-map-update: updated ${updated} entry/entries in KNOWLEDGE_MAP.md`);
process.exit(0);
