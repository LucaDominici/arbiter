#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: vacuous-optional-assertion (#2590). `expect(x.key ?? <default>).toEqual(<default>)`
// CATALOG:   coerces an ABSENT key to the same value the assertion checks for, so deleting `key`
// CATALOG:   from the payload entirely still passes — the assertion cannot tell "present and equal
// CATALOG:   to the default" from "gone". AUDITED GRAMMAR (this is the exact shape flagged, not
// CATALOG:   every `??` inside an `expect(...)` call — see docs/internal/METHOD/TESTING.md #2590 and
// CATALOG:   docs/internal/METHOD/vacuous-optional-inventory-2590.md for the full scope/inventory):
// CATALOG:   an `expect(`/`await expect(` call, the SAME default literal on both sides of `??` and a
// CATALOG:   `.to<Matcher>(` call, one or more wrapping parens allowed (`expect((x ?? []))...` /
// CATALOG:   `expect(x ?? [])...`), single-line or wrapped across one line break. A bare helper call
// CATALOG:   like `checker(x ?? []).toEqual([])` is NOT flagged — the anchor requires a real
// CATALOG:   `expect(`/`await expect(` immediately opening the call. Matcher/literal
// CATALOG:   pairing: `[]`/`{}` only flag `.toEqual`/`.toStrictEqual` (`.toBe([])` is a REFERENTIAL
// CATALOG:   compare against a fresh literal — it never passes regardless of `x`, so it is not this
// CATALOG:   guard's problem); `''`/`""`/`null`/`false`/`0` (primitives, where `.toBe` IS value
// CATALOG:   equality) flag `.toEqual`/`.toStrictEqual`/`.toBe`. An assertion whose default differs
// CATALOG:   from the checked value (e.g. `x ?? '').toBe('real value')`) already fails on absence
// CATALOG:   and is not flagged. `/* ... */` block comments and `//` line comments (outside string
// CATALOG:   literals) are stripped before matching; a match still inside a quoted string literal is
// CATALOG:   also skipped (ponytail: per-line string-state tracking, not a real parser — a template
// CATALOG:   literal genuinely split across lines can defeat it). Bypass a real code match via
// CATALOG:   `// arbiter-allow-vacuous: <reason>` on the line or the line above. NO-DATA (no test
// CATALOG:   files) is a SKIP at exit 0; an unreadable test file FAILS closed and names the path.
// CATALOG: Rejected fold-in into check-anti-proforma.mjs (INV-118): that flags MISSING assertions;
// CATALOG:   this flags a PRESENT assertion that cannot discriminate — a different axis.
// CATALOG: selfOnly (like fixture-isolation): not emitted into
// CATALOG:   src/templates/scripts/check-anti-fake-green.mjs.ejs — this repo's own gate only for now.
// Exit codes per INV-53: 0=PASS/NO-DATA-skip, 1=FAIL (vacuous assertion or unreadable file), 2=ERROR.
// Usage: node scripts/check-vacuous-optional-assertion.mjs [--dir <path>] [--help]
import { readFileSync, readdirSync, lstatSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { walkRepo, SKIP_DIRS } from './lib/glob-walk.mjs'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: node scripts/check-vacuous-optional-assertion.mjs [--dir <path>]\n' +
      '  Fails closed on `expect(x ?? <default>).to<Matcher>(<default>)` in test files — the SAME\n' +
      '  default literal on both sides of `??` and the matcher call ([]/{} via toEqual/toStrictEqual;\n' +
      '  \'\'/""/null/false/0 also via toBe) — a deleted key coerces to the same default the assertion\n' +
      '  checks for, so removal passes silently. This is the audited grammar, not every `??` inside\n' +
      '  an `expect(...)` call. Add `// arbiter-allow-vacuous: <reason>` on the line or the line\n' +
      '  above to audit-exempt a case where the default really is the intended assertion. NO-DATA\n' +
      '  (no test files) is a SKIP at exit 0; an unreadable test file FAILS closed and names the path.\n',
  )
  process.exit(0)
}
const dirArgIdx = args.indexOf('--dir')
const ROOT = dirArgIdx >= 0 && args[dirArgIdx + 1] ? resolve(args[dirArgIdx + 1]) : process.cwd()

