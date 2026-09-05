#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: validates docs/internal/PRODUCT/MILESTONES.yml — the milestone SSOT — against
// CATALOG: schemas/milestone.schema.json, then proves the properties a roadmap-as-code must hold
// CATALOG: for anything derived from it (forma's plan lens, the critical path) to be trustworthy:
// CATALOG: identifiers are unique, dependencies form a DAG, and a milestone cannot be called done
// CATALOG: without the evidence its own exit criteria demand.
// CATALOG: rejected fold-in into check-id-registry.mjs because that gate proves the MS *scheme* is
// CATALOG: registered and collision-free; this one reads the instances. A registry can be perfect
// CATALOG: while every milestone in it is a cycle.
// CATALOG: rejected fold-in into check-doc-set.mjs because doc-set gates a document's PRESENCE and
// CATALOG: freshness by mtime; a milestone set is a typed graph whose defects (a cycle, a dangling
// CATALOG: depends_on) are invisible to any presence check.
// CATALOG: EP-NN folds into THIS gate by design — an epic that targets no milestone is exactly the
// CATALOG: defect the shared reader exists to surface, so they must be read together (wave 8).
//
// scripts/check-milestones.mjs
// L1 gate: the milestone SSOT is well-formed, acyclic, and fail-closed on `done`.
//
// Asserts:
//   1. MILESTONES.yml parses as YAML and satisfies schemas/milestone.schema.json — which is where
//      the Now/Next/Later granularity decay lives (`due` required for now, forbidden for later),
//      enforceable only since #2509 taught the shared validator if/then/not,
//   2. no two milestones share an id, and no milestone repeats an exit-criterion id,
//   3. every `depends_on` names a milestone that exists in this file,
//   4. the dependency graph is acyclic — reported as the actual cycle, not merely "a cycle exists",
//   5. `status: done` or `verified` requires EVERY exit criterion to carry an `evidence_ref`.
//      This is the fail-closed rule: a milestone is not done because someone typed done,
//   6. `status: verified` additionally requires each `evidence_ref` to RESOLVE — a script or path
//      on disk, or an INV id present in the catalog. A `github:` ref is accepted unresolved
//      because this gate is offline by contract (INV-13: the CI runner may be unreachable).
//
// And over the epic index in the same file (EP-NN, wave 8):
//   7. epic ids are unique and no two epics claim the same issue,
//   8. the milestone join agrees IN BOTH DIRECTIONS — every `members.epics` entry names a declared
//      epic, and every epic's `targets` names a milestone that lists it back. A one-sided link is
//      how an epic detaches from the plan while both halves still read as plausible,
//   9. an issue is claimed once: a number may not appear both as an epic's `issue` and in some
//      milestone's `members.issues`,
//  10. a terminal epic status (`drained`, `abandoned`) requires an `evidence_ref` — the same
//      fail-closed rule the milestone statuses carry,
//  11. a milestone cannot be `done` or `verified` while an epic targeting it is still open.
//
// KNOWN LIMIT, stated rather than hidden: this gate cannot tell whether an epic's recorded status
// matches its GitHub issue, because it never reaches the network (INV-13). That gap is not
// theoretical — the first three epics recorded here were ALL closed (one completed, two
// not-planned) while the SSOT prose called them open, and no gate saw it. The detector for that
// class is the reconciliation pass on the consumer side, which reads a committed issues snapshot;
// it has never been run against arbiter's own file.
//
// A missing MILESTONES.yml is a SKIP, not a violation: a project need not have codified a roadmap.
// The skip prints its reason and is visible in --json as `verdict: "skip"`, so it cannot be
// mistaken for a pass by a reader or by runCheck's marker grep.
//
// Usage: node scripts/check-milestones.mjs [--dir <repo>] [--json] [--emit <path>]
//
// --emit writes the machine projection forma consumes (schema arbiter-milestones-v1). forma has
// ZERO dependencies by design and cannot parse YAML: the SSOT stays YAML because humans edit it,
// and arbiter emits the JSON. It is written ONLY after every rule has passed, so an invalid
// milestone set cannot produce a projection — a property a separate generator could not offer.
//
// Exit: 0 pass or skip, 1 violation, 2 error (INV-53).
//
// Exports for unit tests: findDuplicateIds, findDanglingDeps, findCycle, findDoneWithoutEvidence,
//                         findUnresolvedEvidence, evidenceResolves, collectViolations,
//                         annotateSchemaViolations, milestoneProjection, findDuplicateEpicIds,
//                         findEpicJoinViolations, findDoubleClaimedIssues,
//                         findTerminalEpicsWithoutEvidence, findDoneWithOpenEpics

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { loadSchema, validateSchema } from './lib/agent-return-validate.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const MILESTONES_REL = join('docs', 'internal', 'PRODUCT', 'MILESTONES.yml')
const SCHEMA_REL = join('schemas', 'milestone.schema.json')
const CATALOG_REL = join('src', 'invariants', 'catalog.ts')

