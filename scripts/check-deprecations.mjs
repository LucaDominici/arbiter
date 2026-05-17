#!/usr/bin/env node
// Gate: verify no symbol in the active deprecation window has been silently removed. (#600, #606)
// Parses docs/DEPRECATIONS.md for active-deprecation rows, then greps src/ for each symbol.
// Also validates CLI_DEPRECATED_FLAGS registry: each entry must have deprecatedIn ≠ removeIn.
// Exits 0: all active deprecated symbols still present in src/, or no active deprecations.
// Exits 1: a symbol in the active window is missing from src/ (removal without process).
// Override: ALLOW_REMOVE_DEPRECATED=1 env var skips the gate (document in DEPRECATIONS.md).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = process.cwd()
const DEPRECATIONS_FILE = join(ROOT, 'docs', 'DEPRECATIONS.md')

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
// Skip header rows, separator rows, and "none yet" placeholder rows.
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

  const symbol = cols[0]
  // Skip placeholder rows
  if (!symbol || symbol.startsWith('_') || symbol === 'Symbol / Flag / Behavior') continue

  activeRows.push(symbol)
}

if (activeRows.length === 0) {
  process.stdout.write('check-deprecations: no active deprecations — OK\n')
  process.exit(0)
}

let violations = 0
for (const symbol of activeRows) {
  try {
    execFileSync('grep', ['-r', '--include=*.ts', '--include=*.mjs', '-l', symbol, 'src/'], {
      encoding: 'utf-8',
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
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

if (violations > 0) {
  console.error(`\n  ${violations} deprecation violation(s). See docs/DEPRECATIONS.md.\n`)
  process.exit(1)
} else {
  process.stdout.write(
    `check-deprecations: OK (${activeRows.length} active deprecated symbol(s) still present)\n`,
  )
}
