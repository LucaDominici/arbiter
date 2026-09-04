// SPDX-License-Identifier: Apache-2.0
// arbiter — gate-roster SSOT + CANON-24 inversion-proof ledger semantics (#2301).
//
// Two things live here, both pure (no entry point, no process.exit — see
// check-fail-closed-audit SKIP_FILES):
//
//   1. enumerateGateMechanisms(gateSrc) — the one parser for "what does scripts/check-all.mjs
//      actually run". EXTRACTED from check-canon01-declination.mjs (#1922), which still owns the
//      CANON-01 mapping but no longer owns the regex: a second consumer (the CANON-24 flip
//      harness) needs the same roster, and check-canon01-declination.mjs runs main() at import
//      time, so it cannot be imported for its exports. One parser, two consumers.
//
//   2. The CANON-24 absence-asserting family and its deferral ledger. CANON-24: for every new or
//      modified gate, name the concrete change that must turn it red and prove it by inverting
//      that change. The family scoped FIRST (issue #2301 AC-3) is the shape this defect class
//      hides in — gates that assert the ABSENCE of something, where "nothing found" and "nothing
//      looked at" are the same green:
//        - `no`      basename check-no-*          (nothing forbidden is present)
//        - `ratchet` name/basename ~ ratchet|no-regress  (nothing got worse)
//        - `parity`  name/basename ~ parity       (nothing diverged)
//      Every family member must carry a flip proof (scripts/lib/guard-flip-registry.mjs) or a row
//      in scripts/data/inversion-proof-registry.json. The ledger is BANKED — its length must equal
//      its declared ceiling — so a NEW family gate cannot be waved through by appending a row:
//      the only way in is a proof that it goes red when its condition is inverted.
//
// Deliberately NOT verified against the GitHub API: a `gh`-backed liveness check is unrunnable
// offline and in CI jobs without a token, and a check that silently no-ops in some environments is
// the very corollary this issue names (#2301 corollary 3). What the ledger's exemption actually
// buys is bounded by `expires`, which a clock verifies in EVERY environment; `issue` is recorded
// provenance and grants nothing on its own, so a fabricated number cannot widen the exemption.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Repo-relative path of the CANON-24 deferral ledger. */
export const INVERSION_REGISTRY_PATH = 'scripts/data/inversion-proof-registry.json'

/**
 * Every mechanism invoked by check-all.mjs, in declaration order. Returns { name, tool, path }
 * where `path` is the scripts/ argument, or null for an off-the-shelf binary (external tool).
 */
export function enumerateGateMechanisms(gateSrc) {
  const re =
    /run(?:Check|WarnCheck|ToolCheck)\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'([^']*)'\s*,\s*\[([^\]]*)\]/gs
  const mechanisms = []
  for (const m of gateSrc.matchAll(re)) {
    const args = m[3].split(',').map((s) => s.trim().replace(/^'/, '').replace(/'$/, ''))
    mechanisms.push({
      name: m[1],
      tool: m[2],
      path: args.find((a) => a.startsWith('scripts/')) ?? null,
    })
  }
  return mechanisms
}

/**
 * Which absence-asserting category a wired mechanism belongs to, or null when it asserts the
 * PRESENCE of something (a shape this class does not hide in as readily). Matched on the declared
 * check name AND the script basename so a gate stays in the family through a rename of either.
 */
export function absenceCategory(name, scriptPath) {
  if (!scriptPath) return null
  const base = scriptPath.split('/').pop() ?? ''
  const hay = `${name} ${base}`.toLowerCase()
  if (/^check-no-/.test(base)) return 'no'
  if (/ratchet|no-regress|non-regress/.test(hay)) return 'ratchet'
  if (/parity/.test(hay)) return 'parity'
  return null
}

/**
 * The absence-asserting gate family derived from check-all.mjs source. Each entry is shaped like a
 * flip-harness roster entry ({ name, script }) plus its category, so the harness can run it
 * directly against its registered fixtures.
 */
export function deriveAbsenceFamily(gateSrc) {
  const seen = new Set()
  const family = []
  for (const mech of enumerateGateMechanisms(gateSrc)) {
    const category = absenceCategory(mech.name, mech.path)
    if (category === null || seen.has(mech.name)) continue
    seen.add(mech.name)
    family.push({ name: mech.name, script: mech.path, category })
  }
  return family
}

/**
 * The flip proof covering `gate`, or null. Looked up by check name first, then by SCRIPT: a gate
 * wired under a second name (check-no-passwithnotests is both the INV-25 gate and the
 * anti-fake-green `no-empty-suite` guard) is already proven, and a duplicate fixture would be
 * dead weight, not extra assurance.
 */