/** Statuses that oblige every exit criterion to carry evidence. */
const EVIDENCE_REQUIRED = new Set(['done', 'verified'])

/**
 * Duplicate milestone ids. The schema cannot see this: it validates each item alone.
 * @param {Array<Record<string, unknown>>} milestones
 * @returns {string[]}
 */
export function findDuplicateIds(milestones) {
  const seen = new Set()
  const violations = []
  for (const m of milestones) {
    const id = String(m['id'])
    if (seen.has(id)) violations.push(`duplicate milestone id "${id}"`)
    seen.add(id)
  }
  for (const m of milestones) {
    const criteria = Array.isArray(m['exit_criteria']) ? m['exit_criteria'] : []
    const ecSeen = new Set()
    for (const ec of criteria) {
      const ecId = String(/** @type {Record<string, unknown>} */ (ec)['id'])
      if (ecSeen.has(ecId)) {
        violations.push(`milestone ${String(m['id'])}: duplicate exit-criterion id "${ecId}"`)
      }
      ecSeen.add(ecId)
    }
  }
  return violations
}

/**
 * `depends_on` entries naming a milestone that is not in this file.
 * @param {Array<Record<string, unknown>>} milestones
 * @returns {string[]}
 */
export function findDanglingDeps(milestones) {
  const known = new Set(milestones.map((m) => String(m['id'])))
  const violations = []
  for (const m of milestones) {
    const deps = Array.isArray(m['depends_on']) ? m['depends_on'] : []
    for (const dep of deps) {
      if (!known.has(String(dep))) {
        violations.push(`milestone ${String(m['id'])}: depends_on "${String(dep)}" does not exist`)
      }
    }
  }
  return violations
}

/**
 * First dependency cycle, as the path that closes it. Reporting the path rather than a bare
 * "cycle detected" is the difference between a usable error and a puzzle.
 * @param {Array<Record<string, unknown>>} milestones
 * @returns {string[]}
 */
export function findCycle(milestones) {
  const edges = new Map(
    milestones.map((m) => [
      String(m['id']),
      (Array.isArray(m['depends_on']) ? m['depends_on'] : []).map(String),
    ]),
  )
  const state = new Map() // id -> 'open' | 'done'
  /** @type {string[]} */
  const stack = []

  /** @param {string} id @returns {string[] | null} */
  function visit(id) {
    if (state.get(id) === 'done') return null
    if (state.get(id) === 'open') {
      const from = stack.indexOf(id)
      return [...stack.slice(from), id]
    }
    state.set(id, 'open')
    stack.push(id)
    for (const dep of edges.get(id) ?? []) {
      if (!edges.has(dep)) continue // dangling: reported separately, not a cycle
      const cycle = visit(dep)
      if (cycle) return cycle
    }
    stack.pop()
    state.set(id, 'done')
    return null
  }

  for (const id of edges.keys()) {
    const cycle = visit(id)
    if (cycle) return [`dependency cycle: ${cycle.join(' -> ')}`]
  }
  return []
}

/**
 * The fail-closed rule. `done` without evidence is the single defect this gate exists to stop.
 * @param {Array<Record<string, unknown>>} milestones
 * @returns {string[]}
 */
