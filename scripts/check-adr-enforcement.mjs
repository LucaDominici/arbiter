#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// check-adr-enforcement.mjs — ADR → check enforcement linkage gate (#1473, epic #1469).
//
// An ADR records a decision; `enforces: [<check-id> | INV-nn]` in its frontmatter claims that
// decision is machine-enforced by a real gold-audit check (the registry) or a real invariant
// (src/invariants/catalog.ts). This gate verifies every such ref RESOLVES — a DANGLING ref, or an
// `enforces:` claim hidden behind UNPARSEABLE frontmatter, is a FAIL, because an unverifiable
// "we enforce X" claim is documentation pretending to be enforcement (a fake-green). Deterministic,
// pure (reads the tree, no spawn — INV-12).
//
// COVERAGE RATCHET (#2480): the linkage above is sound but was OPT-IN — 115 of 118 numbered ADRs
// declared nothing, so the gate could pass while almost no decision named what keeps it true. The
// ratchet closes that without a flag day: the count of numbered ADRs declaring NO `enforces:` is
// pinned in scripts/data/adr-enforcement-baseline.json and may FALL freely but never rise. A new
// ADR must therefore name its enforcement, while the existing corpus is grandfathered and paid
// down one decision at a time. Templates and the generated README are excluded — a template has no
// decision to enforce.
//
// Exit: 0 = all refs resolve (or none declared) AND the unclaimed count has not risen;
//       1 = at least one dangling/unverifiable ref, or the ratchet rose.
//
// CATALOG: rejected fold-in into scripts/check-adr-index.mjs because that gate validates ADR
// CATALOG:   structure (canonical_id / index parity), not the cross-artifact enforces↔check/INV
// CATALOG:   linkage — a different concern with its own registry + catalog reads.
// CATALOG: rejected fold-in into scripts/lib/gold-audit-lib.mjs because that is the pure scored-
// CATALOG:   payload evaluator; an ADR-frontmatter traceability gate is presentation/governance.

import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

const CWD = process.cwd()
const BASELINE_REL = 'scripts/data/adr-enforcement-baseline.json'
/** A numbered decision record. Templates and README carry no decision, so they are not counted. */
const NUMBERED_ADR = /^\d{3}-.*\.md$/

/** All gold-check ids declared by any standards/gold-registry(.stack).yml (any prefix — GA/GO/TS/…). */
function goldCheckIds() {
  const ids = new Set()
  const dir = resolve(CWD, 'standards')
  if (!existsSync(dir)) return ids
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return ids
  }
  for (const f of entries) {
    if (!/^gold-registry(\.[a-z0-9]+)?\.yml$/.test(f)) continue
    let doc
    try {
      doc = parseYaml(readFileSync(join(dir, f), 'utf-8'))
    } catch {
      continue // a malformed registry contributes no ids — refs resolve only against real ids
    }
    const checks = doc && Array.isArray(doc.checks) ? doc.checks : []
    for (const c of checks) {
      if (c && typeof c === 'object' && typeof c.id === 'string') ids.add(c.id)
    }
  }
  return ids
}

/**
 * Strip `//` line and `/* … *\/` block comments from TS/JS source, WITHOUT touching string literals
 * (so a `/*`-looking glob like `src/**` inside a quoted string is never mistaken for a comment).
 * A simple char scanner with single/double/backtick string state — correct where a naive regex
 * `.replace(/\/\*[\s\S]*?\*\//)` is not (it would eat real code between two in-string `/*`…`*\/`).
 */
function stripComments(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === '/' && d === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
    } else if (c === '"' || c === "'") {
      // Single/double-quoted string: copied VERBATIM (the real `id: 'INV-NN'` value lives in here).
      out += c
      i++
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '')
          i += 2
        } else {
          out += src[i]
          i++
        }
      }
      out += src[i] ?? ''
      i++
    } else if (c === '`') {
      // Template literal: BLANK the interior (keep newlines) so a column-0 `id:` line embedded in a
      // multiline template/example string cannot be mistaken for a real catalog entry (anti-fake-green).
      out += c
      i++
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') {
          out += '  '
          i += 2
        } else {
          out += src[i] === '\n' ? '\n' : ' '
          i++
        }
      }
      out += src[i] ?? ''
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