const isTestFile = (name) => /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)

// `[]`/`{}` are never reference-equal to a fresh literal, so `.toBe([])`/`.toBe({})` ALWAYS fails
// regardless of `x` — not this guard's problem (a different, always-red bug). Primitives compare by
// value under `.toBe`, so they DO exhibit the vacuous shape there too. null/false/0 need a word
// boundary so a real token isn't matched inside a longer identifier (`nullable`, `falsely`, `10`).
const OBJECT_LIKE = String.raw`\[\]|\{\}`
const PRIMITIVE = String.raw`''|""|\bnull\b|\bfalse\b|\b0\b`
// Anchor to an `expect(` call (optionally `await expect(`) BEFORE the `??` — otherwise a plain
// helper named e.g. `checker(x ?? []).toEqual([])` (not a real assertion) would false-positive.
// `[\s\S]*?` (non-greedy) between the call and `??` allows any member/index access in between
// without crossing into an unrelated LATER `expect(` on the same line.
const CALL_PREFIX = String.raw`(?:await\s+)?expect\([\s\S]*?`
// One or more wrapping `)` after the `??`-default (covers `expect(x ?? [])` and the extra-
// parenthesized `expect((x ?? []))`); `\s*` before the matcher call already matches a line break
// (JS `\s` includes `\n`), so `expect(x ?? [])\n  .toEqual([])` matches without loosening past an
// unrelated call like `.not.toEqual(...)` in between.
const objLikeRe = () =>
  new RegExp(
    `${CALL_PREFIX}\\?\\?\\s*(${OBJECT_LIKE})\\s*\\)+\\s*\\.to(?:Equal|StrictEqual)\\(\\s*\\1\\s*\\)`,
  )
const primitiveRe = () =>
  new RegExp(
    `${CALL_PREFIX}\\?\\?\\s*(${PRIMITIVE})\\s*\\)+\\s*\\.to(?:Equal|StrictEqual|Be)\\(\\s*\\1\\s*\\)`,
  )
const VACUOUS_PATTERNS = [objLikeRe(), primitiveRe()]

const EXEMPT_RE = /(?:^|\s)\/\/+\s*arbiter-allow-vacuous:\s*\S/

/** True when `line[idx]` sits inside a quoted string literal, tracked per-line (no cross-line
 * template-literal awareness — a real assertion is never legitimately split mid-string). */
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

/** Truncate `line` at the first `//` that is NOT inside a string literal (a real trailing or
 * whole-line comment) — a marker/pattern mention after it is prose, not code. */
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

/** Blank out `/* ... *\/` block comments (outside strings would need a real parser; ponytail: this
 * repo's test files don't nest block-comment delimiters inside string literals) while preserving
 * line breaks, so line numbers in violation reports stay accurate. */
function stripBlockComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

function findVacuousMatch(text) {
  for (const re of VACUOUS_PATTERNS) {
    const m = re.exec(text)
    if (m) return m
  }
  return null
}

/**
 * A second, cycle-safe pass over the tree that catches a DIRECTORY whose own name matches the
 * test-file convention (e.g. `__tests__/a.test.ts/`, a real foot-gun: a bad merge or a botched
 * `mkdir -p` can leave one). `walkRepo` only ever returns regular files/symlinks — a directory
 * shaped like a test file is silently recursed into and never reported, so it would never reach
 * the fail-closed unreadable-file path below. Mirrors walkRepo's own SKIP_DIRS + dev:inode cycle
 * guard, but stops descending once a directory itself matches `isTestFile`.
 */
