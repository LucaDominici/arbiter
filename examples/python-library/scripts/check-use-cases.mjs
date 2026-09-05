#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// python-library — docs/USE_CASES.md gate (UC-NN, INV-149)
//
// Emitted twin of arbiter's scripts/check-use-cases.mjs. The rules are identical; only the three
// document paths differ, because a governed project keeps its documents flat under docs/ while
// arbiter keeps its own under docs/internal/PRODUCT/ and docs/internal/METHOD/. That divergence is
// pinned in .dogfood-divergences.json and is the whole of it.
//
// This gate does its real work HERE rather than in arbiter, and the asymmetry is structural, not
// an omission. arbiter's feature matrix rows are cross-cutting capability areas, so one of its use
// cases would name nearly all of them and the link would carry no information. In a product, a use
// case names one or two features — that ratio is what makes the edge worth checking.
// CATALOG: validates the use-case SSOT against schemas/use-case.schema.json, resolves every
// CATALOG: featureId into the feature matrix, and joins use cases to the tabletop scenarios that
// CATALOG: exercise them — in both directions, so neither a use case nothing walks nor a scenario
// CATALOG: naming a use case that does not exist can hide.
// CATALOG: rejected fold-in into check-feature-matrix.mjs because that gate reads the matrix as
// CATALOG: the SSOT and grades each requirement's evidence chain; this one reads a different
// CATALOG: document and treats the matrix as a NAMESPACE to resolve into. A matrix can be
// CATALOG: perfectly graded while every use case pointing at it names a feature that was renamed.
// CATALOG: rejected fold-in into check-tabletop-evidence.mjs because that gate owns the scenario
// CATALOG: catalogue and its evidence; the join is read from this side because the dangling
// CATALOG: direction that matters (a use case nothing exercises) is invisible from the scenario.
//
// scripts/check-use-cases.mjs
// L1 gate (UC-NN, #2480 wave 8): a use case names an actor, a goal, and features that exist.
//
// Asserts:
//   1. the SSOT's fenced JSON block parses and satisfies schemas/use-case.schema.json — which is
//      where `featureIds` minItems:1 lives, because a use case demanding no feature is a promise
//      with nothing behind it,
//   2. no two use cases share an id,
//   3. every featureId resolves to a row in the feature matrix. This is the rule the whole gate
//      exists for: a use-case matrix decays by renames, and a dangling featureId reads exactly
//      like coverage,
//   4. THE JOIN, both ways — a tabletop scenario's `Exercises:` names a declared use case, and a
//      use case whose status is `exercised` is named by some scenario. A status nobody walks is a
//      claim, and this gate's job is to make it a checkable one,
//   5. `status: linked` or `exercised` requires every featureId to resolve (rule 3 applies to all
//      rows; the ladder adds no exemption, it only adds the scenario requirement).
//
// A missing SSOT is a SKIP, not a violation: a project need not have codified its use cases.
// The skip prints its reason and surfaces as `verdict: "skip"` under --json, so it cannot be
// mistaken for a pass by a reader or by runCheck's marker grep.
//
// --emit writes the machine projection forma consumes (schema arbiter-use-cases-v1), written ONLY
// after every rule has passed — so an invalid set cannot produce a projection, the property the
// milestone gate established and the reason the emit lives in the gate rather than in a generator.
//
// Usage: node scripts/check-use-cases.mjs [--dir <repo>] [--json] [--emit <path>]
// Exit: 0 pass or skip, 1 violation, 2 error (INV-53).
//
// Exports for unit tests: extractBlock, findDuplicateIds, findDanglingFeatures, parseMatrixIds,
//                         parseScenarioExercises, findJoinViolations, collectViolations,
//                         useCaseProjection

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from './lib/run-helpers.mjs'
import { loadSchema, validateSchema } from './lib/agent-return-validate.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const SSOT_REL = join('docs', 'USE_CASES.md')
const MATRIX_REL = join('docs', 'FEATURE_MATRIX.md')
const SCENARIOS_REL = join('docs', 'TABLETOP-SCENARIOS.md')
const SCHEMA_REL = join('schemas', 'use-case.schema.json')
const SENTINEL = 'USE_CASES'

/**
 * The fenced JSON between `<!-- USE_CASES_START -->` and `<!-- USE_CASES_END -->`. The SSOT is a
 * markdown document carrying a machine block, exactly as the ID registry is: a use-case matrix is
 * read by people far more often than by this gate, and a bare .json would optimise for the rarer
 * reader.
 * @returns {{ ok: true, document: unknown } | { ok: false, error: string }}
 */