export function flipProofFor(gate, registry, roster = []) {
  if (registry[gate.name]) return registry[gate.name]
  for (const other of roster) {
    if (other.script === gate.script && registry[other.name]) return registry[other.name]
  }
  return null
}

/** Read the deferral ledger from `root`. Throws on missing/malformed JSON — callers fail closed. */
export function loadInversionRegistry(root) {
  return JSON.parse(readFileSync(join(root, INVERSION_REGISTRY_PATH), 'utf-8'))
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MIN_REASON_CHARS = 30

/** Problems with one ledger row, given the derived family indexed by gate name. */
function rowProblems(row, byName, now) {
  const problems = []
  const label = typeof row?.gate === 'string' && row.gate !== '' ? row.gate : '<row without a gate>'
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return [`${label}: ledger row is not an object`]
  }
  if (typeof row.gate !== 'string' || row.gate === '') {
    return ['ledger row without a `gate` name']
  }

  const gate = byName.get(row.gate)
  if (!gate) {
    problems.push(
      `${label}: not in the absence-asserting family derived from check-all.mjs — a row for a ` +
        `gate that is not wired (or was renamed) exempts nothing and must be removed`,
    )
  } else if (row.script !== gate.script) {
    problems.push(
      `${label}: row declares script ${String(row.script)} but check-all.mjs wires ${gate.script}`,
    )
  } else if (row.category !== gate.category) {
    problems.push(
      `${label}: row declares category ${String(row.category)} but the gate derives as ${gate.category}`,
    )
  }

  if (typeof row.reason !== 'string' || row.reason.trim().length < MIN_REASON_CHARS) {
    problems.push(
      `${label}: needs a \`reason\` of at least ${MIN_REASON_CHARS} characters naming why no ` +
        `inversion fixture exists yet — a reasonless row is a blanket exemption`,
    )
  }
  if (!Number.isInteger(row.issue) || row.issue <= 0) {
    problems.push(`${label}: \`issue\` must be a positive integer (provenance for the deferral)`)
  }
  if (typeof row.expires !== 'string' || !ISO_DATE.test(row.expires)) {
    problems.push(`${label}: \`expires\` must be a YYYY-MM-DD date — a deferral without an end`)
  } else {
    const due = new Date(`${row.expires}T00:00:00Z`)
    if (Number.isNaN(due.getTime())) {
      problems.push(`${label}: unparseable \`expires\` (${row.expires})`)
    } else if (due.getTime() < now.getTime()) {
      problems.push(
        `${label}: deferral expired ${row.expires} — write the inversion fixture or re-decide; ` +
          `audit-mode is a stage, not a destination`,
      )
    }
  }
  return problems
}

/**
 * Audit the CANON-24 deferral ledger against the derived family. Returns the list of problems
 * (empty ⇒ the ledger is sound). Fail-closed: a shape that cannot be audited is a problem, never
 * an empty pass.
 */
export function auditInversionRegistry({ family, registry, now = new Date() }) {
  if (registry === null || typeof registry !== 'object' || Array.isArray(registry)) {
    return ['inversion-proof ledger is not an object']
  }
  if (!Array.isArray(registry.deferred)) {
    return ['inversion-proof ledger has no `deferred` array']
  }
  if (!Number.isInteger(registry.ceiling) || registry.ceiling < 0) {
    return ['inversion-proof ledger has no non-negative integer `ceiling`']
  }

  const problems = []
  if (registry.deferred.length > registry.ceiling) {
    problems.push(
      `deferral ledger holds ${registry.deferred.length} rows over a ceiling of ${registry.ceiling} — ` +
        `the ratchet is non-increasing: prove the gate by inversion instead of adding a row`,
    )
  } else if (registry.deferred.length < registry.ceiling) {
    problems.push(
      `deferral ledger holds ${registry.deferred.length} rows under a ceiling of ${registry.ceiling} — ` +
        `unbanked improvement: lower the ceiling to ${registry.deferred.length} so the slack cannot ` +
        `be silently re-filled`,
    )
  }

  const byName = new Map(family.map((f) => [f.name, f]))
  const seen = new Set()
  for (const row of registry.deferred) {
    problems.push(...rowProblems(row, byName, now))
    const key = row?.gate
    if (typeof key === 'string') {
      if (seen.has(key)) problems.push(`${key}: duplicate ledger row`)
      seen.add(key)
    }
  }
  return problems
}
