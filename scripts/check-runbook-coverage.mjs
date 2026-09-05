#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: validates every runbook (a doc whose frontmatter `tags` include kind/runbook) — it
// CATALOG: carries an RB-NN canonical_id and a non-empty `handles:` list whose invariant ids all
// CATALOG: resolve in the catalog — and ratchets the other direction: operational-tier invariants
// CATALOG: no runbook handles may fall in number and never rise.
// CATALOG: rejected fold-in into check-doc-style.mjs because that gate proves the frontmatter
// CATALOG: SHAPE every hand-authored doc shares (title, status, last_review); this one reads a
// CATALOG: kind-specific field and resolves its references against a different SSOT. A doc can
// CATALOG: have perfect frontmatter and handle an invariant that does not exist.
// CATALOG: rejected fold-in into check-inv-enforcement-wired.mjs because that gate proves an
// CATALOG: invariant's ENFORCEMENT script is wired; a runbook is what a human does when the
// CATALOG: enforcement has already fired and the thing is broken. Different direction, different
// CATALOG: artifact, and 10 of the 49 operational invariants have no script at all.
//
// scripts/check-runbook-coverage.mjs
// L1 gate (RB-NN, #2480 wave 8): a runbook names what it handles, and what it names is real.
//
// Two directions, deliberately asymmetric, because only one of them is honestly a pass/fail today.
//
// HARD — every runbook must:
//   1. carry `canonical_id` matching ^RB-[0-9]{2}$, unique across the set. The id is reused from
//      the frontmatter contract every doc already has rather than inventing a key (CANON-16),
//   2. declare a non-empty `handles: [INV-NN, ...]`. A runbook that handles nothing is a document
//      about a topic, not an operational response to a named failure,
//   3. name only invariants that EXIST in src/invariants/catalog.ts. An unresolvable reference is
//      the runbook equivalent of a dangling test_ref: it reads as coverage and covers nothing.
//   `handles` accepts ANY tier. The one runbook that predates this gate handles INV-74 and INV-76,
//   both `security`, and a rule that failed it would be a rule fitted to a theory rather than to
//   the repository.
//
// RATCHET — the other direction, operational-tier invariants no runbook handles. This is a DEBT
// COUNTER, not a rule, and saying so is the point. There are 49 operational invariants and two
// runbooks; shipping "every operational invariant needs a runbook" as a hard rule would be red on
// arrival and instantly baselined into meaninglessness, which is the green-because-baselined
// failure this programme exists to prevent. As a ratchet it is honest: the number may fall freely
// and may never rise, so the debt is visible, bounded, and cannot grow in silence.
//
// Discovery reads frontmatter, never greps. `docs/GOVERNANCE.md` and `docs/INDEX.md` both contain
// the literal string `kind/runbook` while merely listing tags, and a grep would have made both of
// them runbooks that handle nothing — the gate's first finding would have been its own false
// positive.
//
// Usage: node scripts/check-runbook-coverage.mjs [--dir <repo>] [--json] [--update-baseline]
// Exit: 0 pass or skip, 1 violation, 2 error (INV-53).
//
// Exports for unit tests: parseFrontmatter, isRunbook, parseHandles, collectRunbooks,
//                         runbookViolations, operationalInvariants, uncoveredOperational

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { walkRepo } from './lib/glob-walk.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

const DOCS_REL = 'docs'
const CATALOG_REL = join('src', 'invariants', 'catalog.ts')
const BASELINE_REL = join('scripts', 'data', 'runbook-baseline.json')
const RUNBOOK_TAG = 'kind/runbook'
const RB_ID = /^RB-[0-9]{2}$/

/**
 * Frontmatter as `key -> raw value`. Deliberately not a YAML engine, and deliberately the same
 * shape check-doc-style.mjs reads: a runbook header a 15-line parser cannot read is a header the
 * next operator cannot read at 3am either.
 * @returns {Map<string, string> | null}
 */