export function findDoneWithoutEvidence(milestones) {
  const violations = []
  for (const m of milestones) {
    if (!EVIDENCE_REQUIRED.has(String(m['status']))) continue
    const criteria = Array.isArray(m['exit_criteria']) ? m['exit_criteria'] : []
    for (const ec of criteria) {
      const rec = /** @type {Record<string, unknown>} */ (ec)
      if (typeof rec['evidence_ref'] !== 'string' || rec['evidence_ref'].trim() === '') {
        violations.push(
          `milestone ${String(m['id'])} is "${String(m['status'])}" but exit criterion ` +
            `${String(rec['id'])} carries no evidence_ref — status is not evidence`,
        )
      }
    }
  }
  return violations
}

/**
 * Does an evidence_ref point at something real? A `github:` ref is accepted unresolved: this
 * gate is offline by contract, and reaching for the network would make it fail when CI is down
 * rather than when the evidence is missing.
 * @param {string} ref
 * @param {string} root
 * @returns {boolean}
 */
export function evidenceResolves(ref, root) {
  if (ref.startsWith('github:')) return true
  if (/^INV-[0-9]+$/.test(ref)) {
    const catalog = join(root, CATALOG_REL)
    if (!existsSync(catalog)) return false
    return readFileSync(catalog, 'utf-8').includes(`'${ref}'`)
  }
  return existsSync(join(root, ref))
}

/**
 * `verified` demands its refs actually resolve — the step beyond `done` that turns a recorded
 * claim into a checked one.
 * @param {Array<Record<string, unknown>>} milestones
 * @param {string} root
 * @returns {string[]}
 */
export function findUnresolvedEvidence(milestones, root) {
  const violations = []
  for (const m of milestones) {
    if (String(m['status']) !== 'verified') continue
    const criteria = Array.isArray(m['exit_criteria']) ? m['exit_criteria'] : []
    for (const ec of criteria) {
      const rec = /** @type {Record<string, unknown>} */ (ec)
      const ref = rec['evidence_ref']
      if (typeof ref !== 'string' || evidenceResolves(ref, root)) continue
      violations.push(
        `milestone ${String(m['id'])} is "verified" but exit criterion ${String(rec['id'])} ` +
          `cites evidence_ref "${ref}", which does not resolve`,
      )
    }
  }
  return violations
}

/** Statuses that end an epic's life, in either direction. */
const EPIC_TERMINAL = new Set(['drained', 'abandoned'])

/** `members.epics` of one milestone, as strings. @param {Record<string, unknown>} m */
function claimedEpics(m) {
  const members = /** @type {Record<string, unknown>} */ (m['members'])
  const epics = members && typeof members === 'object' ? members['epics'] : null
  return Array.isArray(epics) ? epics.map(String) : []
}

/** `members.issues` of one milestone, as numbers. @param {Record<string, unknown>} m */
function claimedIssues(m) {
  const members = /** @type {Record<string, unknown>} */ (m['members'])
  const issues = members && typeof members === 'object' ? members['issues'] : null
  return Array.isArray(issues) ? issues.map(Number) : []
}

/**
 * Two epics with one id, or two epics claiming one issue. The schema validates each item alone
 * and can see neither.
 * @param {Array<Record<string, unknown>>} epics
 * @returns {string[]}
 */
export function findDuplicateEpicIds(epics) {
  const seenIds = new Set()
  const issueOwner = new Map()
  const violations = []
  for (const e of epics) {
    const id = String(e['id'])
    if (seenIds.has(id)) violations.push(`duplicate epic id "${id}"`)
    seenIds.add(id)
    const issue = Number(e['issue'])
    const owner = issueOwner.get(issue)
    if (owner !== undefined) {
      violations.push(`epics ${owner} and ${id} both claim issue #${issue}`)
    } else {
      issueOwner.set(issue, id)
    }
  }
  return violations
}

/**
 * The join, both ways. A dangling `members.epics` entry and an epic whose milestone does not list
 * it back are the same detachment seen from opposite ends, and each is invisible from its own end.
 * @param {Array<Record<string, unknown>>} milestones
 * @param {Array<Record<string, unknown>>} epics
 * @returns {string[]}
 */
