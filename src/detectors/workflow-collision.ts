// SPDX-License-Identifier: Apache-2.0
// #1502 / PORT B2 — legacy-workflow reconciliation.
//
// `arbiter update` ADDS the numbered workflows (01-pr-fast, 05-release, …) into a
// target's .github/workflows/ WITHOUT removing pre-existing LEGACY workflows whose
// TRIGGERS now collide. Two concrete foot-guns the adversarial review #1502 caught
// in a live GA repo:
//   - a legacy `release.yml` on `push: tags: ['v*.*.*']` racing the new
//     `05-release.yml` (`push: tags: ['v*']`) → two signing/SBOM runs on one tag;
//   - a legacy `ci.yml` on `push`+`pull_request` double-running 01-pr-fast on every
//     PR and push.
//
// This detector scans the target's existing workflow files for NON-arbiter
// workflows whose trigger class (PR/push, release tags, schedule) overlaps an
// emitted numbered workflow and surfaces a LOUD, conservative warning. It NEVER
// deletes a user file — reconciliation is the operator's call.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/** Trigger overlap classes a legacy workflow can fall into. */
export type TriggerClass = 'pr-push' | 'tags' | 'schedule'

export interface LegacyCollision {
  /** The pre-existing (non-arbiter) workflow filename. */
  legacyFile: string
  /** Which trigger class collides. */
  triggerClass: TriggerClass
  /** The emitted numbered workflow that supersedes it (first present candidate). */
  supersededBy: string
  /** Recommended reconciliation action. */
  recommendation: string
}

// Arbiter authors numbered (`NN-…`) workflows, underscore-prefixed reusable
// helpers (`_sigstore-retry-sign`, `_label-on-approve`, …), and a tiny fixed set.
// Anything else in the workflows dir is a pre-existing/user (legacy) workflow.
const FIXED_ARBITER_WORKFLOWS = new Set(['issue-state.yml', 'drift-shadow.yml'])

/** True when arbiter authored this workflow filename (not a legacy user file). */
export function isArbiterOwnedWorkflow(file: string): boolean {
  if (file.startsWith('_')) return true
  if (/^\d{2}-.*\.ya?ml$/.test(file)) return true
  return FIXED_ARBITER_WORKFLOWS.has(file)
}

// Curated, conservative class → superseding-candidate map. A collision only fires
// when at least one candidate is actually PRESENT among the emitted numbered set,
// so we never warn about a workflow that nothing supersedes.
const SUPERSEDING: Record<TriggerClass, { candidates: string[]; recommendation: string }> = {
  'pr-push': {
    candidates: ['01-pr-fast.yml', '02-pr-extended.yml'],
    recommendation:
      'retire this legacy CI workflow or fold its unique steps into the numbered PR set ' +
      '(it now double-runs on every PR/push)',
  },
  tags: {
    candidates: ['05-release.yml'],
    recommendation:
      'retire this legacy release workflow or fold its unique steps into 05-release.yml ' +
      '(a version tag now triggers TWO signing/SBOM/release runs that race on one tag)',
  },
  schedule: {
    candidates: [
      '06-nightly.yml',
      '06-nightly-lite.yml',
      '07-weekly.yml',
      '07-weekly-lite.yml',
      '08-monthly.yml',
      '12-mutation-scheduled.yml',
    ],
    recommendation:
      'retire this legacy scheduled workflow or fold it into the numbered ' +
      'nightly/weekly/monthly cadence',
  },
}

/** Deterministic emit order so the warning text is stable. */
const CLASS_ORDER: TriggerClass[] = ['pr-push', 'tags', 'schedule']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A non-empty value under a push sub-key (`tags`, `branches`). */
function hasKey(cfg: unknown, key: string): boolean {
  return isRecord(cfg) && key in cfg
}

function classifyPush(cfg: unknown, classes: Set<TriggerClass>): void {
  const onTags = hasKey(cfg, 'tags') || hasKey(cfg, 'tags-ignore')
  const onBranches = hasKey(cfg, 'branches') || hasKey(cfg, 'branches-ignore')
  if (onTags) classes.add('tags')
  // push scoped to branches, or an unscoped push (= every branch), is PR/push CI.
  if (onBranches || !onTags) classes.add('pr-push')
}