export function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return null
  const lines = text.split('\n')
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] !== '---') continue
    const kv = new Map()
    for (const line of lines.slice(1, i)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line)
      // Unquote, as check-doc-style.mjs does: `canonical_id: ''` must read as empty, not as the
      // two-character string "''", or the gate reports a nonsense id back at the author.
      if (m) kv.set(m[1], m[2].trim().replace(/^['"]|['"]$/g, ''))
    }
    return kv
  }
  return null
}

/** Is this doc a runbook? By its DECLARED tags, never by the body containing the word. */
export function isRunbook(kv) {
  const tags = kv?.get('tags')
  if (typeof tags !== 'string') return false
  return tags
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
    .includes(RUNBOOK_TAG)
}

/** The invariant ids in a `handles:` value, in declaration order. */
export function parseHandles(raw) {
  if (typeof raw !== 'string') return []
  return [...raw.matchAll(/INV-[0-9]{2,3}/g)].map((m) => m[0])
}

/**
 * Every runbook in the tree, as `{ file, id, handles }`.
 * @returns {Array<{file: string, id: string, handles: string[]}>}
 */
export function collectRunbooks(root) {
  const docsRoot = join(root, DOCS_REL)
  if (!existsSync(docsRoot)) return []
  const found = []
  for (const rel of walkRepo(docsRoot)) {
    if (!rel.endsWith('.md')) continue
    let kv
    try {
      kv = parseFrontmatter(readFileSync(join(docsRoot, rel), 'utf-8'))
      // FAIL-OPEN-INTENT: an unreadable doc is check-doc-style's finding, not this gate's; reporting it twice buries the one error that explains the tree.
    } catch {
      continue
    }
    if (!isRunbook(kv)) continue
    found.push({
      file: `${DOCS_REL}/${rel}`,
      id: kv.get('canonical_id') ?? '',
      handles: parseHandles(kv.get('handles')),
    })
  }
  return found.sort((a, b) => a.file.localeCompare(b.file))
}

