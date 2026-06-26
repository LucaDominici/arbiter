// SPDX-License-Identifier: Apache-2.0
//
// #1260 — size resolution adapter for `arbiter ship`.
//
// Gathers the git-diff size signal (files + LOC via `git diff --numstat`) and resolves
// the review tier through the fail-safe fallback chain:
//
//   explicit `--tier` (rare override) > diff(files+LOC) > units(plan estimate) > default(widest)
//
// The pure rubric lives in ./sizing.ts (no I/O, reusable by #1267); this file is the
// injectable git seam — exactly the pure-scorer / adapter split src/affinity/ established
// (#1259). It NEVER throws: a failed `git diff` degrades to the units/default branch so
// size computation can never block a ship (mirrors renderShipAffinity's never-throw).
// All shell-outs go through the shared runCli helper (INV-12).
import { runCli } from '../utils/run-cli.js'
import {
  computeShipSize,
  sizeVerticals,
  DEFAULT_SHIP_TIER,
  type ShipSizeTier,
  type ShipSize,
} from './sizing.js'

/** Raw diff size signal (files touched + total added/deleted lines). */
interface DiffStat {
  filesChanged: number
  linesChanged: number
}

/** Injectable diff-stat gatherer seam (tests inject a fake; CLI injects git). */
export type DiffStatGatherer = (opts: { dir?: string; base?: string }) => DiffStat

/** Where the resolved tier came from — surfaced for transparency in step output. */
type SizeSource = 'explicit' | 'diff' | 'units' | 'default'

export interface ResolvedSize extends ShipSize {
  source: SizeSource
}

/** Parse one `git diff --numstat` field; binary ("-") and non-numeric → 0 lines. */
function parseNumstatField(raw: string | undefined): number {
  if (raw === undefined || raw === '-') return 0
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Gather diff size via `git diff --numstat <base>...HEAD`. Returns zeroes (not throw)
 * when git is unavailable / there is no diff, so the resolver can fall through cleanly.
 * Internal default gatherer for `resolveShipTier`; #1267 reuses `resolveShipTier` (the
 * public seam) rather than this raw gatherer, so it stays module-private.
 */
function gatherGitDiffStat(opts: { dir?: string; base?: string } = {}): DiffStat {
  const base = opts.base ?? 'origin/main'
  const args = ['diff', '--numstat', '--no-renames', `${base}...HEAD`]
  const res = runCli('git', args, opts.dir !== undefined ? { cwd: opts.dir } : {})
  let filesChanged = 0
  let linesChanged = 0
  for (const line of res.stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const [addRaw, delRaw] = trimmed.split('\t')
    filesChanged += 1
    // Binary files report "-" for add/del — count the file, skip its (unknown) lines.
    linesChanged += parseNumstatField(addRaw) + parseNumstatField(delRaw)
  }
  return { filesChanged, linesChanged }
}

function isValidTier(t: string): t is ShipSizeTier {
  return t === 'XS' || t === 'S' || t === 'Standard'
}

export interface ResolveShipTierOpts {
  /** Explicit `--tier` override; when valid, short-circuits all auto-computation. */
  explicitTier?: string
  /** Plan unit estimate — used when the diff yields no signal. */
  units?: number
  /** Diff-stat gatherer (defaults to git; tests inject a fake). */
  gather?: DiffStatGatherer
  dir?: string
  base?: string
}

const ZERO_STAT: DiffStat = { filesChanged: 0, linesChanged: 0 }

/** Run the gatherer, degrading any throw to a zero stat (the resolver fails safe). */
function safeGather(gather: DiffStatGatherer, opts: ResolveShipTierOpts): DiffStat {
  try {
    return gather({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      ...(opts.base !== undefined ? { base: opts.base } : {}),
    })
  } catch {
    return ZERO_STAT
  }
}

/**
 * Resolve the review tier (+ vertical floor) for a ship. ALWAYS returns a tier; NEVER
 * throws. A failed diff gather degrades to the units branch, then to DEFAULT_SHIP_TIER
 * (the widest) — the fail-safe direction is MORE review, never less.
 */
export function resolveShipTier(opts: ResolveShipTierOpts): ResolvedSize {
  // 1. Explicit override.
  if (opts.explicitTier !== undefined && isValidTier(opts.explicitTier)) {
    const tier = opts.explicitTier
    return { tier, verticals: sizeVerticals(tier), source: 'explicit' }
  }

  // 2. Diff signal (never throws — a git failure degrades to a zero stat).
  const gather = opts.gather ?? gatherGitDiffStat
  const stat = safeGather(gather, opts)
  if (stat.filesChanged > 0 || stat.linesChanged > 0) {
    const size = computeShipSize(stat)
    return { ...size, source: 'diff' }
  }

  // 3. Units fallback.
  if (opts.units !== undefined && opts.units > 0) {
    const size = computeShipSize({ units: opts.units })
    return { ...size, source: 'units' }
  }

  // 4. Fail-safe default (widest).
  return { tier: DEFAULT_SHIP_TIER, verticals: sizeVerticals(DEFAULT_SHIP_TIER), source: 'default' }
}

/** Render the resolved size as ship step-output lines (mirrors the affinity line). */
export function formatSizeLines(size: ResolvedSize): string[] {
  return [`Size: ${size.tier} (source: ${size.source}) · verticals: ${size.verticals.join(', ')}`]
}