export function extractBlock(text) {
  const start = text.indexOf(`<!-- ${SENTINEL}_START -->`)
  const end = text.indexOf(`<!-- ${SENTINEL}_END -->`)
  if (start === -1 || end === -1 || end < start) {
    return { ok: false, error: `has no ${SENTINEL}_START/${SENTINEL}_END sentinel pair` }
  }
  const fence = /```json\n([\s\S]*?)\n```/.exec(text.slice(start, end))
  if (!fence)
    return { ok: false, error: `has no \`\`\`json fence between the ${SENTINEL} sentinels` }
  try {
    return { ok: true, document: JSON.parse(fence[1]) }
    // FAIL-OPEN-INTENT: not fail-open — a malformed block is RETURNED as a blocking result and the caller exits 1 naming the file. The audit reads a catch that does not rethrow; this one surfaces the error through its return type instead, which is the same contract the artifact-schema hook uses.
  } catch (err) {
    return { ok: false, error: `block is not valid JSON — ${err.message}` }
  }
}

/** Duplicate ids. The schema validates each item alone and cannot see them. */
export function findDuplicateIds(useCases) {
  const seen = new Set()
  const out = []
  for (const uc of useCases) {
    const id = String(uc['id'])
    if (seen.has(id)) out.push(`duplicate use-case id "${id}"`)
    seen.add(id)
  }
  return out
}

/** Every feature id declared in the matrix's table rows. */
export function parseMatrixIds(matrixText) {
  const ids = new Set()
  for (const line of matrixText.split('\n')) {
    const m = /^\|\s*([A-Za-z][A-Za-z0-9_-]*)\s*\|/.exec(line)
    if (!m) continue
    const id = m[1]
    // The header row and the separator are the two non-rows that match the shape.
    if (/^(feature_id|id|---+)$/i.test(id)) continue
    ids.add(id)
  }
  return ids
}

/**
 * featureIds naming nothing in the matrix. The decay mode this gate exists for: a matrix row gets
 * renamed, every use case pointing at it keeps reading like coverage, and nothing notices.
 */
export function findDanglingFeatures(useCases, matrixIds) {
  const out = []
  for (const uc of useCases) {
    for (const f of Array.isArray(uc['featureIds']) ? uc['featureIds'] : []) {
      if (matrixIds.has(String(f))) continue
      out.push(
        `use case ${String(uc['id'])}: featureId "${String(f)}" is not a row in ${MATRIX_REL}`,
      )
    }
  }
  return out
}

/** `- **Exercises:** \`UC-NN\`` per scenario block, as a map of use-case id -> scenario headings. */
export function parseScenarioExercises(text) {
  const byUseCase = new Map()
  for (const block of text.split(/^## (?=\d+\. )/m).slice(1)) {
    const body = `## ${block}`
    const heading = body.split('\n')[0].replace(/^## /, '').trim()
    const line = /^- \*\*Exercises:\*\*\s*(.*)$/m.exec(body)
    if (!line) continue
    for (const m of line[1].matchAll(/UC-[0-9]{2,3}/g)) {
      if (!byUseCase.has(m[0])) byUseCase.set(m[0], [])
      byUseCase.get(m[0]).push(heading)
    }
  }
  return byUseCase
}

/**
 * The join, both ways. A scenario naming a use case that does not exist, and a use case CLAIMING
 * `exercised` that no scenario walks. The second direction is the one invisible from the scenario
 * side, which is why the join is read from here.
 */
export function findJoinViolations(useCases, exercises) {
  const known = new Set(useCases.map((uc) => String(uc['id'])))
  const out = []
  for (const [id, headings] of exercises) {
    if (known.has(id)) continue
    out.push(
      `${SCENARIOS_REL}: scenario "${headings[0]}" exercises "${id}", which is not a declared use case`,
    )
  }
  for (const uc of useCases) {
    if (String(uc['status']) !== 'exercised') continue
    const id = String(uc['id'])
    if (exercises.has(id)) continue
    out.push(
      `use case ${id} claims status "exercised" but no tabletop scenario names it — status is not a walk`,
    )
  }
  return out
}

/** Every structural rule, once the document is known schema-valid. */
export function collectViolations(useCases, matrixIds, exercises) {
  return [
    ...findDuplicateIds(useCases),
    ...findDanglingFeatures(useCases, matrixIds),
    ...findJoinViolations(useCases, exercises),
  ]
}

function report(json, verdict, message, violations) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ verdict, message, violations }, null, 2)}\n`)
    return
  }
  if (verdict === 'skip') {
    process.stdout.write(`[SKIP] check-use-cases: ${message}\n`)
    return
  }
  for (const v of violations) process.stderr.write(`check-use-cases: FAIL — ${v}\n`)
  if (verdict === 'pass') process.stdout.write(`check-use-cases: PASS — ${message}\n`)
}

/** Rewrite `useCases.useCases[2]` as `UC-30` so a schema error names the row a reader can find. */
export function annotateSchemaViolations(violations, useCases) {
  return violations.map((v) =>
    v.replace(/^useCases\.useCases\[(\d+)\]/, (_m, i) => {
      const id = useCases[Number(i)]?.['id']
      return id ? `use case ${String(id)}` : `use case #${i}`
    }),
  )
}