/** Every `tier: 'operational'` invariant id in the catalog, in declaration order. */
export function operationalInvariants(catalogText) {
  const ids = []
  for (const block of catalogText.split(/\n {2}\{\n/).slice(1)) {
    if (!/tier: 'operational'/.test(block)) continue
    const m = /id: '(INV-[0-9]{2,3})'/.exec(block)
    if (m) ids.push(m[1])
  }
  return ids
}

/** Operational invariants no runbook claims. The ratchet's subject. */
export function uncoveredOperational(runbooks, operational) {
  const handled = new Set(runbooks.flatMap((r) => r.handles))
  return operational.filter((id) => !handled.has(id))
}

/** The three hard rules. */
export function runbookViolations(runbooks, knownInvariants) {
  const out = []
  const seen = new Map()
  for (const rb of runbooks) {
    if (!RB_ID.test(rb.id)) {
      out.push(
        `${rb.file}: canonical_id is ${rb.id === '' ? 'empty' : `"${rb.id}"`}, expected an RB-NN id — ` +
          'a runbook nothing can cite is a runbook nothing can be traced to',
      )
    } else if (seen.has(rb.id)) {
      out.push(`${rb.file}: canonical_id ${rb.id} is already used by ${seen.get(rb.id)}`)
    } else {
      seen.set(rb.id, rb.file)
    }
    if (rb.handles.length === 0) {
      out.push(
        `${rb.file}: declares no \`handles:\` — a runbook that handles nothing named is a document ` +
          'about a topic, not an operational response to a failure',
      )
      continue
    }
    for (const inv of rb.handles) {
      if (knownInvariants.has(inv)) continue
      out.push(`${rb.file}: handles "${inv}", which is not in ${CATALOG_REL}`)
    }
  }
  return out
}

/** The ratchet file, or an exit code describing why it could not be read. */
function loadBaseline(path) {
  if (!existsSync(path)) {
    process.stderr.write(`check-runbook-coverage: ERROR — ${BASELINE_REL} not found\n`)
    return { code: 2 }
  }
  try {
    return { baseline: JSON.parse(readFileSync(path, 'utf-8')) }
  } catch (err) {
    process.stderr.write(`check-runbook-coverage: ERROR — ${BASELINE_REL}: ${err.message}\n`)
    return { code: 2 }
  }
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const i = argv.indexOf('--dir')
  return {
    root: i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : process.cwd(),
    json: argv.includes('--json'),
    update: argv.includes('--update-baseline'),
  }
}

function report(json, verdict, message, violations) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ verdict, message, violations }, null, 2)}\n`)
    return
  }
  if (verdict === 'skip') {
    process.stdout.write(`[SKIP] check-runbook-coverage: ${message}\n`)
    return
  }
  for (const v of violations) process.stderr.write(`check-runbook-coverage: FAIL — ${v}\n`)
  if (verdict === 'pass') process.stdout.write(`check-runbook-coverage: PASS — ${message}\n`)
}

function main(argv) {
  const { root, json, update } = parseArgs(argv)

  const catalogPath = join(root, CATALOG_REL)
  if (!existsSync(catalogPath)) {
    report(json, 'skip', `${CATALOG_REL} absent — no invariant catalog to resolve against`, [])
    return 0
  }
  const catalogText = readFileSync(catalogPath, 'utf-8')
  const known = new Set([...catalogText.matchAll(/id: '(INV-[0-9]{2,3})'/g)].map((m) => m[1]))
  const operational = operationalInvariants(catalogText)

  const runbooks = collectRunbooks(root)
  const violations = runbookViolations(runbooks, known)
  const uncovered = uncoveredOperational(runbooks, operational)

  const baselinePath = join(root, BASELINE_REL)
  if (update) {
    // Unlike the ADR ratchet this DOES record a rise, because the subject is a debt counter over a
    // catalog this gate does not own: adding an operational invariant legitimately raises it, and
    // refusing that would make INV-08 (new invariants are welcome) fight this gate. What the
    // ratchet still refuses is a SILENT rise — the new number lands in the diff either way.
    mkdirSync(dirname(baselinePath), { recursive: true })
    const existing = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf-8')) : {}
    writeFileSync(
      baselinePath,
      `${JSON.stringify({ ...existing, uncoveredOperational: uncovered.length }, null, 2)}\n`,
    )
    process.stdout.write(
      `check-runbook-coverage: baseline updated — uncoveredOperational ${uncovered.length}\n`,
    )
    return 0
  }

  const loaded = loadBaseline(baselinePath)
  if (loaded.code !== undefined) return loaded.code
  const allowed = loaded.baseline.uncoveredOperational
  if (typeof allowed !== 'number') {
    process.stderr.write(
      `check-runbook-coverage: ERROR — ${BASELINE_REL} has no numeric "uncoveredOperational"\n`,
    )
    return 2
  }
  if (uncovered.length > allowed) {
    violations.push(
      `uncovered operational invariants rose to ${uncovered.length}, baseline allows ${allowed} — ` +
        `newly uncovered: ${uncovered.slice(0, 6).join(', ')}${uncovered.length > 6 ? ', …' : ''}. ` +
        'Write the runbook, or record the rise by hand in the same diff.',
    )
  }

  if (violations.length > 0) {
    report(json, 'fail', 'violations', violations)
    return 1
  }
  report(
    json,
    'pass',
    `${runbooks.length} runbook(s), every handles: ref resolves; ` +
      `${uncovered.length}/${operational.length} operational invariants uncovered (baseline ${allowed})`,
    [],
  )
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    // Exit 2, not 1 (INV-53): 1 means a runbook is wrong, 2 means the gate could not tell.
    process.stderr.write(`check-runbook-coverage: ERROR — ${err?.stack ?? err}\n`)
    process.exit(2)
  }
}
