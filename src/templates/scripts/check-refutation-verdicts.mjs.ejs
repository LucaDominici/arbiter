#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: E2 (#1943, M13) — refutation-by-majority gate. High-stakes findings are not
// CATALOG: accepted from one agent: N independent skeptics are dispatched with a REFUTE mandate;
// CATALOG: a finding survives only with a strict UPHELD majority. When the refutation skill
// CATALOG: writes a marker (.arbiter/evidence/agent-returns/<task>/refutation-required.json), this
// CATALOG: gate asserts every acted-on finding has >= N skeptic verdicts AND a strict UPHELD
// CATALOG: majority — kills R4 (false structural alarms acted on) and R2 (rubber stamps).
// CATALOG: SECOND AXIS (INV-145, CANON-24): the majority rule proves you did not act on a phantom;
// CATALOG: the SEVERITY FLOOR proves you did not stop while a real one was still open. Any finding
// CATALOG: the skeptics majority-UPHELD at critical/high/med must appear in the marker's acted-on
// CATALOG: set. Both axes read the same envelopes, so the loop needs no new artifact — only the
// CATALOG: obligation to keep hopping until nothing above `low` survives unaddressed.
// CATALOG: Rejected fold-in into check-agent-return.mjs: that VALIDATES the envelope schema + M12
// CATALOG: citations; this ADJUDICATES the refutation majority over a set of skeptic envelopes —
// CATALOG: different axis (shape vs verdict semantics), different trigger (always vs marker-gated).
//
// Exit codes (INV-53): 0 PASS, 1 FAIL (insufficient skeptics / majority-refuted acted-on finding /
//   a majority-upheld finding above `low` left unaddressed),
// 2 ERROR. Vacuous pass when no marker exists (nothing to adjudicate — scope condition itself
// checked, not a skip).
//
// Usage:
//   node scripts/check-refutation-verdicts.mjs [--evidence-dir=<path>] [--repo-root=<dir>]
//       [--require-marker=<task>]
// --repo-root (#2860) is where `.claude/.task/status.json` is read from to learn which task the
// caller has DECLARED it is working — defaults to this script's own repo. Without --require-marker,
// a declared task selects the marker BOUND to it (A03-003), never a bare directory-walk order;
// with no declared task, one marker is unambiguous but two or more refuse to be picked from
// silently (exit 2). Quorum counts one vote per skeptic ENVELOPE, not per raw refutation entry
// (A03-004): an envelope repeating or self-contradicting a verdict on the same finding casts at
// most one vote.
// --require-marker names the task a caller has DECLARED needs a refutation marker (#2614):
// with it set, a missing marker BOUND to that exact task is exit 1 instead of the vacuous pass
// below — bound both by directory (the sanitized task id) and by the marker's own `task` field,
// so a marker that belongs to a different task can never satisfy someone else's requirement.
// The value must look like a GitHub issue id ('#NNN'); a bare `--require-marker` (no value) or
// an empty `--require-marker=` is malformed input, not a silent vacuous pass, and exits 2.
// Absent the flag entirely, every existing behaviour (including the vacuous pass) is unchanged
// (AC-2) — this script still has no opinion of its own on which tasks require one; that
// classification lives with the caller.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg } from './lib/gate-args.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoDefault = resolve(__dirname, '..')

const argv = process.argv.slice(2)
const ROOT = arg('repo-root', argv) ? resolve(arg('repo-root', argv)) : repoDefault
const EVIDENCE_DIR = arg('evidence-dir', argv)
  ? resolve(arg('evidence-dir', argv))
  : join(repoDefault, '.arbiter', 'evidence', 'agent-returns')
const REQUIRE_MARKER_GIVEN =
  argv.includes('--require-marker') || argv.some((a) => a.startsWith('--require-marker='))
const REQUIRE_MARKER = arg('require-marker', argv)
const MARKER_NAME = 'refutation-required.json'

/** @param {string} task @returns {boolean} */
function isTaskId(task) {
  return /^#[0-9]+$/.test(task)
}