function addEvent(name: string, cfg: unknown, classes: Set<TriggerClass>): void {
  if (name === 'pull_request' || name === 'pull_request_target') classes.add('pr-push')
  else if (name === 'push') classifyPush(cfg, classes)
  else if (name === 'schedule') classes.add('schedule')
}

/**
 * Classify a GitHub `on:` spec into the set of collision trigger classes. Accepts
 * every legal `on` shape: a bare string, an array of event names, or a map of
 * event → config. Pure; exported for direct unit testing.
 */
export function classifyTriggers(onSpec: unknown): Set<TriggerClass> {
  const classes = new Set<TriggerClass>()
  if (onSpec == null) return classes
  if (typeof onSpec === 'string') {
    addEvent(onSpec, undefined, classes)
  } else if (Array.isArray(onSpec)) {
    for (const e of onSpec) if (typeof e === 'string') addEvent(e, undefined, classes)
  } else if (isRecord(onSpec)) {
    for (const key of Object.keys(onSpec)) addEvent(key, onSpec[key], classes)
  }
  return classes
}

/** Read and parse a workflow file's `on:` spec; null on missing/malformed YAML. */
function readWorkflowOn(path: string): unknown {
  try {
    const parsed: unknown = parseYaml(readFileSync(path, 'utf8'))
    if (!isRecord(parsed)) return null
    // YAML 1.2 keeps `on` a string key; tolerate a 1.1 parser that booleanizes it.
    return parsed['on'] ?? parsed[String(true)] ?? null
  } catch {
    return null
  }
}

/**
 * Scan `<targetDir>/.github/workflows/` for pre-existing (non-arbiter) workflows
 * whose trigger class collides with an emitted numbered workflow that is present.
 * Returns one entry per (legacy file × colliding class). Deterministically ordered.
 */
export function detectLegacyWorkflowCollisions(targetDir: string): LegacyCollision[] {
  const dir = join(targetDir, '.github', 'workflows')
  if (!existsSync(dir)) return []
  const all = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))
  const present = new Set(all.filter(isArbiterOwnedWorkflow))
  if (present.size === 0) return []
  const legacy = all.filter((f) => !isArbiterOwnedWorkflow(f)).sort()
  const collisions: LegacyCollision[] = []
  for (const file of legacy) {
    const classes = classifyTriggers(readWorkflowOn(join(dir, file)))
    for (const cls of CLASS_ORDER) {
      if (!classes.has(cls)) continue
      const supersededBy = SUPERSEDING[cls].candidates.find((c) => present.has(c))
      if (supersededBy)
        collisions.push({
          legacyFile: file,
          triggerClass: cls,
          supersededBy,
          recommendation: SUPERSEDING[cls].recommendation,
        })
    }
  }
  return collisions
}

const CLASS_LABEL: Record<TriggerClass, string> = {
  'pr-push': 'PR/push CI',
  tags: 'release on version tags',
  schedule: 'scheduled run',
}

/** Render a collision list into a single loud warning string, or null when empty. */
function formatLegacyCollisionWarning(collisions: LegacyCollision[]): string | null {
  if (collisions.length === 0) return null
  const lines = collisions.map(
    (c) =>
      `    - ${c.legacyFile} (${CLASS_LABEL[c.triggerClass]}) collides with ${c.supersededBy} — ` +
      c.recommendation,
  )
  return (
    `Warning: ${collisions.length} legacy workflow trigger collision(s) detected. ` +
    `arbiter update ADDED the numbered workflows but did NOT remove pre-existing workflows whose ` +
    `triggers now overlap — they will double-run, and a legacy release workflow will race a second ` +
    `signing/SBOM run on the same version tag. arbiter never auto-deletes your files; reconcile ` +
    `each collision below (retire the legacy workflow, or fold its unique steps into the numbered ` +
    `one):\n${lines.join('\n')}`
  )
}

/**
 * Top-level B2 detector: scan the target and return a loud reconciliation warning,
 * or null when no legacy workflow collides. Wired into `arbiter update`'s warning
 * channel alongside the #1410 / #1504 gate warnings.
 */
export function detectLegacyWorkflowCollisionWarning(targetDir: string): string | null {
  return formatLegacyCollisionWarning(detectLegacyWorkflowCollisions(targetDir))
}
