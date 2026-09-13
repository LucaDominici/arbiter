#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// One-off generator for docs/internal/METHOD/vacuous-optional-inventory-2590.md (#2590 AC-1): a
// MECHANICAL classification of every `expect(...)` call containing a `?? <literal>` default,
// broader than the enforced grammar in scripts/check-vacuous-optional-assertion.mjs (which only
// flags the exact same-default-both-sides shape it can safely auto-fail on). Not itself a gate —
// run by hand when the inventory needs regenerating; its output is committed, not derived at CI
// time.
//
// Classification (purely syntactic, no semantic judgment beyond what's on the line):
//   b (vacuous)  — the `??` literal reappears as the SOLE argument to `.toEqual`/`.toStrictEqual`/
//                  `.toBe` (identity-relevant matchers) with no `// arbiter-allow-vacuous` marker.
//                  Must be zero rows after the #2590 fixes.
//   a (optional) — same shape as (b), but an `// arbiter-allow-vacuous: <reason>` marker on the
//                  line or the line above documents it as an intentional, reviewed exception.
//   c (other)    — the default does not reappear in an identity matcher (different matcher, e.g.
//                  `.toContain`/`.toBeGreaterThan`/`.length`, or a different literal) — a
//                  different check entirely, safe by construction.
// Usage: node scripts/gen-vacuous-optional-inventory.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { walkRepo } from './lib/glob-walk.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

const isTestFile = (name) => /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)

// Any simple literal — broader than the enforced guard's DEFAULT set (adds numbers and arbitrary
// quoted strings) so this inventory does not silently miss a vacuous shape outside that set.
const LITERAL = String.raw`\[\]|\{\}|null|undefined|true|false|-?\d+(?:\.\d+)?|'[^'\n]*'|"[^"\n]*"`
const CALL_PREFIX = String.raw`(?:await\s+)?expect\([\s\S]*?`
const HIT_RE = new RegExp(`${CALL_PREFIX}\\?\\?\\s*(${LITERAL})`)
const IDENTITY_RE = (lit) => {
  const esc = lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `${CALL_PREFIX}\\?\\?\\s*${esc}\\s*\\)+\\s*\\.to(?:Equal|StrictEqual|Be)\\(\\s*${esc}\\s*\\)`,
  )
}
const EXEMPT_RE = /(?:^|\s)\/\/+\s*arbiter-allow-vacuous:\s*\S/

// Mirrors scripts/check-vacuous-optional-assertion.mjs's own string/comment awareness — without
// it, this generator would misreport the enforced guard's OWN test fixtures (which textually
// contain the banned shape as string literals) as real violations, undermining the "b must be
// zero" claim the inventory exists to support.
function isInsideStringLiteral(line, idx) {
  let inStr = null
  for (let i = 0; i < idx; i++) {
    const c = line[i]
    if (inStr) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === inStr) inStr = null
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c
    }
  }
  return inStr !== null
}
function stripLineComment(line) {
  let inStr = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inStr) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '/' && line[i + 1] === '/') return line.slice(0, i)
  }
  return line
}
function stripBlockComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

function collectTestFiles(root) {
  const acc = []
  for (const rel of walkRepo(root)) {
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    if (isTestFile(name)) acc.push(rel)
  }
  return acc.sort()
}

/** A `?? <literal>` hit on line `i` alone, or joined with the next line — whichever text it was
 * found in is returned alongside, for the string-literal check. `null` when neither matches. */
function findHit(codeLines, i, joined) {
  const lineHit = HIT_RE.exec(codeLines[i])
  if (lineHit) return { hit: lineHit, hitText: codeLines[i] }
  const joinedHit = HIT_RE.exec(joined)
  return joinedHit ? { hit: joinedHit, hitText: joined } : null
}

/** Documented via a `// arbiter-allow-vacuous` marker on this line or the line above. */
function isExempt(rawLines, i) {
  const prev = i > 0 ? rawLines[i - 1] : ''
  return EXEMPT_RE.test(rawLines[i]) || EXEMPT_RE.test(prev)
}

