// SPDX-License-Identifier: Apache-2.0
// scripts/lib/codex-self-parity-lib.mjs — pure helpers for the codex SELF-parity
// gate (ADR-106 addendum, #1966 self-track). No I/O, no process.exit, no repo
// mutation: every function operates on explicit inputs (injected readers and
// normalizer) so unit tests can drive each check against in-memory fixtures.
//
// Classification model: the parity surface is the UNION of a fresh generator
// emission and the repo's materialized codex track roots (.agents/** +
// .codex/**). Every file in it must end in exactly one terminal state —
// EMITTED-MATCH (normalized-equal on both sides), validly PINNED (dated
// rationale + diffHash in scripts/data/codex-self-parity-divergences.json), or
// RUNTIME-ARTIFACT (declared in
// scripts/data/codex-self-parity-runtime-artifacts.json). Everything else is a
// finding: stale / missing / unclassified / drifted-pin / healed-pin /
// dead-pin. Zero findings ⇒ pass; classification coverage must be 100%.
//
// Consumed by scripts/check-codex-self-parity.mjs (the gate check) and by
// __tests__/scripts/check-codex-self-parity.test.ts (unit + mutation fixtures).

import { sha256 } from './codex-parity-lib.mjs'

// ─── Self-track path domain ──────────────────────────────────────────────────

// The self gate scans ONLY the codex track roots of the arbiter repo itself.
// Every ledger path must live under one of these prefixes or it can never
// match a scanned file — rejected at validation time, not silently dead.
const SELF_TRACK_PREFIXES = Object.freeze(['.agents/', '.codex/'])

const HEX64 = /^[0-9a-f]{64}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isNonEmptyString(x) {
  return typeof x === 'string' && x.length > 0
}

function isSelfTrackPath(x) {
  return (
    isNonEmptyString(x) && SELF_TRACK_PREFIXES.some((p) => x.startsWith(p) && x.length > p.length)
  )
}

