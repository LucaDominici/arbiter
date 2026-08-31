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
// #2419 AC-1 — the `enforces:` key is MANDATORY, not opt-in. Validating only the ADRs that chose
// to declare (3 of 120) meant the gate could never fail: the 111 accepted/active ADRs claiming
// nothing were never asked to. Every NUMBERED ADR (`NNN-*.md`, the same predicate
// check-adr-index.mjs uses for "a real ADR") with status accepted/active must declare a non-empty
// `enforces:` — or carry a DATED entry in scripts/data/adr-enforces-allowlist.json. The amnesty
// expires (dated-debt discipline, INV-31) and cannot rot: an entry whose ADR now declares
// `enforces:`, or names no ADR at all, FAILS as prunable, so the allowlist only ever shrinks.
//
// Exit: 0 = every ref resolves and every accepted/active ADR is covered; 1 = at least one
// dangling/unverifiable ref, uncovered ADR, or expired/stale allowlist entry.
//
// CATALOG: rejected fold-in into scripts/check-adr-index.mjs because that gate validates ADR
// CATALOG:   structure (canonical_id / index parity), not the cross-artifact enforces↔check/INV
// CATALOG:   linkage — a different concern with its own registry + catalog reads.
// CATALOG: rejected fold-in into scripts/lib/gold-audit-lib.mjs because that is the pure scored-
// CATALOG:   payload evaluator; an ADR-frontmatter traceability gate is presentation/governance.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

const CWD = process.cwd()

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

/** The "this is a real ADR" predicate — byte-identical to scripts/check-adr-index.mjs (#2419). */
const NUMBERED_ADR_RE = /^\d{3}-.+\.md$/
/** Statuses that owe an `enforces:` declaration (#2419 AC-1). */
const MANDATORY_STATUSES = new Set(['accepted', 'active'])
const ALLOWLIST_REL = 'scripts/data/adr-enforces-allowlist.json'

/** The declared `enforces:` value normalized to a list of non-empty ref strings. */
function enforcesList(declared) {
  if (declared === undefined || declared === null) return []
  return (Array.isArray(declared) ? declared : [declared])
    .map((raw) => (typeof raw === 'string' ? raw.trim() : String(raw)))
    .filter((s) => s !== '')
}

/**
 * Load the dated amnesty list. `error` is non-null when the file EXISTS but cannot be read or has
 * no `entries` array — surfaced as its own FAIL line so the operator sees the cause instead of N
 * derived "missing enforces" lines (fail-closed: an unreadable allowlist grants nothing).
 * @returns {{ entries: Record<string, unknown>[], error: string | null }}
 */
function loadAllowlist() {
  const p = resolve(CWD, ALLOWLIST_REL)
  if (!existsSync(p)) return { entries: [], error: null }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(p, 'utf-8'))
    // FAIL-OPEN-INTENT: the parse error becomes an `error` string the caller reports as a FAIL — fail-closed, never a silent pass.
  } catch (err) {
    return { entries: [], error: `${ALLOWLIST_REL} unreadable/malformed — ${err?.message ?? err}` }
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    return { entries: [], error: `${ALLOWLIST_REL} malformed — no \`entries\` array` }
  }
  return { entries: parsed.entries, error: null }
}

/**
 * Validate one allowlist entry against the scanned ADR state. Returns the covered ADR filename, or
 * a violation message when the entry is stale (no such ADR / status owes nothing / the ADR now
 * declares `enforces:`), undated, expired, or unjustified. The stale rules are what keep the list
 * shrinking instead of accumulating permanent amnesty.
 * @returns {{ adr: string, violation: string | null }}
 */
function validateAllowlistEntry(entry, adrState, now) {
  const adr = typeof entry?.adr === 'string' ? entry.adr.trim() : ''
  if (adr === '') return { adr, violation: 'allowlist entry has no `adr` filename' }
  const state = adrState.get(adr)
  if (state === undefined)
    return { adr, violation: `${adr}: stale allowlist entry — no such ADR file (prune it)` }
  if (!state.mandatory)
    return {
      adr,
      violation: `${adr}: stale allowlist entry — status "${state.status}" owes no enforces (prune it)`,
    }
  if (state.declares)
    return {
      adr,
      violation: `${adr}: stale allowlist entry — the ADR now declares enforces (prune it)`,
    }
  const rationale = typeof entry.rationale === 'string' ? entry.rationale.trim() : ''
  if (rationale === '') return { adr, violation: `${adr}: allowlist entry has no rationale` }
  const expires = typeof entry.expires === 'string' ? entry.expires : ''
  const at = Date.parse(expires)
  if (expires === '' || Number.isNaN(at))
    return { adr, violation: `${adr}: allowlist entry has no valid \`expires\` date` }
  if (at < now)
    return {
      adr,
      violation: `${adr}: allowlist amnesty expired ${expires} — declare enforces or re-date it`,
    }
  return { adr, violation: null }
}