export function findEpicJoinViolations(milestones, epics) {
  const knownEpics = new Set(epics.map((e) => String(e['id'])))
  const knownMilestones = new Set(milestones.map((m) => String(m['id'])))
  const violations = []

  for (const m of milestones) {
    for (const claim of claimedEpics(m)) {
      if (!knownEpics.has(claim)) {
        violations.push(
          `milestone ${String(m['id'])}: members.epics names "${claim}", which is not declared in this file`,
        )
      }
    }
  }

  for (const e of epics) {
    const id = String(e['id'])
    const target = String(e['targets'])
    if (!knownMilestones.has(target)) {
      violations.push(`epic ${id}: targets "${target}", which does not exist`)
      continue
    }
    const milestone = milestones.find((m) => String(m['id']) === target)
    if (milestone && !claimedEpics(milestone).includes(id)) {
      violations.push(
        `epic ${id} targets ${target}, but ${target} does not list ${id} in members.epics — the link is one-sided`,
      )
    }
  }
  return violations
}

/**
 * One issue, one claim. An issue carried as an epic AND as a plain member is counted twice by
 * anything that rolls the plan up, and there is no reading of the file that makes it right.
 * @param {Array<Record<string, unknown>>} milestones
 * @param {Array<Record<string, unknown>>} epics
 * @returns {string[]}
 */
export function findDoubleClaimedIssues(milestones, epics) {
  const epicIssues = new Map(epics.map((e) => [Number(e['issue']), String(e['id'])]))
  const violations = []
  for (const m of milestones) {
    for (const issue of claimedIssues(m)) {
      const owner = epicIssues.get(issue)
      if (owner === undefined) continue
      violations.push(
        `milestone ${String(m['id'])}: members.issues carries #${issue}, which is already epic ${owner} — an issue is claimed once`,
      )
    }
  }
  return violations
}

/**
 * Fail-closed on the epic ladder: an epic is not finished because someone typed finished. Applies
 * to `abandoned` as much as to `drained` — dropping work is a decision, and a decision with no
 * record is indistinguishable later from work that was quietly forgotten.
 * @param {Array<Record<string, unknown>>} epics
 * @returns {string[]}
 */
export function findTerminalEpicsWithoutEvidence(epics) {
  const violations = []
  for (const e of epics) {
    const status = String(e['status'])
    if (!EPIC_TERMINAL.has(status)) continue
    const ref = e['evidence_ref']
    if (typeof ref === 'string' && ref.trim() !== '') continue
    violations.push(
      `epic ${String(e['id'])} is "${status}" but carries no evidence_ref — status is not evidence`,
    )
  }
  return violations
}

/**
 * A milestone cannot be finished while work rolled up into it is open. This is the rule that makes
 * the epic index load-bearing rather than decorative: without it a milestone can be marked done
 * with every exit criterion evidenced and an open epic still pointing at it.
 * @param {Array<Record<string, unknown>>} milestones
 * @param {Array<Record<string, unknown>>} epics
 * @returns {string[]}
 */
export function findDoneWithOpenEpics(milestones, epics) {
  const violations = []
  for (const m of milestones) {
    if (!EVIDENCE_REQUIRED.has(String(m['status']))) continue
    const id = String(m['id'])
    for (const e of epics) {
      if (String(e['targets']) !== id) continue
      const status = String(e['status'])
      if (EPIC_TERMINAL.has(status)) continue
      violations.push(
        `milestone ${id} is "${String(m['status'])}" but epic ${String(e['id'])} targeting it is "${status}"`,
      )
    }
  }
  return violations
}

/**
 * Every structural rule, once the document is known schema-valid.
 * @param {Array<Record<string, unknown>>} milestones
 * @param {string} root
 * @param {Array<Record<string, unknown>>} [epics]
 * @returns {string[]}
 */
export function collectViolations(milestones, root, epics = []) {
  return [
    ...findDuplicateIds(milestones),
    ...findDanglingDeps(milestones),
    ...findCycle(milestones),
    ...findDoneWithoutEvidence(milestones),
    ...findUnresolvedEvidence(milestones, root),
    ...findDuplicateEpicIds(epics),
    ...findEpicJoinViolations(milestones, epics),
    ...findDoubleClaimedIssues(milestones, epics),
    ...findTerminalEpicsWithoutEvidence(epics),
    ...findDoneWithOpenEpics(milestones, epics),
  ]
}