function isPlainObject(x) {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

// ─── Front-matter stripping (repo-side normalization, design §3.1 step 3) ────

/**
 * Strip a leading YAML doc-frontmatter block: the repo doc convention adds a
 * `---`-fenced metadata block (title/doc_version/status/...) that the codex
 * templates never emit (M1). Removes the block through its closing `---` line
 * plus ONE following blank line when present; content without a leading block
 * (or with an unterminated one) is returned unchanged.
 */
export function stripLeadingFrontMatter(content) {
  if (!content.startsWith('---\n')) return content
  const close = content.indexOf('\n---\n', 3)
  if (close === -1) return content
  let body = content.slice(close + '\n---\n'.length)
  if (body.startsWith('\n')) body = body.slice(1)
  return body
}

// ─── Ledger validators (scripts/data/codex-self-parity-*.json) ──────────────

const DIVERGENCE_KEYS = Object.freeze(['path', 'reason', 'date', 'diffHash'])

/**
 * Validate the self-divergence ledger: a top-level array of pins, each
 * exactly { path, reason, date, diffHash } — path repo-relative under a codex
 * track root, reason non-empty, date YYYY-MM-DD, diffHash a sha256 hex pin
 * (see computeDivergenceDiffHash). Unknown keys, duplicates, or any shape
 * violation throw with the offending entry — the gate fails closed on a
 * ledger it cannot trust. Returns the validated array.
 */
export function validateSelfDivergences(json) {
  const errors = []
  if (!Array.isArray(json)) {
    throw new Error('divergences: top-level value must be an array of pin entries')
  }
  const seen = new Set()
  json.forEach((e, i) => {
    if (!isPlainObject(e)) {
      errors.push(`divergences[${i}]: entry must be an object`)
      return
    }
    for (const key of Object.keys(e)) {
      if (!DIVERGENCE_KEYS.includes(key)) errors.push(`divergences[${i}]: unknown key "${key}"`)
    }
    if (!isSelfTrackPath(e.path)) {
      errors.push(`divergences[${i}]: path must be repo-relative under .agents/ or .codex/`)
    } else if (seen.has(e.path)) {
      errors.push(`divergences[${i}]: duplicate pin for ${e.path}`)
    } else {
      seen.add(e.path)
    }
    if (!isNonEmptyString(e.reason)) errors.push(`divergences[${i}]: reason must be non-empty`)
    if (!ISO_DATE.test(e.date ?? '')) errors.push(`divergences[${i}]: date must be YYYY-MM-DD`)
    if (!HEX64.test(e.diffHash ?? '')) errors.push(`divergences[${i}]: diffHash must be sha256 hex`)
  })
  if (errors.length > 0) throw new Error(`codex-self-parity ledger invalid: ${errors.join('; ')}`)
  return json
}

/**
 * Validate the runtime-artifact declaration file: an object of exactly
 * { runtimeArtifacts: string[] }, each entry a repo-relative path under a
 * codex track root (anything else could never match a scanned file). Throws
 * on any shape violation; returns the validated object.
 */
export function validateRuntimeArtifacts(json) {
  const errors = []
  if (!isPlainObject(json)) {
    throw new Error('runtime-artifacts: top-level value must be an object')
  }
  for (const key of Object.keys(json)) {
    if (key !== 'runtimeArtifacts') errors.push(`runtime-artifacts: unknown key "${key}"`)
  }
  if (!Array.isArray(json.runtimeArtifacts)) {
    errors.push('runtime-artifacts: runtimeArtifacts must be an array')
  } else {
    const seen = new Set()
    json.runtimeArtifacts.forEach((p, i) => {
      if (!isSelfTrackPath(p)) {
        errors.push(`runtime-artifacts[${i}]: must be repo-relative under .agents/ or .codex/`)
      } else if (seen.has(p)) {
        errors.push(`runtime-artifacts[${i}]: duplicate declaration for ${p}`)
      } else {
        seen.add(p)
      }
    })
  }
  if (errors.length > 0) {
    throw new Error(`codex-self-parity runtime-artifacts invalid: ${errors.join('; ')}`)
  }
  return json
}

// ─── Divergence pin hash ─────────────────────────────────────────────────────

/**
 * Deterministic pin over an approved divergence. Serialization (stable — the
 * committed ledger depends on it): the sha256 of the two normalized sides is
 * taken FIRST, then the pin is the sha256 of the labeled two-line record
 * `emitted <hex>\nrepo <hex>\n`. Hashing side-hashes (never the concatenated
 * bodies) makes the boundary between the sides unambiguous, keeps the pin
 * order-sensitive, and pins BOTH contents: any change to either side drifts
 * the pin. A pin on a repo-only file hashes the emitted side as ''.
 */
// exported for unit tests + divergence-pin authoring (the ledger's diffHash
// is computed with this exact serialization)
export function computeDivergenceDiffHash(emittedNorm, repoNorm) {
  return sha256(`emitted ${sha256(emittedNorm)}\nrepo ${sha256(repoNorm)}\n`)
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Classify every file in the union of the two scans into a terminal state.
 *
 * opts:
 *   emittedFiles/repoFiles — repo-relative posix paths from the two scans
 *   divergences            — validated pin entries (validateSelfDivergences)
 *   runtimeArtifacts       — validated declared paths (never emitted, repo-runtime)
 *   readEmitted/readRepo   — (path) => content, side-specific injected readers
 *   normalize              — (content, side: 'emitted'|'repo') => normalized content
 *
 * Terminal states and their findings (clazz):
 *   EMITTED-MATCH    — both sides normalized-equal (classified; a leftover pin
 *                      on such a file is a 'healed-pin' finding — dead entry)
 *   PINNED           — sides differ, pin diffHash matches (classified);
 *                      mismatch is 'drifted-pin'
 *   RUNTIME-ARTIFACT — repo-only file on the declared list (classified)
 *   'stale'          — both exist, normalized differ, no pin
 *   'missing'        — emitted but absent in repo (a pin never excuses this:
 *                      the generator says the file must exist)
 *   'unclassified'   — repo-only file that is neither pinned nor declared
 *   'dead-pin'       — ledger pin whose path exists in neither tree
 *
 * Returns { findings: [{clazz, path, detail}], surface: { total, classified } }
 * where total is the union size and classified counts only terminal-good
 * files. Zero findings ⇒ pass.
 */
export function classifySelfParity(opts) {
  const { emittedFiles, repoFiles, divergences, runtimeArtifacts, readEmitted, readRepo } = opts
  const { normalize } = opts
  const findings = []
  const emitted = new Set(emittedFiles)
  const repo = new Set(repoFiles)
  const pins = new Map(divergences.map((d) => [d.path, d]))
  const artifacts = new Set(runtimeArtifacts)
  const union = [...new Set([...emittedFiles, ...repoFiles])].sort()
  let classified = 0

  for (const path of union) {
    const pin = pins.get(path)
    if (emitted.has(path) && repo.has(path)) {
      const emittedNorm = normalize(readEmitted(path), 'emitted')
      const repoNorm = normalize(readRepo(path), 'repo')
      if (emittedNorm === repoNorm) {
        classified++
        if (pin !== undefined) {
          findings.push({
            clazz: 'healed-pin',
            path,
            detail:
              'pinned divergence has healed (sides are now normalized-equal) — remove the ' +
              'ledger entry or it suppresses future drift (its rationale survives in git history)',
          })
        }
      } else if (pin === undefined) {
        findings.push({
          clazz: 'stale',
          path,
          detail:
            'materialized file diverges from the current generator emission — re-materialize ' +
            '(copy the fresh emission over the repo copy) or pin the divergence with a dated ' +
            'rationale in scripts/data/codex-self-parity-divergences.json',
        })
      } else if (computeDivergenceDiffHash(emittedNorm, repoNorm) === pin.diffHash) {
        classified++
      } else {
        findings.push({
          clazz: 'drifted-pin',
          path,
          detail:
            'divergence drifted beyond the approved pin (diffHash mismatch) — re-review and ' +
            're-pin both sides, or re-materialize the repo copy',
        })
      }
    } else if (emitted.has(path)) {
      findings.push({
        clazz: 'missing',
        path,
        detail:
          'generator emits this file but the repo has no materialized copy — skipIfExists ' +
          'never backfills it; copy it in from a fresh emission',
      })
    } else if (artifacts.has(path)) {
      classified++
    } else if (pin !== undefined) {
      // Repo-only pinned file: the pin justifies content the generator never
      // emits; its diffHash hashes the emitted side as '' (see
      // computeDivergenceDiffHash).
      const repoNorm = normalize(readRepo(path), 'repo')
      if (computeDivergenceDiffHash('', repoNorm) === pin.diffHash) {
        classified++
      } else {
        findings.push({
          clazz: 'drifted-pin',
          path,
          detail:
            'repo-only pinned file drifted beyond the approved pin (diffHash mismatch) — ' +
            're-review and re-pin, or remove the file',
        })
      }
    } else {
      findings.push({
        clazz: 'unclassified',
        path,
        detail:
          'repo file under a codex track root is not emitted, not pinned, and not a declared ' +
          'runtime artifact — remove it, pin it, or declare it in ' +
          'scripts/data/codex-self-parity-runtime-artifacts.json',
      })
    }
  }

  for (const [path] of pins) {
    if (!emitted.has(path) && !repo.has(path)) {
      findings.push({
        clazz: 'dead-pin',
        path,
        detail:
          'ledger pin references a path present in neither the emission nor the repo — ' +
          'remove the entry (its rationale survives in git history)',
      })
    }
  }

  return { findings, surface: { total: union.length, classified } }
}