/** Invariant ids from src/invariants/catalog.ts — anchored to the structural `id:` field (NOT comments). */
function invariantIds() {
  const ids = new Set()
  const p = resolve(CWD, 'src/invariants/catalog.ts')
  if (!existsSync(p)) return ids
  let text
  try {
    text = readFileSync(p, 'utf-8')
  } catch {
    return ids
  }
  // Strip comments (string-aware) first, so an INV id that exists ONLY in a `/* … */` or `// …`
  // comment (e.g. a removed/reserved entry) is NOT treated as a real invariant (anti-fake-green).
  const code = stripComments(text)
  // Line-anchored (optional leading `{` for inline object literals): `id:` must open the
  // whitespace/brace-trimmed line, so an id buried mid-line in a string is not falsely resolved.
  for (const m of code.matchAll(/^\s*\{?\s*id:\s*['"](INV-\d+)['"]/gm)) ids.add(m[1])
  return ids
}

/**
 * Parse a markdown file's leading `--- ... ---` YAML frontmatter. Tolerant of a leading UTF-8 BOM,
 * leading blank lines, and CRLF — so none of those can drop the fail-closed path.
 * @returns {{ ok: true, data: object, region: string } | { ok: false, hasFrontmatter: boolean, region: string }}
 *   ok=false + hasFrontmatter=true ⇒ a `---` block is present but could not be parsed (must not be
 *   silently trusted); hasFrontmatter=false ⇒ no leading frontmatter at all (legitimately skipped).
 *   `region` is the raw frontmatter text (so a declaration check is scoped to it, never the body).
 */
function extractFrontmatter(raw) {
  // Strip a leading BOM + normalize CRLF + drop leading blank lines BEFORE fence detection, so a
  // BOM-prepending editor or a stray leading newline can never make a real frontmatter look absent.
  const text = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/^\n+/, '')
  if (!text.startsWith('---')) return { ok: false, hasFrontmatter: false, region: '' }
  const end = text.indexOf('\n---', 3)
  const region = end < 0 ? text.slice(3) : text.slice(3, end)
  if (end < 0) return { ok: false, hasFrontmatter: true, region }
  try {
    const doc = parseYaml(region)
    if (doc && typeof doc === 'object') return { ok: true, data: doc, region }
    return { ok: false, hasFrontmatter: true, region }
  } catch {
    return { ok: false, hasFrontmatter: true, region }
  }
}

/** True if the frontmatter region declares an `enforces:` key (scoped to the FM, never the body). */
function declaresEnforces(region) {
  return /^enforces\s*:/m.test(region)
}

function main() {
  const adrDir = resolve(CWD, 'docs/internal/ADR')
  if (!existsSync(adrDir)) {
    process.stdout.write('check-adr-enforcement: no docs/internal/ADR — vacuous pass\n')
    return 0
  }
  const golds = goldCheckIds()
  const invs = invariantIds()
  const dangling = []
  const unclaimed = []
  let totalRefs = 0
  let files
  try {
    files = readdirSync(adrDir).sort()
  } catch {
    files = []
  }
  for (const f of files) {
    if (!f.endsWith('.md')) continue
    let raw
    try {
      raw = readFileSync(join(adrDir, f), 'utf-8')
    } catch {
      continue
    }
    const fm = extractFrontmatter(raw)
    if (!fm.ok) {
      // Unparseable frontmatter is only a violation if it claims enforcement — an unverifiable
      // `enforces:` hidden behind broken YAML must FAIL, never silently pass (fail-closed).
      if (fm.hasFrontmatter && declaresEnforces(fm.region)) {
        dangling.push({
          adr: f,
          target: '(frontmatter)',
          reason: 'declares enforces but frontmatter is unparseable',
        })
      }
      continue
    }
    const declared = fm.data.enforces
    if (declared === undefined || declared === null) {
      if (NUMBERED_ADR.test(f)) unclaimed.push(f)
      continue // absent / empty ⇒ none declared
    }
    const list = (Array.isArray(declared) ? declared : [declared])
      .map((raw2) => (typeof raw2 === 'string' ? raw2.trim() : String(raw2)))
      .filter((s) => s !== '')
    for (const target of list) {
      totalRefs++
      // INV-* ⇒ invariant; every other ref ⇒ a gold-check id (any registry prefix: GA/GO/TS/…).
      if (/^INV-\d+$/.test(target)) {
        if (!invs.has(target)) dangling.push({ adr: f, target, reason: 'no such invariant id' })
      } else if (!golds.has(target)) {
        dangling.push({ adr: f, target, reason: 'no such gold-check id' })
      }
    }
  }
  if (dangling.length > 0) {
    process.stderr.write(
      `check-adr-enforcement: FAIL — ${dangling.length} unverifiable enforces ref(s):\n`,
    )
    for (const d of dangling) process.stderr.write(`    ${d.adr}: ${d.target} — ${d.reason}\n`)
    return 1
  }

  const ratchet = checkRatchet(unclaimed, process.argv.includes('--update-baseline'))
  if (ratchet.code !== 0) return ratchet.code
  process.stdout.write(
    `check-adr-enforcement: OK — ${totalRefs} enforces ref(s) all resolve; ` +
      `${unclaimed.length} ADR(s) declare none (baseline ${ratchet.allowed})\n`,
  )
  return 0
}

/**
 * The coverage ratchet. A fall is free and needs no ceremony; a rise means a decision shipped
 * without naming what keeps it true, and is refused. Deliberately no --allow-increase: raising the
 * number means hand-editing the baseline in the same PR as the ADR that needs it, where the new
 * number lands in the diff beside its justification.
 * @returns {{ code: number, allowed?: number }}
 */
function checkRatchet(unclaimed, updateBaseline) {
  const path = resolve(CWD, BASELINE_REL)
  if (!existsSync(path)) {
    process.stderr.write(`check-adr-enforcement: ERROR — ${BASELINE_REL} not found\n`)
    return { code: 1 }
  }
  let baseline
  try {
    baseline = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    process.stderr.write(`check-adr-enforcement: ERROR — ${BASELINE_REL}: ${err?.message ?? err}\n`)
    return { code: 1 }
  }
  const allowed = baseline.unclaimed
  if (typeof allowed !== 'number') {
    process.stderr.write(
      `check-adr-enforcement: ERROR — ${BASELINE_REL} has no numeric "unclaimed"\n`,
    )
    return { code: 1 }
  }
  if (updateBaseline) {
    if (unclaimed.length > allowed) {
      process.stderr.write(
        `check-adr-enforcement: refusing --update-baseline — unclaimed rose ${allowed} → ` +
          `${unclaimed.length}. Declare the new ADR's enforcement, or raise the number by hand.\n`,
      )
      return { code: 1 }
    }
    writeFileSync(
      path,
      `${JSON.stringify({ ...baseline, unclaimed: unclaimed.length }, null, 2)}\n`,
    )
    process.stdout.write(
      `check-adr-enforcement: baseline updated — unclaimed ${unclaimed.length}\n`,
    )
    return { code: 0, allowed: unclaimed.length }
  }
  if (unclaimed.length > allowed) {
    process.stderr.write(
      `check-adr-enforcement: FAIL — ${unclaimed.length} ADR(s) declare no enforcement, ` +
        `baseline allows ${allowed}. A decision that names nothing keeping it true cannot be\n` +
        `    distinguished later from one that was never enforced. Add an enforces: [<check-id>|INV-nn]\n` +
        `    key to the new ADR's frontmatter. Highest-numbered unclaimed (a new ADR sorts last):\n`,
    )
    for (const f of unclaimed.slice(-5)) process.stderr.write(`    ${f}\n`)
    return { code: 1 }
  }
  return { code: 0, allowed }
}

try {
  process.exit(main())
} catch (err) {
  // Fail-closed (INV-96): any unexpected error is a hard gate failure, never a silent pass.
  process.stderr.write(`check-adr-enforcement: unexpected error — ${err?.message ?? err}\n`)
  process.exit(1)
}