/**
 * Rewrite `milestones.milestones[2]` as `MS-03` (and `milestones.epics[0]` as `EP-01`), and
 * translate the one schema rule whose native wording is opaque. A `not` violation reads "value
 * must NOT match the not schema, but does", which is true and useless; on this schema it can only
 * mean the granularity-decay rule.
 * @param {string[]} violations
 * @param {Array<Record<string, unknown>>} milestones
 * @param {Array<Record<string, unknown>>} [epics]
 * @returns {string[]}
 */
export function annotateSchemaViolations(violations, milestones, epics = []) {
  return violations.map((v) => {
    const named = v
      .replace(/^milestones\.milestones\[(\d+)\]/, (_match, index) => {
        const id = milestones[Number(index)]?.['id']
        return id ? `milestone ${String(id)}` : `milestone #${index}`
      })
      .replace(/^milestones\.epics\[(\d+)\]/, (_match, index) => {
        const id = epics[Number(index)]?.['id']
        return id ? `epic ${String(id)}` : `epic #${index}`
      })
    return named.includes('must NOT match the "not" schema')
      ? `${named.split(':')[0]}: a "later" milestone must not carry a "due" date (granularity decay)`
      : named
  })
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const dirIndex = argv.indexOf('--dir')
  const emitIndex = argv.indexOf('--emit')
  return {
    root: dirIndex >= 0 && argv[dirIndex + 1] ? resolve(argv[dirIndex + 1]) : process.cwd(),
    json: argv.includes('--json'),
    emit: emitIndex >= 0 && argv[emitIndex + 1] ? resolve(argv[emitIndex + 1]) : null,
  }
}

/**
 * The machine projection forma consumes. forma has ZERO dependencies by design and therefore
 * cannot parse YAML: the SSOT stays YAML because humans edit it, and arbiter emits the JSON. That
 * asymmetry is what "arbiter defines, forma derives" means in practice — forma reads arbiter's
 * machine output instead of reimplementing its parser, so the two repos cannot hold a second
 * opinion about the same plan.
 *
 * Only what a scheduler needs. The GSN goal and the exit criteria are governance, not schedule,
 * and shipping them here would invite a consumer to re-render arbiter's evidence rules.
 *
 * `estimate_days` and `due` are OMITTED when the SSOT has none rather than defaulted: a consumer
 * must be able to tell "no estimate was given" from "the estimate is zero", which is exactly the
 * distinction forma's own duration heuristic has to declare on screen.
 * `epics` rides along for the same reason `members` does: it is the claimed side of a join whose
 * other side the consumer already holds. Always present, empty when none are declared — an absent
 * key would make "this arbiter is too old to emit epics" indistinguishable from "this plan has
 * none", and the consumer would have to guess which silence it was reading.
 * @param {Array<Record<string, unknown>>} milestones
 * @param {Array<Record<string, unknown>>} [epics]
 * @returns {{ schema: string, epics: Array<Record<string, unknown>>, milestones: Array<Record<string, unknown>> }}
 */
export function milestoneProjection(milestones, epics = []) {
  return {
    schema: 'arbiter-milestones-v1',
    epics: [...epics]
      .sort((a, b) => String(a['id']).localeCompare(String(b['id'])))
      .map((e) => ({
        id: e['id'],
        title: e['title'],
        issue: e['issue'],
        targets: e['targets'],
        status: e['status'],
      })),
    milestones: [...milestones]
      .sort((a, b) => String(a['id']).localeCompare(String(b['id'])))
      .map((m) => {
        /** @type {Record<string, unknown>} */
        const row = {
          id: m['id'],
          title: m['title'],
          depends_on: Array.isArray(m['depends_on']) ? [...m['depends_on']].sort() : [],
          horizon: m['horizon'],
          status: m['status'],
        }
        if (typeof m['estimate_days'] === 'number') row['estimate_days'] = m['estimate_days']
        if (typeof m['due'] === 'string') row['due'] = m['due']
        // `members` is the CLAIM: which issues this milestone says it contains. It is not
        // governance and it is not optional colour — it is the join key. The consumer already sees
        // GitHub's side (each issue carries its milestone), and reconciliation drift is exactly the
        // comparison of the two. Without the claimed side a consumer can spot a milestone with no
        // GitHub counterpart but never an issue filed under the wrong one, which is the drift that
        // actually happens. Omitted entirely when the SSOT declares none, so "no claim" stays
        // distinguishable from "claims nothing".
        if (m['members'] && typeof m['members'] === 'object') row['members'] = m['members']
        return row
      }),
  }
}

