#!/usr/bin/env node
// Gate: verify no symbol in the active deprecation window has been silently removed. (#600, #606)
// Parses docs/DEPRECATIONS.md for active-deprecation rows, then greps src/ for each symbol.
// Also validates CLI_DEPRECATED_FLAGS registry: each entry must have deprecatedIn ≠ removeIn.
// #2449: also scans src/ for JSDoc `@deprecated` tags — the reverse direction. A symbol
// tagged deprecated in source but absent from the Active table is a documentation gap
// (the deprecation carries no version and no removal window), and fails the gate.
// Exits 0: doc rows and source tags agree in both directions.
// Exits 1: a symbol in the active window is missing from src/ (removal without process),
//          or a src/ symbol is tagged @deprecated with no Active-table row (#2449).
// Override: ALLOW_REMOVE_DEPRECATED=1 env var skips the gate (document in DEPRECATIONS.md).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = process.cwd()
const DEPRECATIONS_FILE = join(ROOT, 'docs', 'DEPRECATIONS.md')
const SRC_DIR = join(ROOT, 'src')
const SOURCE_EXT = /\.(?:ts|mts|cts|tsx)$/
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])

/** Strip markdown code ticks and surrounding whitespace from an Active-table cell. */
function normalizeSymbol(raw) {
  return String(raw ?? '')
    .replace(/`/g, '')
    .trim()
}

/** Last dot-separated segment of a symbol: `features.soloDevMode` → `soloDevMode`. */
function leafOf(symbol) {
  const parts = symbol.split('.')
  return parts[parts.length - 1]
}

if (process.env.ALLOW_REMOVE_DEPRECATED === '1') {
  process.stdout.write('check-deprecations: ALLOW_REMOVE_DEPRECATED=1 — skipping gate\n')
  process.exit(0)
}

if (!existsSync(DEPRECATIONS_FILE)) {
  process.stdout.write('check-deprecations: docs/DEPRECATIONS.md not found — skipping\n')
  process.exit(0)
}

const content = readFileSync(DEPRECATIONS_FILE, 'utf-8')

// Parse the Active Deprecations table.
// Expected row format: | symbol | deprecated-in | remove-in | replacement | status |
// Skip header rows, separator rows, and the "_(none currently active)_" empty-table marker.
const activeRows = []
let inActiveSection = false

for (const line of content.split('\n')) {
  if (/^#+\s+Active Deprecations/i.test(line)) {
    inActiveSection = true
    continue
  }
  if (/^#+\s+(Closed|Removed)/i.test(line)) {
    inActiveSection = false
    continue
  }
  if (!inActiveSection) continue

  // Skip separator lines, header lines, and blank lines
  if (!line.startsWith('|') || /^\|\s*[-:]+\s*\|/.test(line)) continue

  const cols = line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim())
  if (cols.length < 2) continue

  const symbol = normalizeSymbol(cols[0])
  // Skip the empty-table marker row and the header row
  if (!symbol || symbol.startsWith('_') || symbol === 'Symbol / Flag / Behavior') continue

  activeRows.push(symbol)
}

// #1170: do NOT early-exit when there are zero active doc rows — the CLI-flag
// version-gap validation below must run regardless (it is independent of the
// DEPRECATIONS.md active table). The symbol loop is a no-op for an empty table.
let violations = 0
for (const symbol of activeRows) {
  try {
    execFileSync(
      'grep',
      // #2453: `--` before the pattern is required, not cosmetic — a CLI flag
      // symbol (e.g. "--no-adopt-gate-spine") IS a leading-dash string, and
      // grep parses anything before `--` as options. Without this separator
      // every dash-prefixed flag "not found" — a false violation, not a real
      // one, that would have silently blocked the CLI Flag Lifecycle feature
      // this script exists to enforce.
      ['-r', '--include=*.ts', '--include=*.mjs', '-l', '--', leafOf(symbol), 'src/'],
      {
        encoding: 'utf-8',
        cwd: ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
  } catch {
    console.error(
      `  check-deprecations: "${symbol}" is in active deprecation window but not found in src/. ` +
        `Remove it from docs/DEPRECATIONS.md active table first, or use ALLOW_REMOVE_DEPRECATED=1.`,
    )
    violations++
  }
}

// ── CLI flag registry validation (#606) ──────────────────────────────────────
// Read the source TypeScript registry file directly as text and parse with a regex.
// This avoids requiring a build step in the gate.

/**
 * Returns true when version b is at least one MINOR bump ahead of version a.
 * A major bump always qualifies. A patch-only bump does not.
 */
function hasMinorGap(a, b) {
  const [aMaj, aMin] = a.split('.').map(Number)
  const [bMaj, bMin] = b.split('.').map(Number)
  if (bMaj > aMaj) return true
  return bMaj === aMaj && bMin - aMin >= 1
}

const CLI_REGISTRY_SRC = join(ROOT, 'src', 'internal', 'cli-deprecation-registry.ts')
if (existsSync(CLI_REGISTRY_SRC)) {
  const regSrc = readFileSync(CLI_REGISTRY_SRC, 'utf-8')
  // Extract flag records: match { flag: '...', ..., deprecatedIn: '...', removeIn: '...' }
  // Note: field order assumed to be flag → deprecatedIn → removeIn in record literals.
  const recordRe =
    /\{\s*flag:\s*'([^']+)'[^}]*deprecatedIn:\s*'([^']+)'[^}]*removeIn:\s*'([^']+)'[^}]*\}/gs
  for (const m of regSrc.matchAll(recordRe)) {
    const flag = m[1]
    const deprecatedIn = m[2]
    const removeIn = m[3]
    if (!hasMinorGap(deprecatedIn, removeIn)) {
      console.error(
        `  check-deprecations: CLI flag "${flag}" has insufficient version gap ` +
          `(${deprecatedIn} → ${removeIn}). Policy requires ≥1 MINOR version gap.`,
      )
      violations++
    }
  }
}

// ── Source @deprecated tag scan (#2449) ──────────────────────────────────────
// The reverse direction of the check above: every JSDoc `@deprecated` tag in src/
// must have a row in the Active table, so no deprecation can exist without a
// version and a removal window.

/** Recursively collect TypeScript source files under `dir`. */
function collectSourceFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(join(dir, entry.name), out)
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

/** Extract the declared identifier from a declaration line, or '' when none is found. */
function identifierFromDeclaration(line) {
  const keyword = line.match(
    /\b(?:function|class|interface|type|enum|const|let|var|namespace)\s+([A-Za-z_$][\w$]*)/,
  )
  if (keyword) return keyword[1]
  const member = line.match(/([A-Za-z_$][\w$]*)\s*[?!]?\s*[:(<=]/)
  return member ? member[1] : ''
}

/**
 * Index of the line holding the declaration that a JSDoc comment starting at
 * `tagLine` documents: the first non-blank, non-comment line after the block ends.
 */
function declarationLineIndex(lines, tagLine) {
  let i = tagLine
  if (!lines[i].includes('*/')) {
    while (i < lines.length && !lines[i].includes('*/')) i++
  }
  i++
  while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('//'))) i++
  return i
}

/** All `@deprecated`-tagged symbols in src/, as { name, file, line } records. */
function collectDeprecatedSymbols() {
  const found = []
  for (const file of collectSourceFiles(SRC_DIR)) {
    const lines = readFileSync(file, 'utf-8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*(?:\/\*\*|\*|\/\/)?[^\n]*@deprecated\b/.test(lines[i])) continue
      const declIndex = declarationLineIndex(lines, i)
      const name = declIndex < lines.length ? identifierFromDeclaration(lines[declIndex]) : ''
      found.push({ name, file: relative(ROOT, file), line: i + 1 })
    }
  }
  return found
}

const documentedNames = new Set()
for (const symbol of activeRows) {
  documentedNames.add(symbol)
  documentedNames.add(leafOf(symbol))
}

const sourceTags = collectDeprecatedSymbols()
for (const tag of sourceTags) {
  if (tag.name && documentedNames.has(tag.name)) continue
  const label = tag.name ? `"${tag.name}"` : 'an unnamed symbol'
  console.error(
    `  check-deprecations: ${label} is tagged @deprecated at ${tag.file}:${tag.line} but has ` +
      `no row in the docs/DEPRECATIONS.md Active table. Add a row (Deprecated in / Remove in / ` +
      `Replacement), or drop the @deprecated tag if the symbol is not actually deprecated.`,
  )
  violations++
}

if (violations > 0) {
  console.error(`\n  ${violations} deprecation violation(s). See docs/DEPRECATIONS.md.\n`)
  process.exit(1)
} else {
  process.stdout.write(
    `check-deprecations: OK (${activeRows.length} active deprecated symbol(s) present; ` +
      `${sourceTags.length} source @deprecated tag(s) documented; CLI flag version gaps valid)\n`,
  )
}