function collectDirShapedTestFiles(root) {
  const acc = []
  const visited = new Set()
  const visit = (dir) => {
    let dirStat
    try {
      dirStat = statSync(dir)
      // Pure tree-walk helper mirroring the identical, already-exempted pattern in
      // scripts/lib/glob-walk.mjs's own `visit` — the consumer (main(), below) owns the actual
      // fail-closed exit contract for what it reads.
      // FAIL-OPEN-INTENT: skip one inaccessible dir and keep walking siblings.
    } catch {
      return
    }
    const key = `${dirStat.dev}:${dirStat.ino}`
    if (visited.has(key)) return
    visited.add(key)
    let entries
    try {
      entries = readdirSync(dir)
      // FAIL-OPEN-INTENT: skip one inaccessible dir and keep walking siblings (see above).
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      const full = join(dir, entry)
      let stat
      try {
        stat = lstatSync(full)
        // FAIL-OPEN-INTENT: skip one inaccessible entry and keep walking siblings (see above).
      } catch {
        continue
      }
      if (!stat.isDirectory()) continue
      if (isTestFile(entry)) acc.push(full)
      else visit(full)
    }
  }
  visit(root)
  return acc
}

function collectTestFiles(root) {
  const acc = []
  for (const rel of walkRepo(root)) {
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    if (isTestFile(name)) acc.push(resolve(root, rel))
  }
  acc.push(...collectDirShapedTestFiles(root))
  return acc
}

function main() {
  const files = collectTestFiles(ROOT)
  if (files.length === 0) {
    process.stdout.write('check-vacuous-optional-assertion: SKIP — no test files found (NO-DATA)\n')
    return 0
  }

  const violations = []
  for (const file of files) {
    let content
    try {
      // A directory named `*.test.ts` (or any non-regular-file path this walker returns) FAILS
      // closed here too, before readFileSync throws its own less-specific EISDIR.
      if (!statSync(file).isFile()) throw new Error('not a regular file')
      content = readFileSync(file, 'utf-8')
    } catch (err) {
      // Fail closed: an unreadable test file is a FAIL naming the path, never a silent skip.
      // Surfaced immediately (not only in the aggregate summary below) so `stderr` carries the
      // specific failure even if a later file in the loop throws unexpectedly.
      const detail = `  ${file}: unreadable — ${err?.message ?? err}`
      process.stderr.write(`check-vacuous-optional-assertion: ${detail.trim()}\n`)
      violations.push(detail)
      continue
    }
    const rawLines = content.split('\n')
    const codeLines = stripBlockComments(content).split('\n').map(stripLineComment)
    for (let i = 0; i < codeLines.length; i++) {
      // Try the line alone, then the line joined with the next (wrapped `.toEqual(...)` on its
      // own line). The match index is looked up in whichever text matched, for the string check.
      const single = findVacuousMatch(codeLines[i])
      // Only accept the joined-window match when it actually SPANS the line break (starts at or
      // before it) — otherwise a match fully contained in line i+1 would be double-reported here
      // AND (correctly) on its own line at the next iteration.
      let match = single
      let matchLine = codeLines[i]
      if (!match && i + 1 < codeLines.length) {
        const joinedText = `${codeLines[i]}\n${codeLines[i + 1]}`
        const joined = findVacuousMatch(joinedText)
        if (joined && joined.index <= codeLines[i].length) {
          match = joined
          matchLine = joinedText
        }
      }
      if (!match) continue
      if (isInsideStringLiteral(matchLine, match.index)) continue
      const prev = i > 0 ? rawLines[i - 1] : ''
      if (EXEMPT_RE.test(rawLines[i]) || EXEMPT_RE.test(prev)) continue
      violations.push(`  ${file}:${i + 1}: ${rawLines[i].trim()}`)
    }
  }

  if (violations.length > 0) {
    process.stderr.write(
      `check-vacuous-optional-assertion: ${violations.length} problem(s) — a deleted key coerces ` +
        `to the same default the assertion expects (or a test file could not be read):\n`,
    )
    for (const v of violations) process.stderr.write(v + '\n')
    return 1
  }
  process.stdout.write(
    `check-vacuous-optional-assertion: OK — ${files.length} test file(s), no vacuous assertions\n`,
  )
  return 0
}

try {
  process.exit(main())
} catch (e) {
  process.stderr.write(`check-vacuous-optional-assertion: ERROR — ${e?.message ?? e}\n`)
  process.exit(2)
}
