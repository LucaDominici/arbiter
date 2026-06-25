#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: #1410 orchestrator-coverage gate — every scripts/check-*.mjs must be
// CATALOG: reachable from scripts/check-all.mjs (directly OR transitively via the
// CATALOG: check-anti-fake-green GUARDS aggregate) or sit on a rationale'd allowlist.
// CATALOG: This is the INVERSE of check-emission-coherence.mjs (INV-123): that gate
// CATALOG: asks "does every REFERENCE resolve to an emitted file?" (ghost-reference
// CATALOG: class, generated tmpdir input); this asks "is every check FILE referenced
// CATALOG: by the orchestrator?" (orphan-gate class, self scripts/ input). Opposite
// CATALOG: direction, opposite failure mode, different input root — folding into
// CATALOG: emission-coherence would conflate two opposite questions, so a sibling is clearer.
// CATALOG: ADVISORY (report-only, exit 0) in this wave; promotion to a fail-closed gate
// CATALOG: is a tracked follow-up.
//
// Exports for unit tests: computeOrphanChecks, loadCoverageAllowlist.
// CLI: node scripts/check-orchestrator-coverage.mjs   (always exits 0)
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const SCRIPTS_DIR = join(ROOT, 'scripts')
const ALLOWLIST_PATH = join(SCRIPTS_DIR, 'data', 'orchestrator-coverage-allowlist.json')

/**
 * Load the rationale'd allowlist. Mirrors optional-emissions.json semantics:
 * every entry MUST carry a non-empty rationale, else it is a problem (an entry
 * can never silence an orphan with an empty justification).
 * @returns {{ entries: Array<{script:string,rationale:string}>, scripts: Set<string>, problems: string[] }}
 */
export function loadCoverageAllowlist(path = ALLOWLIST_PATH) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { entries: [], scripts: new Set(), problems: [] }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      entries: [],
      scripts: new Set(),
      problems: [`allowlist is not valid JSON: ${err.message}`],
    }
  }
  const list = Array.isArray(parsed?.allowlist) ? parsed.allowlist : null
  if (list === null) {
    return {
      entries: [],
      scripts: new Set(),
      problems: ['allowlist must have an "allowlist" array'],
    }
  }
  const entries = []
  const scripts = new Set()
  const problems = []
  for (const e of list) {
    if (typeof e?.script !== 'string' || e.script.length === 0) {
      problems.push('allowlist entry missing a "script" string')
      continue
    }
    if (typeof e.rationale !== 'string' || e.rationale.trim().length === 0) {
      problems.push(`allowlist entry "${e.script}" has an empty/missing rationale`)
      continue
    }
    entries.push({ script: e.script, rationale: e.rationale })
    scripts.add(e.script)
  }
  return { entries, scripts, problems }
}

/**
 * Pure orphan computation. A check-*.mjs file is an orphan iff its name appears
 * in NONE of: the orchestrator source, any transitive source (e.g. the
 * check-anti-fake-green GUARDS array body), or the allowlist. check-all.mjs and
 * check-orchestrator-coverage.mjs itself are never flagged.
 * @param {string[]} checkFiles  basenames like 'check-foo.mjs'
 * @param {string} orchestratorSrc  contents of scripts/check-all.mjs
 * @param {string[]} transitiveSrcs  contents of transitively-referenced files
 * @param {Set<string>} allowlist  allowlisted basenames
 * @returns {string[]} sorted orphan basenames
 */
export function computeOrphanChecks(checkFiles, orchestratorSrc, transitiveSrcs, allowlist) {
  const haystacks = [orchestratorSrc, ...transitiveSrcs]
  const SELF = new Set(['check-all.mjs', 'check-orchestrator-coverage.mjs'])
  const orphans = []
  for (const file of checkFiles) {
    if (SELF.has(file)) continue
    if (allowlist.has(file)) continue
    const referenced = haystacks.some((src) => src.includes(file))
    if (!referenced) orphans.push(file)
  }
  return orphans.sort()
}

// Transitive aggregators: files that themselves reference check-*.mjs gates and
// ARE wired into check-all.mjs (so a check reachable only through them still
// counts as covered). The anti-fake-green aggregate is the canonical example;
// its guard roster now lives in the shared SSOT lib (#1497), so that lib carries
// the guard basenames and must be part of the haystack too.
const TRANSITIVE_AGGREGATORS = ['check-anti-fake-green.mjs', 'lib/anti-fake-green-guards.mjs']

function main() {
  const checkFiles = readdirSync(SCRIPTS_DIR).filter(
    (f) => f.startsWith('check-') && f.endsWith('.mjs'),
  )
  let orchestratorSrc = ''
  try {
    orchestratorSrc = readFileSync(join(SCRIPTS_DIR, 'check-all.mjs'), 'utf8')
  } catch (err) {
    process.stderr.write(
      `check-orchestrator-coverage: WARN — cannot read check-all.mjs (${err.message}); advisory continues\n`,
    )
  }
  const transitiveSrcs = TRANSITIVE_AGGREGATORS.map((f) => {
    try {
      return readFileSync(join(SCRIPTS_DIR, f), 'utf8')
    } catch {
      return ''
    }
  })

  const { scripts: allowlist, problems } = loadCoverageAllowlist()
  for (const p of problems) {
    process.stderr.write(`check-orchestrator-coverage: allowlist problem — ${p}\n`)
  }

  const orphans = computeOrphanChecks(checkFiles, orchestratorSrc, transitiveSrcs, allowlist)

  if (orphans.length === 0) {
    process.stdout.write(
      `check-orchestrator-coverage: OK (advisory) — ${checkFiles.length} check scripts, ` +
        `0 un-allowlisted orphan(s); all reachable from check-all.mjs or allowlisted\n`,
    )
  } else {
    process.stdout.write(
      `check-orchestrator-coverage: ADVISORY — ${orphans.length} un-allowlisted orphan(s) ` +
        `not referenced by check-all.mjs (directly or transitively):\n`,
    )
    for (const o of orphans) {
      process.stdout.write(
        `  - ${o}  (wire it into check-all.mjs, or add a rationale'd allowlist entry)\n`,
      )
    }
  }
  // FAIL-OPEN-INTENT: this gate is ADVISORY by design (#1410) — report-only, never
  // blocks the gate. Promotion to a fail-closed gate is a tracked follow-up that must
  // first re-home or retire the workflow-lint orphans listed in the allowlist.
  process.exit(0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Top-level fail-closed guard: the FINDINGS are advisory (main() exits 0), but
  // an unexpected internal crash (e.g. scripts/ unreadable) is a real ERROR and
  // must surface as exit 2 — never a silent fail-open. (INV-96)
  try {
    main()
  } catch (err) {
    process.stderr.write(
      `check-orchestrator-coverage: ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  }
}