/** @param {string} task @returns {string} */
function sanitizeTask(task) {
  return task.replace(/[^0-9A-Za-z-]/g, '_')
}

/**
 * List every refutation marker path under the evidence dir (any task subdir).
 * @param {string} evidenceDir
 * @returns {string[]}
 */
function listMarkers(evidenceDir) {
  if (!existsSync(evidenceDir)) return []
  /** @type {string[]} */
  const markers = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      let st
      try {
        st = statSync(full)
        // FAIL-OPEN-INTENT: statSync ENOENT race on a dir entry — skip; rethrow would false-positive on a racing delete.
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full)
      else if (entry === MARKER_NAME) markers.push(full)
    }
  }
  walk(evidenceDir)
  return markers
}

/**
 * Parse a marker file.
 * @param {string} path
 * @returns {{ path: string, body: Record<string, unknown> }}
 */
function readMarker(path) {
  try {
    const body = JSON.parse(readFileSync(path, 'utf-8'))
    return { path, body: /** @type {Record<string, unknown>} */ (body) }
  } catch (err) {
    throw new Error(
      `cannot parse marker ${path}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * The task the caller has DECLARED it is working (#2860): read from the repo's own task state,
 * never guessed. Anything but a well-formed '#NNN' string is treated as no identity — the
 * ambiguity it exists to resolve stays unresolved, not silently accepted.
 * @param {string} root
 * @returns {string | null}
 */
function declaredTask(root) {
  const p = join(root, '.claude', '.task', 'status.json')
  if (!existsSync(p)) return null
  const s = /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(p, 'utf-8')))
  return typeof s['taskId'] === 'string' && isTaskId(s['taskId']) ? s['taskId'] : null
}

/**
 * Select the marker to adjudicate (A03-003): a declared task is looked up by its own binding
 * (same rule as --require-marker); with no declared task, a single marker is unambiguous, but
 * two or more is a corpus this script must refuse to silently pick markers[0] from.
 * @param {string} evidenceDir
 * @param {string | null} task
 * @returns {{ path: string, body: Record<string, unknown> } | null}
 */
function selectMarker(evidenceDir, task) {
  if (task) return findMarkerForTask(evidenceDir, task)
  const all = listMarkers(evidenceDir)
  if (all.length > 1) {
    throw new Error(`${all.length} refutation markers and no task identity; refusing to pick one`)
  }
  return all.length ? readMarker(all[0]) : null
}

/**
 * One skeptic verdict per envelope (A03-004): an envelope that names the same target more than
 * once must not cast more than one vote, and an envelope that contradicts itself on the same
 * target (both UPHELD and REFUTED) casts none.
 * @param {Record<string, unknown>} env
 * @param {string} id
 * @returns {string | null}
 */
function envelopeVerdict(env, id) {
  const refs = Array.isArray(env['refutations']) ? env['refutations'] : []
  const verdicts = new Set(
    refs
      .map((r) => /** @type {Record<string, unknown>} */ (r))
      .filter((r) => r['target'] === id && /^(UPHELD|REFUTED)$/.test(String(r['verdict'])))
      .map((r) => String(r['verdict'])),
  )
  return verdicts.size === 1 ? [...verdicts][0] : null
}

/**
 * Find the refutation marker BOUND to one task: it must live under that task's own sanitized
 * directory, and if the marker declares a `task` field, that field must agree. A marker for a
 * different task — whether sitting in a foreign directory or merely mis-declared — is not this
 * task's marker (#2614, Codex review round 1).
 * @param {string} evidenceDir
 * @param {string} task
 * @returns {{ path: string, body: Record<string, unknown> } | null}
 */
function findMarkerForTask(evidenceDir, task) {
  const markerPath = join(evidenceDir, sanitizeTask(task), MARKER_NAME)
  if (!existsSync(markerPath)) return null
  /** @type {Record<string, unknown>} */
  let body
  try {
    body = JSON.parse(readFileSync(markerPath, 'utf-8'))
  } catch (err) {
    throw new Error(
      `cannot parse marker ${markerPath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  // Strict: the marker must DECLARE the requested task, not merely sit in a directory named for
  // it — a missing or non-string `task` field is not proof of binding either (#2614 round 2).
  if (body['task'] !== task) return null
  return { path: markerPath, body }
}

/**
 * Load every skeptic envelope under the marker's task dir.
 * @param {string} evidenceDir
 * @param {string} taskDirName
 * @returns {Record<string, unknown>[]}
 */
function loadSkepticEnvelopes(evidenceDir, taskDirName) {
  const taskDir = join(evidenceDir, taskDirName)
  if (!existsSync(taskDir)) return []
  /** @type {Record<string, unknown>[]} */
  const out = []
  for (const entry of readdirSync(taskDir)) {
    if (!entry.endsWith('.json') || entry === MARKER_NAME) continue
    try {
      const env = JSON.parse(readFileSync(join(taskDir, entry), 'utf-8'))
      if (env && typeof env === 'object' && env['role'] === 'skeptic') {
        out.push(/** @type {Record<string, unknown>} */ (env))
      }
      // FAIL-OPEN-INTENT: unparseable envelope is skipped here — E1 (check-agent-return.mjs) owns shape validation and fails closed on the same file.
    } catch {
      // unparseable envelope — skip here (E1 owns shape validation); fail-closed on marker parse.
    }
  }
  return out
}

/** Severities that may never be left open when the loop closes (INV-145). `low`/`info` may. */
export const ABOVE_FLOOR = new Set(['critical', 'high', 'med'])

/**
 * Findings the skeptics reported at a severity above the floor, which a strict UPHELD majority
 * confirmed, and which the marker does NOT list as acted on. Severity is taken as the HIGHEST any
 * skeptic assigned: when two disagree, the loop must clear the worse reading, not the kinder one.
 *
 * @param {Record<string, unknown>[]} skeptics skeptic envelopes
 * @param {string[]} actedOn ids from the marker
 * @param {number} n required skeptic count
 * @returns {{id: string, severity: string}[]} sorted, worst first
 */
export function unaddressedAboveFloor(skeptics, actedOn, n) {
  const RANK = { critical: 3, high: 2, med: 1 }
  const worst = new Map()
  for (const env of skeptics) {
    const found = Array.isArray(env['findings']) ? env['findings'] : []
    for (const f of found) {
      const ff = /** @type {Record<string, unknown>} */ (f)
      const id = typeof ff['id'] === 'string' ? ff['id'] : null
      const sev = typeof ff['severity'] === 'string' ? ff['severity'] : null
      if (id === null || sev === null || !ABOVE_FLOOR.has(sev)) continue
      const prev = worst.get(id)
      if (prev === undefined || (RANK[sev] ?? 0) > (RANK[prev] ?? 0)) worst.set(id, sev)
    }
  }
  const out = []
  for (const [id, severity] of worst) {
    if (actedOn.includes(id)) continue
    let upheld = 0
    let refuted = 0
    for (const env of skeptics) {
      const v = envelopeVerdict(env, id)
      if (v === 'UPHELD') upheld++
      else if (v === 'REFUTED') refuted++
    }
    // Only a finding the skeptics actually confirmed blocks the loop. One below quorum, or
    // majority-refuted, is not a real finding and must not hold the wave hostage.
    if (upheld + refuted >= n && upheld > refuted) out.push({ id, severity })
  }
  return out.sort(
    (a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0) || a.id.localeCompare(b.id),
  )
}

function main() {
  if (REQUIRE_MARKER_GIVEN && !isTaskId(REQUIRE_MARKER ?? '')) {
    process.stderr.write(
      `[check-refutation-verdicts] ERROR: --require-marker must be a GitHub issue id like ` +
        `'#2614' (got: ${REQUIRE_MARKER ? REQUIRE_MARKER : '(empty)'})\n`,
    )
    return 2
  }
  let marker
  try {
    marker = REQUIRE_MARKER
      ? findMarkerForTask(EVIDENCE_DIR, REQUIRE_MARKER)
      : selectMarker(EVIDENCE_DIR, declaredTask(ROOT))
  } catch (err) {
    process.stderr.write(
      `[check-refutation-verdicts] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }
  if (!marker) {
    if (REQUIRE_MARKER) {
      process.stdout.write(
        `[check-refutation-verdicts] FAIL: refutation marker required for task ` +
          `${REQUIRE_MARKER} but none found under ${EVIDENCE_DIR}\n`,
      )
      return 1
    }
    process.stdout.write(
      '[check-refutation-verdicts] OK — no refutation marker, nothing to adjudicate\n',
    )
    return 0
  }
  const N = Number(marker.body['skeptics'] ?? 0)
  const findings = Array.isArray(marker.body['findings']) ? marker.body['findings'] : []
  if (!Number.isInteger(N) || N < 1) {
    process.stdout.write(
      `[check-refutation-verdicts] FAIL: marker ${marker.path} has invalid skeptics count (${N})\n`,
    )
    return 1
  }
  // NOTE: no early return on an empty acted-on set. The majority axis has nothing to adjudicate
  // there, but the SEVERITY FLOOR has everything: a wave that addressed nothing while the
  // skeptics upheld a high finding is exactly the case INV-145 exists to catch, and returning
  // early here made the floor unreachable for it — found by its own tests.
  // task dir name = sanitized task id (the marker lives under <task>/)
  const markerDir = marker.path.split('/').slice(0, -1).pop() ?? ''
  const skeptics = loadSkepticEnvelopes(EVIDENCE_DIR, markerDir)
  let violations = 0
  for (const id of findings) {
    /** @type {{ verdict: string }[]} */
    const verdicts = []
    for (const env of skeptics) {
      const v = envelopeVerdict(env, id)
      if (v) verdicts.push({ verdict: v })
    }
    if (verdicts.length < N) {
      process.stdout.write(
        `[check-refutation-verdicts] FAIL: finding "${id}" has ${verdicts.length} skeptic verdict(s), need >= ${N}\n`,
      )
      violations++
      continue
    }
    const upheld = verdicts.filter((v) => v.verdict === 'UPHELD').length
    const refuted = verdicts.filter((v) => v.verdict === 'REFUTED').length
    if (upheld <= refuted) {
      process.stdout.write(
        `[check-refutation-verdicts] FAIL: finding "${id}" acted on but majority-refuted (UPHELD ${upheld} <= REFUTED ${refuted})\n`,
      )
      violations++
    }
  }
  // INV-145 severity floor. The loop is not closed while a REAL finding above `low` is still
  // open, so a majority-upheld finding at critical/high/med must be in the acted-on set. Without
  // this the majority rule is one-sided: it stops you acting on a phantom, and says nothing about
  // stopping early on something true.
  const unaddressed = unaddressedAboveFloor(skeptics, findings, N)
  for (const f of unaddressed) {
    process.stdout.write(
      `[check-refutation-verdicts] FAIL: finding "${f.id}" (${f.severity}) is majority-upheld but ` +
        `not in the acted-on set — the adversarial loop closes only when nothing above \`low\` ` +
        `survives. Fix it and hop again, or lower it with evidence.\n`,
    )
    violations++
  }
  if (marker.body['degraded'] === true) {
    // Recorded, never silently equated with an independent round. A hop that could not reach an
    // independent skeptic (model unavailable, rate limit) is accepted but must SAY it was degraded,
    // so the evidence never claims an independence it did not have.
    process.stdout.write(
      `[check-refutation-verdicts] DEGRADED — marker declares no independent skeptic was available; ` +
        `verdicts are self-probed and this round does not count as independent\n`,
    )
  }
  if (violations > 0) {
    process.stdout.write(
      `[check-refutation-verdicts] FAIL: ${violations} finding(s) failed refutation adjudication\n`,
    )
    return 1
  }
  process.stdout.write(
    findings.length === 0
      ? `[check-refutation-verdicts] OK — marker present, no finding acted on, and nothing above ` +
          `\`low\` left unaddressed\n`
      : `[check-refutation-verdicts] OK — ${findings.length} finding(s) survived refutation ` +
          `(N=${N}), nothing above \`low\` left unaddressed\n`,
  )
  return 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(
    `[check-refutation-verdicts] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}
