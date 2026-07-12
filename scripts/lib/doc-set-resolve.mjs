// SPDX-License-Identifier: Apache-2.0
// T4 (gold-doc-tranches-t3-t5.md §2.2) — shared resolution lib, extracted (behavior-frozen) from
// scripts/check-doc-set.mjs: TIER_COLUMN/resolveCollaborationMode/loadTierColumn, requirementFor,
// loadOverlays, and the glob/ADR presence machinery. check-doc-set.mjs re-imports every one of
// these — the doc-set.test.ts engine-parity test pins that the move changes nothing. Presence
// (check-doc-set.mjs) and freshness (check-doc-freshness.mjs) stay TWO independent gates sharing
// ONE resolution SSOT here, mirroring the gold-audit.mjs / gold-audit-lib.mjs split.
//
// Every function takes `cwd` explicitly (no module-level state) — freshness runs from the same
// CWD as presence but is a separate process/entry point, so this lib carries no implicit global.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { globToRegExp, walkRepo } from './glob-walk.mjs'

export const isGlob = (p) => /[*?[\]]/.test(p)

/**
 * True if at least one file matches the glob pattern.
 *
 * H2 (gold-doc-capability Tranche 2): a `**`-bearing pattern (e.g.
 * `docs/architecture/**\/arc42.md`) is resolved with a real recursive repo walk
 * (scripts/lib/glob-walk.mjs `walkRepo` + `globToRegExp`) so subtree-nested docs are recognized.
 * A `**`-free pattern keeps the original single-directory `readdirSync` fast path unchanged.
 */