function classify(codeLines, rawLines, i) {
  const line = codeLines[i]
  const joined = i + 1 < codeLines.length ? `${line}\n${codeLines[i + 1]}` : line
  const found = findHit(codeLines, i, joined)
  if (!found) return null
  if (isInsideStringLiteral(found.hitText, found.hit.index)) return null

  const identity = IDENTITY_RE(found.hit[1])
  const vacuousShape = identity.test(line) || identity.test(joined)
  if (!vacuousShape) return { klass: 'c', reason: 'default not reasserted by an identity matcher' }
  if (isExempt(rawLines, i)) {
    return { klass: 'a', reason: 'documented via // arbiter-allow-vacuous marker' }
  }
  return {
    klass: 'b',
    reason: 'default reasserted by toEqual/toStrictEqual/toBe — vacuous on removal',
  }
}

function main() {
  const files = collectTestFiles(process.cwd())
  const rows = []
  for (const rel of files) {
    const full = resolve(rel)
    // Fail closed: an unreadable test file must abort the generation (ERROR), never be silently
    // skipped — a shrunk, mis-scanned inventory would misreport "b must be zero" as satisfied.
    const content = readFileSync(full, 'utf-8')
    const rawLines = content.split('\n')
    const codeLines = stripBlockComments(content).split('\n').map(stripLineComment)
    for (let i = 0; i < codeLines.length; i++) {
      if (!/\?\?/.test(codeLines[i])) continue
      const c = classify(codeLines, rawLines, i)
      if (!c) continue
      rows.push({ file: rel, line: i + 1, snippet: rawLines[i].trim(), ...c })
    }
  }

  const counts = { a: 0, b: 0, c: 0 }
  for (const r of rows) counts[r.klass]++

  const header =
    `---\n` +
    `title: 'Vacuous optional-default assertion inventory (#2590)'\n` +
    `doc_version: '1.0.0'\n` +
    `status: active\n` +
    `last_review: '${new Date().toISOString().slice(0, 10)}'\n` +
    `owner: ''\n` +
    // kind/audit + empty canonical_id (mirrors docs/audit/e2e-campaign-2026-08/*): a GENERATED,
    // one-off audit artifact, not a backbone doc — selectSsotDocs (scripts/gen-ssot-core.mjs) only
    // admits a backbone kind or a non-empty canonical_id, so this stays out of the curated SSOT
    // core set (__tests__/docs/wiki-migrate-1244.test.ts's 34-doc ceiling) on purpose.
    `canonical_id: ''\n` +
    `tags: ['audience/dev', 'kind/audit']\n` +
    `related: ['TESTING']\n` +
    `---\n\n` +
    `# Vacuous optional-default assertion inventory (#2590)\n\n` +
    `Generated by \`node scripts/gen-vacuous-optional-inventory.mjs\` — a MECHANICAL, syntax-only ` +
    `classification of every \`expect(...)\` call in \`__tests__/\` containing a \`?? <literal>\` ` +
    `default (broader than the enforced grammar in \`scripts/check-vacuous-optional-assertion.mjs\`, ` +
    `which only auto-fails the same-default-both-sides shape). Re-run and commit the diff when the ` +
    `shape recurs.\n\n` +
    `**Classes:** **b** (vacuous — default reasserted by an identity matcher with no documented ` +
    `exception; MUST be zero) · **a** (same shape, documented via \`// arbiter-allow-vacuous\`) · ` +
    `**c** (a different check entirely — different matcher or literal; safe by construction).\n\n` +
    `**Counts:** a=${counts.a} b=${counts.b} c=${counts.c} (total ${rows.length})\n\n`

  const table =
    `| File:line | Class | Snippet | Reason |\n| --- | --- | --- | --- |\n` +
    rows
      .map(
        (r) =>
          `| \`${r.file}:${r.line}\` | ${r.klass} | \`${r.snippet.replace(/\|/g, '\\|')}\` | ${r.reason} |`,
      )
      .join('\n') +
    '\n'

  process.stdout.write(header + table)
  process.stderr.write(
    `gen-vacuous-optional-inventory: ${rows.length} rows (a=${counts.a} b=${counts.b} c=${counts.c})\n`,
  )
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(main())
  } catch (e) {
    process.stderr.write(`gen-vacuous-optional-inventory: ERROR — ${e?.message ?? e}\n`)
    process.exit(1)
  }
}