/**
 * @param {boolean} json
 * @param {string} verdict
 * @param {string} message
 * @param {string[]} violations
 * @returns {void}
 */
function report(json, verdict, message, violations) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ verdict, message, violations }, null, 2)}\n`)
    return
  }
  if (verdict === 'skip') {
    process.stdout.write(`[SKIP] check-milestones: ${message}\n`)
    return
  }
  for (const v of violations) process.stderr.write(`check-milestones: FAIL — ${v}\n`)
  if (verdict === 'pass') process.stdout.write(`check-milestones: PASS — ${message}\n`)
}

/** @param {string[]} argv @returns {number} */
/**
 * Read the SSOT and its schema. Both failures are exit 2, not 1 (INV-53): an unparseable file or an
 * unloadable schema means the gate could not tell, which is a different claim from "the roadmap is
 * wrong" and must not be filed as one.
 * @returns {{ code: number } | { doc: unknown, schema: unknown }}
 */
function loadInputs(path) {
  let doc
  try {
    doc = YAML.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    process.stderr.write(`check-milestones: ${MILESTONES_REL} is not valid YAML — ${err.message}\n`)
    return { code: 2 }
  }
  try {
    return { doc, schema: loadSchema(resolve(scriptDir, '..', SCHEMA_REL)) }
  } catch (err) {
    process.stderr.write(`check-milestones: cannot load ${SCHEMA_REL} — ${err.message}\n`)
    return { code: 2 }
  }
}

/**
 * Write the projection. Called only after every rule has passed, which is the property that keeps
 * an invalid plan from producing a consumable artifact at all.
 */
/** A top-level array field, or an empty array — the document may be any shape when it is invalid. */
function listOf(doc, key) {
  return Array.isArray(doc?.[key]) ? doc[key] : []
}

/**
 * Report schema violations with ids substituted for array indices, and say whether any were found.
 * Reads the two lists defensively: this runs precisely when the document is known NOT to conform,
 * so neither `milestones` nor `epics` can be assumed to be an array.
 * @returns {boolean} true when the caller should stop
 */
function reportSchemaViolations(schemaViolations, doc, json) {
  if (schemaViolations.length === 0) return false
  const annotated = annotateSchemaViolations(
    schemaViolations,
    listOf(doc, 'milestones'),
    listOf(doc, 'epics'),
  )
  report(json, 'fail', 'schema violations', annotated)
  return true
}

function emitProjection(emit, milestones, epics, json) {
  mkdirSync(dirname(emit), { recursive: true })
  writeFileSync(
    emit,
    `${JSON.stringify(milestoneProjection(milestones, epics), null, 2)}\n`,
    'utf-8',
  )
  if (!json) process.stdout.write(`check-milestones: projection written to ${emit}\n`)
}

function main(argv) {
  const { root, json, emit } = parseArgs(argv)
  const path = join(root, MILESTONES_REL)
  if (!existsSync(path)) {
    report(json, 'skip', `${MILESTONES_REL} absent — no roadmap codified in this project`, [])
    return 0
  }

  const loaded = loadInputs(path)
  if (loaded.code !== undefined) return loaded.code
  const { doc, schema } = loaded

  const schemaViolations = validateSchema(doc, schema, schema, 'milestones')
  if (reportSchemaViolations(schemaViolations, doc, json)) return 1

  const milestones = doc.milestones
  const epics = listOf(doc, 'epics')
  const violations = collectViolations(milestones, root, epics)
  if (violations.length > 0) {
    report(json, 'fail', 'structural violations', violations)
    return 1
  }
  // Emitted only here — AFTER schema validation and every structural rule has passed. Putting the
  // projection behind the gate rather than in a separate generator buys the property that an
  // invalid milestone set cannot produce a projection at all.
  if (emit) emitProjection(emit, milestones, epics, json)
  report(
    json,
    'pass',
    `${milestones.length} milestone(s) and ${epics.length} epic(s), acyclic, evidence-complete, join agrees both ways`,
    [],
  )
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    process.stderr.write(`check-milestones: ${err?.stack ?? err}\n`)
    process.exit(2)
  }
}
