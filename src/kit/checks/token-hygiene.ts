// SPDX-License-Identifier: Apache-2.0
/**
 * A10 (#1817): frontend token-hygiene check — opt-in fe-kit check.
 *
 * Enforces semantic-token-only styling: no raw Tailwind-style palette utility classes
 * (bg-red-500, text-slate-700, ...), and — where a project forbids it — no <style> blocks
 * in SFCs. Grandfathered violations live in a baseline; the baseline can only shrink
 * (ratchet): any violation not present in the baseline fails the gate.
 *
 * Algorithm generalized from viafera's scripts/verify-primitives-tokens.mjs (73% adoption,
 * 0 ad-hoc CSS) — rewritten idiomatically here, not copy-pasted, and with no viafera-specific
 * palette/token names baked in.
 *
 * Pure text-based validation — callers own file I/O (see src/commands/kit.ts).
 */

export interface HygieneFile {
  path: string
  content: string
}

type HygieneRule = 'raw-palette' | 'style-block'

export interface HygieneViolation {
  file: string
  line: number
  snippet: string
  rule: HygieneRule
}

export interface TokenHygieneOptions {
  /** Project-defined semantic color names that are allowed even with a numeric shade suffix. */
  allowedColorNames?: string[]
  /** Fail on any <style> block found in scanned files (project convention). */
  forbidStyleBlocks?: boolean
}

interface HygieneBaselineEntry {
  file: string
  line: number
  /** Substring of the violating class/snippet — matched via `includes`. */
  pattern: string
}

export interface TokenHygieneBaseline {
  grandfathered: HygieneBaselineEntry[]
}

// Matches utility-prefix + color-name + numeric shade, e.g. bg-red-500, text-slate-700,
// border-emerald-100, ring-2 is NOT matched (single digit, no color-name segment).
const RAW_PALETTE_PATTERN = /\b(bg|text|border|ring|from|to|via)-([a-z][a-z-]*)-(\d{2,3})\b/g

const STYLE_BLOCK_PATTERN = /<style[\s>]/

/** Rule: raw palette utility classes (project-agnostic — no baked-in color list). */
function checkRawPalette(files: HygieneFile[], allowedColorNames: Set<string>): HygieneViolation[] {
  const violations: HygieneViolation[] = []
  for (const f of files) {
    const lines = f.content.split('\n')
    lines.forEach((line, index) => {
      RAW_PALETTE_PATTERN.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = RAW_PALETTE_PATTERN.exec(line)) !== null) {
        const colorName = match[2] ?? ''
        if (allowedColorNames.has(colorName)) continue
        violations.push({
          file: f.path,
          line: index + 1,
          snippet: match[0],
          rule: 'raw-palette',
        })
      }
    })
  }
  return violations
}

/** Rule: forbidden <style> blocks (opt-in via options.forbidStyleBlocks). */
function checkStyleBlocks(files: HygieneFile[]): HygieneViolation[] {
  const violations: HygieneViolation[] = []
  for (const f of files) {
    const lines = f.content.split('\n')
    lines.forEach((line, index) => {
      if (STYLE_BLOCK_PATTERN.test(line)) {
        violations.push({
          file: f.path,
          line: index + 1,
          snippet: line.trim(),
          rule: 'style-block',
        })
      }
    })
  }
  return violations
}

/** Scans files for token-hygiene violations. */
export function scanTokenHygiene(
  files: HygieneFile[],
  options: TokenHygieneOptions = {},
): HygieneViolation[] {
  const allowedColorNames = new Set(options.allowedColorNames ?? [])
  const violations = checkRawPalette(files, allowedColorNames)
  if (options.forbidStyleBlocks) {
    violations.push(...checkStyleBlocks(files))
  }
  return violations
}

/**
 * Ratchet: partitions violations into "tolerated" (exact file+line+pattern match in the
 * baseline — grandfathered debt) and "new" (not baselined — fails the gate). The baseline
 * can only shrink over time: nothing here lets a new violation silently join it.
 */
export function applyBaseline(
  violations: HygieneViolation[],
  baseline: TokenHygieneBaseline,
): { newViolations: HygieneViolation[]; tolerated: HygieneViolation[] } {
  const newViolations: HygieneViolation[] = []
  const tolerated: HygieneViolation[] = []

  for (const v of violations) {
    const isGrandfathered = baseline.grandfathered.some(
      (entry) =>
        entry.file === v.file && entry.line === v.line && v.snippet.includes(entry.pattern),
    )
    if (isGrandfathered) {
      tolerated.push(v)
    } else {
      newViolations.push(v)
    }
  }

  return { newViolations, tolerated }
}

/** Baseline entries with no matching current violation — debt paid down, safe to prune. */
export function findStaleBaselineEntries(
  baseline: TokenHygieneBaseline,
  violations: HygieneViolation[],
): HygieneBaselineEntry[] {
  return baseline.grandfathered.filter(
    (entry) =>
      !violations.some(
        (v) => v.file === entry.file && v.line === entry.line && v.snippet.includes(entry.pattern),
      ),
  )
}

/** Gate: passes only when zero new (non-baselined) violations remain. */
export function isTokenHygieneGatePass(newViolations: HygieneViolation[]): boolean {
  return newViolations.length === 0
}
