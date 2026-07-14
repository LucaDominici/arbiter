#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: E2 (#1943, M13) — refutation-by-majority gate. High-stakes findings are not
// CATALOG: accepted from one agent: N independent skeptics are dispatched with a REFUTE mandate;
// CATALOG: a finding survives only with a strict UPHELD majority. When the refutation skill
// CATALOG: writes a marker (.arbiter/evidence/agent-returns/<task>/refutation-required.json), this
// CATALOG: gate asserts every acted-on finding has >= N skeptic verdicts AND a strict UPHELD
// CATALOG: majority — kills R4 (false structural alarms acted on) and R2 (rubber stamps).
// CATALOG: Rejected fold-in into check-agent-return.mjs: that VALIDATES the envelope schema + M12
// CATALOG: citations; this ADJUDICATES the refutation majority over a set of skeptic envelopes —
// CATALOG: different axis (shape vs verdict semantics), different trigger (always vs marker-gated).
//
// Exit codes (INV-53): 0 PASS, 1 FAIL (insufficient skeptics / majority-refuted acted-on finding),
// 2 ERROR. Vacuous pass when no marker exists (nothing to adjudicate — scope condition itself
// checked, not a skip).
//
// Usage:
//   node scripts/check-refutation-verdicts.mjs [--evidence-dir=<path>] [--repo-root=<dir>]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg } from './lib/gate-args.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoDefault = resolve(__dirname, '..')

const argv = process.argv.slice(2)
const EVIDENCE_DIR = arg('evidence-dir', argv)
  ? resolve(arg('evidence-dir', argv))
  : join(repoDefault, '.arbiter', 'evidence', 'agent-returns')
const MARKER_NAME = 'refutation-required.json'

/**
 * Find the refutation marker under the evidence dir (any task subdir).
 * @param {string} evidenceDir
 * @returns {{ path: string, body: Record<string, unknown> } | null}
 */
function findMarker(evidenceDir) {
  if (!existsSync(evidenceDir)) return null
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
  if (markers.length === 0) return null
  const path = markers[0]
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

function main() {
  let marker
  try {
    marker = findMarker(EVIDENCE_DIR)
  } catch (err) {
    process.stderr.write(
      `[check-refutation-verdicts] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }
  if (!marker) {
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
  if (findings.length === 0) {
    process.stdout.write(
      `[check-refutation-verdicts] OK — marker present but no findings require refutation\n`,
    )
    return 0
  }
  // task dir name = sanitized task id (the marker lives under <task>/)
  const markerDir = marker.path.split('/').slice(0, -1).pop() ?? ''
  const skeptics = loadSkepticEnvelopes(EVIDENCE_DIR, markerDir)
  let violations = 0
  for (const id of findings) {
    /** @type {{ verdict: string }[]} */
    const verdicts = []
    for (const env of skeptics) {
      const refs = Array.isArray(env['refutations']) ? env['refutations'] : []
      for (const r of refs) {
        const rr = /** @type {Record<string, unknown>} */ (r)
        if (rr['target'] === id && (rr['verdict'] === 'UPHELD' || rr['verdict'] === 'REFUTED')) {
          verdicts.push({ verdict: String(rr['verdict']) })
        }
      }
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
  if (violations > 0) {
    process.stdout.write(
      `[check-refutation-verdicts] FAIL: ${violations} finding(s) failed refutation adjudication\n`,
    )
    return 1
  }
  process.stdout.write(
    `[check-refutation-verdicts] OK — ${findings.length} finding(s) survived refutation (N=${N})\n`,
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
