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
// RT-04 (#1966 red-team): only the repo-convention metadata keys may vanish from
// the parity compare. A block carrying ANY other top-level key (e.g. an injected
// agent directive) is treated as content — it stays visible and reds the gate.
const FRONT_MATTER_KEY_ALLOWLIST = Object.freeze([
  'title',
  'doc_version',
  'status',
  'last_review',
  'owner',
  'canonical_id',
  'tags',
  'related',
])

export function stripLeadingFrontMatter(content) {
  if (!content.startsWith('---\n')) return content
  const close = content.indexOf('\n---\n', 3)
  if (close === -1) return content
  const block = content.slice('---\n'.length, close + 1)
  // Default-DENY (CR4-01): every non-blank line must be an inline `key: ...`
  // whose key is allowlisted, each key at most once. Anything else — plain
  // directive lines, list items, indented/quoted/unicode keys, continuation
  // lines — keeps the whole block on the compare surface (reds the gate).
  // Residual channel (documented limit): hostile text as the VALUE of an
  // allowlisted key still vanishes; values are repo-reviewed metadata.
  const seen = new Set()
  for (const line of block.split('\n')) {
    if (line.trim() === '') continue
    const m = /^([A-Za-z_][\w-]*): /.exec(line)
    if (m === null) return content
    if (!FRONT_MATTER_KEY_ALLOWLIST.includes(m[1])) return content
    if (seen.has(m[1])) return content
    seen.add(m[1])
  }
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
// Unknown-key + path/duplicate checks for one divergence entry — split out of
// validateDivergenceEntry to keep both helpers under the complexity budget.
// `seen` is mutated in place (duplicate-path tracking spans the whole array).
function validateDivergenceKeysAndPath(e, i, seen) {
  const errors = []
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
  return errors
}

// Per-entry validation for a single divergence pin — split out of
// validateSelfDivergences so the array-walk stays a flat dispatch (complexity
// budget) while this helper carries the actual field-shape checks. `seen` is
// mutated in place (duplicate-path tracking spans the whole array).
function validateDivergenceEntry(e, i, seen) {
  if (!isPlainObject(e)) {
    return [`divergences[${i}]: entry must be an object`]
  }
  const errors = validateDivergenceKeysAndPath(e, i, seen)
  if (!isNonEmptyString(e.reason)) errors.push(`divergences[${i}]: reason must be non-empty`)
  if (!ISO_DATE.test(e.date ?? '')) errors.push(`divergences[${i}]: date must be YYYY-MM-DD`)
  if (!HEX64.test(e.diffHash ?? '')) errors.push(`divergences[${i}]: diffHash must be sha256 hex`)
  return errors
}

export function validateSelfDivergences(json) {
  const errors = []
  if (!Array.isArray(json)) {
    throw new Error('divergences: top-level value must be an array of pin entries')
  }
  const seen = new Set()
  json.forEach((e, i) => {
    errors.push(...validateDivergenceEntry(e, i, seen))
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
// Classifies a path present on BOTH sides (emitted + repo) — the
// EMITTED-MATCH / healed-pin / stale / PINNED / drifted-pin branches. Split
// out of classifySelfParity's main loop to keep the per-path dispatch flat.
// Returns { classified: boolean, finding?: {clazz, path, detail} }.
function classifyPresentBothSides(path, pin, emittedNorm, repoNorm) {
  if (emittedNorm === repoNorm) {
    if (pin === undefined) return { classified: true }
    return {
      classified: true,
      finding: {
        clazz: 'healed-pin',
        path,
        detail:
          'pinned divergence has healed (sides are now normalized-equal) — remove the ' +
          'ledger entry or it suppresses future drift (its rationale survives in git history)',
      },
    }
  }
  if (pin === undefined) {
    return {
      classified: false,
      finding: {
        clazz: 'stale',
        path,
        detail:
          'materialized file diverges from the current generator emission — re-materialize ' +
          '(copy the fresh emission over the repo copy) or pin the divergence with a dated ' +
          'rationale in scripts/data/codex-self-parity-divergences.json',
      },
    }
  }
  if (computeDivergenceDiffHash(emittedNorm, repoNorm) === pin.diffHash) {
    return { classified: true }
  }
  return {
    classified: false,
    finding: {
      clazz: 'drifted-pin',
      path,
      detail:
        'divergence drifted beyond the approved pin (diffHash mismatch) — re-review and ' +
        're-pin both sides, or re-materialize the repo copy',
    },
  }
}

// Classifies a path that is NOT present on both sides: emitted-only
// (missing), declared runtime artifact, repo-only pinned, or unclassified.
// Mirrors classifyPresentBothSides's return shape.
function classifyNotPresentBothSides(path, pin, isEmitted, artifacts, readRepo, normalize) {
  if (isEmitted) {
    return {
      classified: false,
      finding: {
        clazz: 'missing',
        path,
        detail:
          'generator emits this file but the repo has no materialized copy — skipIfExists ' +
          'never backfills it; copy it in from a fresh emission',
      },
    }
  }
  if (artifacts.has(path)) return { classified: true }
  if (pin !== undefined) {
    // Repo-only pinned file: the pin justifies content the generator never
    // emits; its diffHash hashes the emitted side as '' (see
    // computeDivergenceDiffHash).
    const repoNorm = normalize(readRepo(path), 'repo')
    if (computeDivergenceDiffHash('', repoNorm) === pin.diffHash) {
      return { classified: true }
    }
    return {
      classified: false,
      finding: {
        clazz: 'drifted-pin',
        path,
        detail:
          'repo-only pinned file drifted beyond the approved pin (diffHash mismatch) — ' +
          're-review and re-pin, or remove the file',
      },
    }
  }
  return {
    classified: false,
    finding: {
      clazz: 'unclassified',
      path,
      detail:
        'repo file under a codex track root is not emitted, not pinned, and not a declared ' +
        'runtime artifact — remove it, pin it, or declare it in ' +
        'scripts/data/codex-self-parity-runtime-artifacts.json',
    },
  }
}

// RT-03 (#1966 red-team): runtime-artifact ledger rot sweep — a declared
// artifact matching no repo file is dead weight that would otherwise
// accumulate invisibly (symmetric with the dead-pin sweep below). Returns the
// findings for the sweep; the caller pushes them onto its own array.
function sweepRuntimeArtifacts(runtimeArtifacts, emitted, repo) {
  const findings = []
  for (const declared of runtimeArtifacts) {
    if (emitted.has(declared)) {
      // CR4-04: an emitted path can never be a runtime artifact — the inert
      // declaration would silently auto-green a leftover repo copy the day the
      // generator stops emitting it.
      findings.push({
        clazz: 'contradictory-artifact',
        path: declared,
        detail:
          'declared runtime artifact is emitted by the generator — remove the declaration from ' +
          'scripts/data/codex-self-parity-runtime-artifacts.json',
      })
    } else if (!repo.has(declared)) {
      findings.push({
        clazz: 'dead-artifact',
        path: declared,
        detail:
          'runtime-artifact declaration matches no repo file — remove the stale entry from ' +
          'scripts/data/codex-self-parity-runtime-artifacts.json',
      })
    }
  }
  return findings
}

// Dead-pin sweep: a ledger pin whose path matches neither tree. Returns the
// findings for the sweep; the caller pushes them onto its own array.
function sweepDeadPins(pins, emitted, repo) {
  const findings = []
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
  return findings
}

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
    const result =
      emitted.has(path) && repo.has(path)
        ? classifyPresentBothSides(
            path,
            pin,
            normalize(readEmitted(path), 'emitted'),
            normalize(readRepo(path), 'repo'),
          )
        : classifyNotPresentBothSides(path, pin, emitted.has(path), artifacts, readRepo, normalize)
    if (result.classified) classified++
    if (result.finding !== undefined) findings.push(result.finding)
  }

  findings.push(...sweepRuntimeArtifacts(runtimeArtifacts, emitted, repo))
  findings.push(...sweepDeadPins(pins, emitted, repo))

  return { findings, surface: { total: union.length, classified } }
}
