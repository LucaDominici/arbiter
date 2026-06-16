#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Optional ADR repo-prefix validator (#1415). For multi-repo orgs that adopt the
// CATALOG: `<PREFIX>-NNN_slug.md` ADR convention (e.g. ARB-001_thin-pointer.md), this checks
// CATALOG: every ADR filename carries the org prefix and that ADR numbers are unique. It is
// CATALOG: NOT the canonical ADR-index gate (scripts/check-adr-index.mjs, INV-107) — that
// CATALOG: enforces frontmatter/README structure for the arbiter repo's bare-numeric ADRs.
// CATALOG: This validator is deterministic and prefix-aware: same dir ⇒ identical output.
//
// arbiter — ADR repo-prefix validator. Recognizes BOTH the repo-prefixed form and the legacy
// bare-numeric / ADR-NNN forms (dual recognition, #1415). When --prefix P is given, every
// repo-prefixed ADR must use exactly that prefix; legacy bare-numeric ADRs are always accepted.
//
// Exit codes (INV contract): 0 = pass, 1 = violation/error.
//
// Usage:
//   node scripts/validate-adr-prefix.mjs [--prefix P] [--adr-dir D] [--json] [--help]
//     --prefix P   required repo prefix for prefixed ADRs (e.g. ARB). Omit to only check numbers.
//     --adr-dir D  ADR directory (default docs/ADR)
//     --json       emit the result as JSON

import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/validate-adr-prefix.mjs [--prefix P] [--adr-dir D] [--json] [--help]',
      '',
      'Validate ADR filenames in an ADR directory (repo-prefix + unique numbers).',
      '',
      '  --prefix P   required prefix for repo-prefixed ADRs (e.g. ARB); legacy bare ADRs always pass',
      '  --adr-dir D  ADR directory (default docs/ADR)',
      '  --json       emit JSON',
      '  --help, -h   show this help',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const flag = (name) => args.includes(name)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const CWD = process.cwd()
const ADR_DIR = opt('--adr-dir', 'docs/ADR')
const PREFIX = opt('--prefix', '')

// ADR filename forms (anchored to start; NNN = >=3 digits; slug separated by - or _).
const BARE_RE = /^(\d{3,})[-_].+\.md$/ // 001-foo.md
const LEGACY_RE = /^ADR-(\d{3,})[-_].+\.md$/i // ADR-001-foo.md
const PREFIX_RE = /^([A-Za-z][A-Za-z0-9]*)-(\d{3,})[-_].+\.md$/ // ARB-001_foo.md

/** Classify one filename → { num, kind, prefix? } or null if it is not an ADR record. */
function classify(name) {
  let m = BARE_RE.exec(name)
  if (m) return { num: m[1], kind: 'bare' }
  m = LEGACY_RE.exec(name)
  if (m) return { num: m[1], kind: 'legacy' }
  m = PREFIX_RE.exec(name)
  if (m) return { num: m[2], kind: 'prefixed', prefix: m[1] }
  return null
}

function main() {
  const dirAbs = resolve(CWD, ADR_DIR)
  const violations = []
  let entries = []
  if (existsSync(dirAbs)) {
    try {
      entries = readdirSync(dirAbs)
    } catch {
      entries = []
    }
  }

  const numbers = new Map() // num → first filename that claimed it
  // Sort for deterministic output (same dir ⇒ identical report regardless of FS order).
  for (const name of [...entries].sort()) {
    if (name === 'README.md') continue
    const adr = classify(name)
    if (!adr) continue // non-ADR file (e.g. notes.txt) — ignored, not a violation
    // Wrong prefix: a prefixed ADR whose prefix ≠ the required one.
    if (PREFIX && adr.kind === 'prefixed' && adr.prefix.toUpperCase() !== PREFIX.toUpperCase()) {
      violations.push(`${name}: wrong prefix '${adr.prefix}' (expected '${PREFIX}')`)
    }
    if (numbers.has(adr.num)) {
      violations.push(`${name}: duplicate ADR number ${adr.num} (also ${numbers.get(adr.num)})`)
    } else {
      numbers.set(adr.num, name)
    }
  }

  const report = {
    adrDir: ADR_DIR,
    prefix: PREFIX || null,
    count: numbers.size,
    violations,
  }
  if (flag('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else if (violations.length) {
    process.stdout.write(`validate-adr-prefix: ${violations.length} violation(s) in ${ADR_DIR}\n`)
    for (const v of violations) process.stdout.write(`    ${v}\n`)
  } else {
    process.stdout.write(`validate-adr-prefix: ${numbers.size} ADR(s) OK in ${ADR_DIR}\n`)
  }
  return violations.length ? 1 : 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(`validate-adr-prefix: unexpected error — ${err?.message ?? err}\n`)
  process.exit(1)
}