/**
 * The machine projection a viewer consumes. Only what a traceability view needs: who wants what,
 * which features it rests on, and whether a scenario has actually walked it.
 *
 * `exercisedBy` is DERIVED here rather than copied from the declared `status`, because the two can
 * disagree and only one of them is checkable — the gate has just proven which scenarios name this
 * use case, so the projection carries the measurement, not the claim.
 * @param {Array<Record<string, unknown>>} useCases
 * @param {Map<string, string[]>} exercises
 */
export function useCaseProjection(useCases, exercises) {
  return {
    schema: 'arbiter-use-cases-v1',
    useCases: [...useCases]
      .sort((a, b) => String(a['id']).localeCompare(String(b['id'])))
      .map((uc) => {
        const id = String(uc['id'])
        /** @type {Record<string, unknown>} */
        const row = {
          id,
          actor: uc['actor'],
          goal: uc['goal'],
          featureIds: [...(Array.isArray(uc['featureIds']) ? uc['featureIds'] : [])].sort(),
          exercisedBy: (exercises.get(id) ?? []).slice().sort(),
        }
        // Omitted when absent rather than defaulted, so "no journey declared" stays distinguishable
        // from "declared as belonging to none".
        if (Array.isArray(uc['journeyIds'])) row['journeyIds'] = [...uc['journeyIds']].sort()
        if (typeof uc['prdRef'] === 'string') row['prdRef'] = uc['prdRef']
        if (typeof uc['status'] === 'string') row['status'] = uc['status']
        return row
      }),
  }
}

/**
 * Load the schema and validate. A schema that will not load is exit 2, not 1 (INV-53): the gate
 * could not tell, which is a different claim from "a use case is wrong" and must not be filed as
 * one — the emitted twin ships its schema alongside it precisely so this cannot happen silently.
 * @returns {{ code: number } | { doc: Record<string, unknown> }}
 */
function validateDocument(document, json) {
  let schema
  try {
    schema = loadSchema(resolve(scriptDir, '..', SCHEMA_REL))
  } catch (err) {
    process.stderr.write(`check-use-cases: cannot load ${SCHEMA_REL} — ${err.message}\n`)
    return { code: 2 }
  }
  const violations = validateSchema(document, schema, schema, 'useCases')
  if (violations.length === 0) return { doc: document }
  const list = Array.isArray(document?.useCases) ? document.useCases : []
  report(json, 'fail', 'schema violations', annotateSchemaViolations(violations, list))
  return { code: 1 }
}

/** Write the projection. Called only after every rule has passed. */
function emitProjection(emit, useCases, exercises, json) {
  mkdirSync(dirname(emit), { recursive: true })
  const doc = useCaseProjection(useCases, exercises)
  writeFileSync(emit, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8')
  if (!json) process.stdout.write(`check-use-cases: projection written to ${emit}\n`)
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const i = argv.indexOf('--dir')
  const e = argv.indexOf('--emit')
  return {
    root: i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : process.cwd(),
    json: argv.includes('--json'),
    emit: e >= 0 && argv[e + 1] ? resolve(argv[e + 1]) : null,
  }
}

function main(argv) {
  const { root, json, emit } = parseArgs(argv)
  const ssot = join(root, SSOT_REL)
  if (!existsSync(ssot)) {
    report(json, 'skip', `${SSOT_REL} absent — no use cases codified in this project`, [])
    return 0
  }

  const extracted = extractBlock(readFileSync(ssot, 'utf-8'))
  if (!extracted.ok) {
    report(json, 'fail', 'unreadable SSOT', [`${SSOT_REL} ${extracted.error}`])
    return 1
  }

  const validated = validateDocument(extracted.document, json)
  if (validated.code !== undefined) return validated.code
  const doc = validated.doc

  const useCases = doc.useCases
  const matrixPath = join(root, MATRIX_REL)
  if (!existsSync(matrixPath)) {
    // Not a skip: use cases EXIST and every one of them names features. Without the matrix the
    // central rule cannot run, and passing anyway would report coverage this gate never checked.
    report(json, 'fail', 'missing namespace', [
      `${useCases.length} use case(s) declared but ${MATRIX_REL} is absent — every featureId is unresolvable`,
    ])
    return 1
  }
  const matrixIds = parseMatrixIds(readFileSync(matrixPath, 'utf-8'))

  const scenariosPath = join(root, SCENARIOS_REL)
  const exercises = existsSync(scenariosPath)
    ? parseScenarioExercises(readFileSync(scenariosPath, 'utf-8'))
    : new Map()

  const violations = collectViolations(useCases, matrixIds, exercises)
  if (violations.length > 0) {
    report(json, 'fail', 'structural violations', violations)
    return 1
  }
  if (emit) emitProjection(emit, useCases, exercises, json)
  const walked = useCases.filter((uc) => exercises.has(String(uc['id']))).length
  report(
    json,
    'pass',
    `${useCases.length} use case(s), every featureId resolves, ${walked} exercised by a scenario`,
    [],
  )
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    // Exit 2, not 1 (INV-53): 1 means a use case is wrong, 2 means the gate could not tell.
    process.stderr.write(`check-use-cases: ERROR — ${err?.stack ?? err}\n`)
    process.exit(2)
  }
}
