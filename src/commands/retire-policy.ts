// SPDX-License-Identifier: Apache-2.0
/**
 * Retirement policy (#2221) — the mirror image of `adopt-policy.ts`.
 *
 * `update`'s non-decreasing contract (#2135) says a project keeps what it added.
 * The other half was missing: the framework must also be able to take back what
 * it RETIRED. An arbiter-owned hook deleted from arbiter (e.g.
 * `pre-task-track-detect.mjs` in 647c3373) survives in every consumer generated
 * by an older version — routed by nothing, referenced by nothing, and flagged
 * `DEAD Arbiter-owned hook` by the consumer's own `check-hook-routing.mjs` on
 * every run, forever. Without retirement every arbiter cleanup leaves permanent
 * detritus in every consumer.
 *
 * The boundary is deliberately narrow, because deleting from a user's repo is
 * destructive:
 *   - Only the SAFETY CLASS (`.claude/hooks/*.mjs`) is ever deleted. It is the
 *     one class where the file is wholly arbiter's (the same superset property
 *     `isSafetyClassKey` already encodes for adoption) and where an orphan is
 *     ACTIVELY harmful rather than merely inert. Deleting a prior-only
 *     `scripts/check-*.mjs` could break a consumer whose user-modified
 *     `check-all.mjs` still invokes it — a worse failure than the detritus.
 *   - Only a PRISTINE file is deleted: sha256(disk) must equal the render hash
 *     the manifest recorded. A user-modified orphan is REPORTED, never removed.
 *   - Only on a FULL registry run. On a selective run the un-visited generators
 *     simply did not execute, which is not evidence of retirement.
 *
 * Everything else prior-only is reported, never touched: prior-only is not the
 * same as retired-by-the-framework (a governance downgrade, a deselected tool or
 * a detection flip produces the same signal), so the report is the evidence for
 * widening this later, not a licence to delete now.
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { manifestKey } from '../state/generated-manifest.js'
import { RETIRED_RENDERS } from '../state/retired-renders.js'
import { isSafetyClassKey } from '../generators/safety-class.js'
import type { WriteResult } from '../utils/fs.js'

export interface RetirementPlan {
  /** Pristine safety-class files the framework no longer emits — deleted. */
  retire: string[]
  /** Safety-class orphans that are user-modified — reported, never deleted. */
  orphans: string[]
  /** Prior-only files outside the safety class — reported only. */
  stale: string[]
}

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Read the on-disk hash for a manifest key. `null` when the file is gone or
 * unreadable — the retirement decision then has nothing to do. Injected as a
 * seam so {@link planRetirement} stays a pure decision.
 */
export function diskHasher(targetDir: string): (key: string) => string | null {
  return (key: string): string | null => {
    const path = join(targetDir, key)
    if (!existsSync(path)) return null
    try {
      return createHash('sha256').update(readFileSync(path)).digest('hex')
      // FAIL-OPEN-INTENT: an unreadable file is not proven pristine, so retirement leaves it untouched.
    } catch {
      return null
    }
  }
}

/**
 * Partition the manifest keys this run did NOT visit into delete / report
 * buckets. VISITED is every file the registry produced a {@link WriteResult}
 * for — including a withheld or deliberately-not-applicable one. A withheld
 * file was visited (its generator still emits it, the write was preserved), so
 * it is never a retirement candidate; getting that predicate wrong would delete
 * live hooks. Pure: all filesystem access goes through `diskHash`.
 */
export function planRetirement(opts: {
  prevManifest: Record<string, string>
  results: WriteResult[]
  targetDir: string
  fullRegistryRun: boolean
  diskHash: (key: string) => string | null
}): RetirementPlan {
  const plan: RetirementPlan = { retire: [], orphans: [], stale: [] }
  if (!opts.fullRegistryRun) return plan
  const visited = new Set(
    opts.results
      .map((r) => manifestKey(opts.targetDir, r.path))
      .filter((k): k is string => k !== null),
  )
  // Candidates come from two independent ownership records: the target's own
  // manifest, and arbiter's registry of renders it once emitted for a path it
  // has since retired. The second exists because the first is not universal —
  // the go consumer that reddens the bar has no manifest at its pinned commit.
  const candidates = new Set([...Object.keys(opts.prevManifest), ...Object.keys(RETIRED_RENDERS)])
  for (const key of candidates) {
    if (visited.has(key)) continue
    const onDisk = opts.diskHash(key)
    if (onDisk === null) continue
    if (!isSafetyClassKey(key)) plan.stale.push(key)
    else if (onDisk === opts.prevManifest[key] || (RETIRED_RENDERS[key] ?? []).includes(onDisk))
      plan.retire.push(key)
    else plan.orphans.push(key)
  }
  plan.retire.sort(byKey)
  plan.orphans.sort(byKey)
  plan.stale.sort(byKey)
  return plan
}

/**
 * Delete the retired files. Runs BEFORE the manifest is persisted so a failed
 * unlink can never leave a file on disk with its ownership record already gone
 * (an unattributable orphan forever). A file that cannot be deleted is demoted
 * to the reported-orphan bucket rather than silently claimed as retired.
 */
export function applyRetirement(targetDir: string, plan: RetirementPlan): void {
  for (const key of [...plan.retire]) {
    try {
      unlinkSync(join(targetDir, key))
      // FAIL-OPEN-INTENT: unlink failure is surfaced as a reported orphan in the caller's retirement warning.
    } catch {
      plan.retire = plan.retire.filter((k) => k !== key)
      plan.orphans = [...plan.orphans, key].sort(byKey)
    }
  }
}

/**
 * The operator-facing report. Retirement is loud by construction: a deletion in
 * someone else's repo is never buried in a skipped count, and the two
 * non-destructive buckets say exactly what the operator has to do by hand.
 */
export function retirementWarning(plan: RetirementPlan): string | null {
  const sections: string[] = []
  if (plan.retire.length > 0) {
    sections.push(
      `Retired ${plan.retire.length} arbiter-owned file(s) this version no longer emits ` +
        `(unmodified since arbiter wrote them, so removal is lossless): ${plan.retire.join(', ')}`,
    )
  }
  if (plan.orphans.length > 0) {
    sections.push(
      `Warning: ${plan.orphans.length} arbiter-owned file(s) are no longer emitted but were ` +
        `edited locally, so they were left in place — delete them by hand once you have ` +
        `salvaged your changes: ${plan.orphans.join(', ')}`,
    )
  }
  if (plan.stale.length > 0) {
    sections.push(
      `Note: ${plan.stale.length} previously generated file(s) were not emitted by this run ` +
        `(a retired template, or a generator this config no longer selects). They are left ` +
        `untouched — review before deleting: ${plan.stale.join(', ')}`,
    )
  }
  return sections.length > 0 ? sections.join('\n') : null
}