/**
 * One pass over the ADR directory: resolves every declared `enforces:` ref AND records, per
 * numbered ADR, whether it owes a declaration and whether it makes one.
 * @returns {{ dangling: object[], totalRefs: number, adrState: Map<string, object> }}
 */
function scanAdrs(adrDir, golds, invs) {
  const dangling = []
  const adrState = new Map()
  let totalRefs = 0
  let files
  try {
    files = readdirSync(adrDir).sort()
    // FAIL-OPEN-INTENT: an unreadable ADR directory yields no files, so the vacuous-pass branch in main() reports it; there is nothing to verify, not a suppressed violation.
  } catch {
    files = []
  }
  for (const f of files) {
    if (!f.endsWith('.md')) continue
    const numbered = NUMBERED_ADR_RE.test(f)
    let raw
    try {
      raw = readFileSync(join(adrDir, f), 'utf-8')
      // FAIL-OPEN-INTENT: an unreadable ADR file is recorded as `unverifiable` below for numbered ADRs, which main() reports as a FAIL — fail-closed.
    } catch {
      if (numbered)
        adrState.set(f, { status: null, mandatory: true, declares: false, unverifiable: true })
      continue
    }
    const fm = extractFrontmatter(raw)
    if (!fm.ok) {
      // Unparseable frontmatter is a violation when it claims enforcement — an unverifiable
      // `enforces:` hidden behind broken YAML must FAIL, never silently pass (fail-closed).
      if (fm.hasFrontmatter && declaresEnforces(fm.region)) {
        dangling.push({
          adr: f,
          target: '(frontmatter)',
          reason: 'declares enforces but frontmatter is unparseable',
        })
      }
      // #2419: for a numbered ADR the STATUS is also unreadable, so the mandatory-enforces
      // contract cannot be checked at all. Recorded unverifiable ⇒ FAIL, never skipped.
      if (numbered)
        adrState.set(f, { status: null, mandatory: true, declares: false, unverifiable: true })
      continue
    }
    const list = enforcesList(fm.data.enforces)
    if (numbered) {
      const status = typeof fm.data.status === 'string' ? fm.data.status.trim().toLowerCase() : ''
      adrState.set(f, {
        status,
        mandatory: MANDATORY_STATUSES.has(status),
        declares: list.length > 0,
        unverifiable: false,
      })
    }
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
  return { dangling, totalRefs, adrState }
}

/**
 * #2419 AC-1 — every accepted/active numbered ADR must declare `enforces:` or hold a live dated
 * allowlist entry. Returns the violation messages plus the count of ADRs currently under amnesty.
 * @returns {{ violations: string[], covered: number }}
 */
function auditMandatoryEnforces(adrState, now) {
  const { entries, error } = loadAllowlist()
  const violations = error === null ? [] : [error]
  const allowed = new Set()
  for (const entry of entries) {
    const { adr, violation } = validateAllowlistEntry(entry, adrState, now)
    if (violation === null) allowed.add(adr)
    else violations.push(violation)
  }
  for (const [file, st] of adrState) {
    if (st.unverifiable) {
      violations.push(
        `${file}: frontmatter unparseable — status unverifiable, the enforces contract cannot be checked`,
      )
      continue
    }
    if (!st.mandatory || st.declares || allowed.has(file)) continue
    violations.push(
      `${file}: status "${st.status}" requires a non-empty \`enforces:\` (or a dated ${ALLOWLIST_REL} entry)`,
    )
  }
  return { violations, covered: allowed.size }
}

function main() {
  const adrDir = resolve(CWD, 'docs/internal/ADR')
  if (!existsSync(adrDir)) {
    process.stdout.write('check-adr-enforcement: no docs/internal/ADR — vacuous pass\n')
    return 0
  }
  const { dangling, totalRefs, adrState } = scanAdrs(adrDir, goldCheckIds(), invariantIds())
  const { violations, covered } = auditMandatoryEnforces(adrState, Date.now())
  if (dangling.length > 0) {
    process.stderr.write(
      `check-adr-enforcement: FAIL — ${dangling.length} unverifiable enforces ref(s):\n`,
    )
    for (const d of dangling) process.stderr.write(`    ${d.adr}: ${d.target} — ${d.reason}\n`)
  }
  if (violations.length > 0) {
    process.stderr.write(
      `check-adr-enforcement: FAIL — ${violations.length} mandatory-enforces violation(s) (#2419):\n`,
    )
    for (const v of violations) process.stderr.write(`    ${v}\n`)
  }
  if (dangling.length > 0 || violations.length > 0) return 1
  process.stdout.write(
    `check-adr-enforcement: OK — ${totalRefs} enforces ref(s) all resolve; ` +
      `${adrState.size} numbered ADR(s) checked, ${covered} under dated allowlist\n`,
  )
  return 0
}

try {
  process.exit(main())
} catch (err) {
  // Fail-closed (INV-96): any unexpected error is a hard gate failure, never a silent pass.
  process.stderr.write(`check-adr-enforcement: unexpected error — ${err?.message ?? err}\n`)
  process.exit(1)
}
