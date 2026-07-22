#!/usr/bin/env node
// ts-library-fixture — doc-links gate
// Gate: verify markdown links in docs/ resolve; follow CANONICAL_PATHS redirects.
// Exits 0: all links resolve (possibly via redirect) or no docs found.
// Exits 1: one or more broken links with no valid redirect.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { walkRepo } from './lib/glob-walk.mjs';

const CWD = process.cwd();
const CANONICAL_PATHS_FILE = join(CWD, 'docs', 'METHOD', 'CANONICAL_PATHS.md');
const IGNORE_FILE = join(CWD, '.docs-links-ignore');
const DOCS_DIR = join(CWD, 'docs');

const ignored = new Set();
if (existsSync(IGNORE_FILE)) {
  readFileSync(IGNORE_FILE, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((p) => ignored.add(p));
}

function loadAliases() {
  const aliases = new Map();
  if (!existsSync(CANONICAL_PATHS_FILE)) return aliases;
  const lines = readFileSync(CANONICAL_PATHS_FILE, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`/);
    if (m) aliases.set(m[1], m[2]);
  }
  return aliases;
}

// Directory walking is delegated to the shared cycle-safe walkRepo (#1521/#1544): a single helper
// owns tree traversal (symlink-cycle safe, vendor-tree pruning via SKIP_DIRS) instead of a
// hand-rolled recursion. Returns absolute `.md` paths under `dir`.
function findMarkdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return walkRepo(dir)
    .filter((rel) => rel.endsWith('.md'))
    .map((rel) => join(dir, rel));
}

function isLocal(href) {
  return (
    !href.startsWith('http://') &&
    !href.startsWith('https://') &&
    !href.startsWith('#') &&
    !href.startsWith('mailto:')
  );
}

const aliases = loadAliases();
const markdownFiles = findMarkdownFiles(DOCS_DIR);

if (markdownFiles.length === 0) {
  console.log('  check-doc-links: no docs found — skipping');
  process.exit(0);
}

const LINK_PATTERN = /\[([^\]]*)\]\(([^)]+)\)/g;
let broken = 0;

for (const file of markdownFiles) {
  const content = readFileSync(file, 'utf-8');
  const fileDir = dirname(file);
  for (const linkMatch of content.matchAll(LINK_PATTERN)) {
    const href = linkMatch[2].split('#')[0];
    if (!href || !isLocal(href)) continue;

    const absTarget = resolve(fileDir, href);
    const relTarget = relative(CWD, absTarget);

    if (ignored.has(relTarget)) continue;
    if (existsSync(absTarget)) continue;

    const redirectTarget = aliases.get(relTarget);
    if (redirectTarget) {
      const absRedirect = join(CWD, redirectTarget);
      if (existsSync(absRedirect)) continue;
      const srcRel = relative(CWD, file);
      console.log(`  broken: ${srcRel}: ${relTarget} → redirect ${redirectTarget} also missing`);
    } else {
      const srcRel = relative(CWD, file);
      console.log(`  broken: ${srcRel}: ${relTarget}`);
    }
    broken++;
  }
}

if (broken === 0) {
  console.log(`  check-doc-links: all links resolve (${markdownFiles.length} files scanned)`);
  process.exit(0);
}

console.log(`\n  check-doc-links: ${broken} broken link(s) found`);
process.exit(1);