export function globMatches(pattern, cwd) {
  if (pattern.includes('**')) {
    const re = globToRegExp(pattern)
    return walkRepo(cwd).some((rel) => re.test(rel))
  }
  const dir = dirname(pattern)
  const base = pattern.slice(dir.length + 1)
  const dirAbs = resolve(cwd, dir)
  if (!existsSync(dirAbs)) return false
  const re = new RegExp(
    '^' +
      base
        .replace(/[.+^${}()|\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.') +
      '$',
  )
  let entries
  try {
    entries = readdirSync(dirAbs)
  } catch {
    return false
  }
  return entries.some((e) => re.test(e))
}

/** Every file matching the glob pattern (relative to `cwd`) — the resolvePresentPaths building block. */
export function globMatchList(pattern, cwd) {
  if (pattern.includes('**')) {
    const re = globToRegExp(pattern)
    return walkRepo(cwd).filter((rel) => re.test(rel))
  }
  const dir = dirname(pattern)
  const base = pattern.slice(dir.length + 1)
  const dirAbs = resolve(cwd, dir)
  if (!existsSync(dirAbs)) return []
  const re = new RegExp(
    '^' +
      base
        .replace(/[.+^${}()|\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.') +
      '$',
  )
  let entries
  try {
    entries = readdirSync(dirAbs)
  } catch {
    return []
  }
  return entries.filter((e) => re.test(e)).map((e) => `${dir}/${e}`)
}

/** A single candidate path exists (glob-aware; matches files OR directories). */
export function candidateExists(candidate, cwd) {
  return isGlob(candidate) ? globMatches(candidate, cwd) : existsSync(resolve(cwd, candidate))
}

// ADR record forms (#1415 dual recognition). All anchored to the start of the filename so a
// stray "notes.txt" or "README.md" never counts as a decision record:
//   legacy bare-numeric:  001-thin-pointer.md
//   legacy ADR-prefixed:  ADR-001-thin-pointer.md / ADR-001_thin-pointer.md
//   repo-prefixed:        <PREFIX>-NNN_slug.md   (e.g. ARB-001_thin-pointer.md)
const ADR_BARE_RE = /^\d{3,}[-_].+\.md$/
const ADR_LEGACY_RE = /^ADR-\d{3,}[-_].+\.md$/i
const ADR_PREFIX_RE = /^[A-Za-z][A-Za-z0-9]*-\d{3,}[-_].+\.md$/

/** True if >=1 filename matches a decision-record form (legacy/prefixed dual recognition). */
export const isAdrFilename = (e) =>
  ADR_BARE_RE.test(e) || ADR_LEGACY_RE.test(e) || ADR_PREFIX_RE.test(e)

/** True if >=1 ADR record (legacy bare/ADR-NNN or repo-prefixed <PREFIX>-NNN) lives under dir. */
export function adrPresent(adrDir, cwd) {
  const dirAbs = resolve(cwd, adrDir)
  if (!existsSync(dirAbs)) return false
  let entries
  try {
    entries = readdirSync(dirAbs)
  } catch {
    return false
  }
  return entries.some(isAdrFilename)
}

/** Every ADR record filename (relative to `cwd`) found directly under `adrDir`. */
export function adrPresentList(adrDir, cwd) {
  const dirAbs = resolve(cwd, adrDir)
  if (!existsSync(dirAbs)) return []
  let entries
  try {
    entries = readdirSync(dirAbs)
  } catch {
    return []
  }
  return entries.filter(isAdrFilename).map((e) => `${adrDir}/${e}`)
}

/**
 * H2 (gold-doc-capability Tranche 2): the single-directory adrPresent() above is path-blind — a
 * project whose ADRs live two-plus directories deep is invisible to it. Recursively walk the repo
 * for any file whose immediate parent directory is literally named `ADR`/`adr` (case-insensitive)
 * AND whose filename matches the SAME dual-recognition regexes.
 */
export function adrPresentAnywhere(cwd) {
  for (const rel of walkRepo(cwd)) {
    const parts = rel.split('/')
    const filename = parts[parts.length - 1]
    const parentDir = parts[parts.length - 2]
    if (!parentDir || parentDir.toLowerCase() !== 'adr') continue
    if (isAdrFilename(filename)) return true
  }
  return false
}

/** Every ADR record found anywhere in the repo under a directory literally named `ADR`/`adr`. */
export function adrPresentAnywhereList(cwd) {
  const found = []
  for (const rel of walkRepo(cwd)) {
    const parts = rel.split('/')
    const filename = parts[parts.length - 1]
    const parentDir = parts[parts.length - 2]
    if (!parentDir || parentDir.toLowerCase() !== 'adr') continue
    if (isAdrFilename(filename)) found.push(rel)
  }
  return found
}

// H3 (gold-doc-capability Tranche 1) — collaborationMode → tiers{} column resolution.
// Mirrors scripts/check-ci-tiers.mjs `resolveCm`: explicit collaborationMode > the
// soloDevMode back-compat alias (ADR-051) > default 'peer-review' (same default the rest
// of the codebase uses, src/wizard/prompts.ts DEFAULT_COLLABORATION_MODE).
export const TIER_COLUMN = {
  'trunk-solo': 'solo',
  'peer-review': 'small',
  'gated-review': 'enterprise',
}

export function resolveCollaborationMode(config) {
  if (config.collaborationMode) return config.collaborationMode
  if (config.enableSoloDevMode === true || config.features?.soloDevMode === true)
    return 'trunk-solo'
  return 'peer-review'
}

/** Read arbiter.json's collaborationMode (repo-root relative) and resolve the tiers{} column. */
export function loadTierColumn(cwd) {
  const cfgPath = resolve(cwd, 'arbiter.json')
  if (!existsSync(cfgPath)) return TIER_COLUMN[resolveCollaborationMode({})]
  try {
    const config = JSON.parse(readFileSync(cfgPath, 'utf-8'))
    const cm = resolveCollaborationMode(config)
    return TIER_COLUMN[cm] || TIER_COLUMN[resolveCollaborationMode({})]
  } catch {
    return TIER_COLUMN[resolveCollaborationMode({})]
  }
}

/**
 * Resolve a check's requirement band for the given tiers{} column.
 *   'R' -> 'mandatory'  'r' -> 'recommended'  'o' | '-' -> 'skip' (dormant, counted as n/a)
 * Checks without a tiers{} field fall back to the legacy flat `tier:` literal.
 */
export function requirementFor(check, column) {
  if (!check.tiers) return check.tier === 'mandatory' ? 'mandatory' : 'recommended'
  const cell = check.tiers[column]
  if (cell === 'R') return 'mandatory'
  if (cell === 'r') return 'recommended'
  if (cell === 'o' || cell === '-') return 'skip'
  // Unrecognized value or missing column key (manifest typo) ⇒ fail-closed (INV-96).
  return 'mandatory'
}

/** Resolve presence for a check: any of accept_any / glob / path (ADR-aware for adr:true). */
export function isPresent(check, cwd) {
  const candidates = check.accept_any?.length ? check.accept_any : [check.path]
  if (
    check.adr === true &&
    (adrPresent(dirname(check.glob || 'docs/ADR/x'), cwd) || adrPresentAnywhere(cwd))
  )
    return true
  if (check.glob && globMatches(check.glob, cwd)) return true
  return candidates.some((c) => candidateExists(c, cwd))
}

/**
 * T4 (gold-doc-tranches-t3-t5.md §2.2): WHICH concrete file(s) satisfy a check — `isPresent`
 * only answers yes/no. The freshness gate needs the real path(s) to open and read `last_review`
 * from, so it can grade the ACTUAL doc, not a guess at `check.path` (which may not be the
 * candidate that exists, or may be a directory for a glob/ADR row).
 */
export function resolvePresentPaths(check, cwd) {
  if (check.adr === true) {
    const dir = dirname(check.glob || 'docs/ADR/x')
    return [...adrPresentList(dir, cwd), ...adrPresentAnywhereList(cwd)]
  }
  if (check.glob) return globMatchList(check.glob, cwd)
  const candidates = check.accept_any?.length ? check.accept_any : [check.path]
  const found = candidates.filter((c) => !isGlob(c) && existsSync(resolve(cwd, c)))
  if (found.length > 0) return found
  // A candidate itself may be a glob (rare — none in the shipped manifest today, but the schema
  // allows it); fall back to matching those too rather than silently returning nothing.
  return candidates.filter(isGlob).flatMap((c) => globMatchList(c, cwd))
}

/**
 * T1b (addendum §1.2, gold-doc-self-tier-and-coherence.md) — solo < small < enterprise ordering
 * for the `tier_floor` max()-semantics below. Exported so a floor value can be validated against
 * the SAME set `loadTierColumn`'s TIER_COLUMN targets (never a second, drifting enum).
 */
export const TIER_ORDER = { solo: 0, small: 1, enterprise: 2 }

/**
 * Load `standards/doc-profile`-shaped overlays (+ optional `tier_floor`, T1b) for `cwd`.
 * `tier_floor` fail-closed (INV-96): an explicit-but-invalid value ALWAYS throws — never silently
 * ignored — but a genuine YAML syntax error still safely defaults (existing tolerant behavior,
 * kept OUTSIDE the parse try/catch on purpose so the two failure classes stay distinct).
 */
export function loadOverlays(cwd, profilePath) {
  const abs = resolve(cwd, profilePath)
  if (!existsSync(abs)) return { overlays: new Set(), allow: [], tierFloor: undefined }
  let p
  try {
    p = parseYaml(readFileSync(abs, 'utf-8')) || {}
  } catch {
    return { overlays: new Set(), allow: [], tierFloor: undefined }
  }
  if (p.tier_floor !== undefined && !(p.tier_floor in TIER_ORDER)) {
    throw new Error(
      `check-doc-set: invalid tier_floor "${p.tier_floor}" in ${profilePath} — must be one of ` +
        'solo|small|enterprise (INV-96 fail-closed)',
    )
  }
  return { overlays: new Set(p.overlays || []), allow: p.allow || [], tierFloor: p.tier_floor }
}

/**
 * T1b — effective tier column = max(derived, floor) on solo < small < enterprise. A floor can
 * only RAISE the collaborationMode-derived column, never lower it: `gated-review` +
 * `tier_floor: solo` still resolves to `enterprise` — the floor cannot be used to dodge the
 * anti-cathedral guardrail (gold-doc-capability.md §2), only to raise a repo's own bar above what
 * its collaborationMode alone would derive (self: `trunk-solo` -> `solo`, floored to `enterprise`
 * because arbiter is an npm-published framework exposing a plugin API, gold-doc-capability.md §1/§6.1).
 */
export function resolveEffectiveColumn(derived, floor) {
  if (!floor) return derived
  return TIER_ORDER[floor] > TIER_ORDER[derived] ? floor : derived
}
