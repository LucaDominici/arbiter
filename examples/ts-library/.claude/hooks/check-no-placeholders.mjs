#!/usr/bin/env node
// Arbiter hook: block unfinished-code patterns in edited source files
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { resolveToolInputPath } from './lib.mjs';

const EXTENSIONS = new Set([".ts",".tsx",".mts",".cts",".mjs",".cjs",".js",".jsx"]);

// #2528: the three shouted-only markers below are built by concatenation so this
// checker's own source never contains one as a contiguous string — a literal
// occurrence here would make this hook block edits to itself (and to its own
// test). `marker()` also drops the case-insensitive flag these three used to
// carry, matching the other entries here: the plain word is ordinary English,
// only the all-caps form is a violation. The emitted `label` still reads
// correctly, since it is the same (correctly-cased) word passed in.
const marker = (word) => ({ re: new RegExp(`\\b${word}\\b`), label: word });

const PATTERNS = [
  marker(`PLACE${'HOLDER'}`),
  { re: /\bFIXME\b/, label: 'FIXME' },
  { re: /\bXXX\b/, label: 'XXX' },
  { re: /\bHACK\b/, label: 'HACK' },
  { re: /\bWIP\b/, label: 'WIP' },
  marker(`CHANGE${'ME'}`),
  marker(`REPLACE${'ME'}`),
  { re: /\b(it|describe|test)\.skip\s*\(/, label: 'disabled-test method' },
  { re: /\b(xit|xdescribe|xtest)\s*\(/, label: 'disabled-test alias' },
];

const file = resolveToolInputPath();
if (!file || !existsSync(file)) process.exit(0);
if (!EXTENSIONS.has(extname(file).toLowerCase())) process.exit(0);

let content;
try {
  content = readFileSync(file, 'utf-8');
} catch {
  process.stderr.write('[arbiter] ERROR: cannot read applicable source file\n');
  process.exit(2);
}

const found = [];
for (const [index, line] of content.split('\n').entries()) {
  for (const { re, label } of PATTERNS) {
    if (re.test(line)) {
      found.push(`  line ${index + 1}: [${label}]  ${line.trim()}`);
      break;
    }
  }
}

if (found.length > 0) {
  process.stderr.write(`Unfinished-code patterns found in ${file}:\n`);
  for (const message of found) process.stderr.write(`${message}\n`);
  process.stderr.write('\nRemove unfinished or disabled-test patterns before saving.\n');
  process.exit(2);
}
