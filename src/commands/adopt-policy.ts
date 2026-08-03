// SPDX-License-Identifier: Apache-2.0
import { mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { writeFileTranslated } from '../utils/fs.js'
import {
  isGateSpineKey,
  isGovernanceClassKey,
  isSafetyClassKey,
} from '../generators/safety-class.js'
import { isDerivedTrackKey } from '../generators/derived-class.js'

export interface AdoptPolicyOptions {
  adopt?: boolean
  noAdoptSafety?: boolean
  adoptGateSpine?: boolean
  refreshDerived?: boolean
}

/** One captured adopt decision: a withheld file that the adopt predicate matched. */
export interface AdoptRecord {
  /** targetDir-relative, posix-normalized path. */
  key: string
  /** The user-modified content that was on disk before adoption. */
  priorContent: string
  /** The shipped template content that replaced it (or would, in plan mode). */
  newContent: string
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Build the T1 adopt predicate from CLI flags. Safety-class files
 * (`.claude/hooks/*.mjs`) adopt by default — `noAdoptSafety` is the only way to
 * freeze one deliberately. Gate-spine files (`scripts/check-all.mjs`,
 * `scripts/lib/*.mjs`) are the opposite since #2119: WITHHELD by default,
 * adopted only under an explicit `adoptGateSpine`, because that file is where a
 * project wires its own checks and the template render is not a superset of it.
 * The two stay independent. `adopt` broadens to every withheld file.
 * `refreshDerived` (#1983) broadens it to exactly the codex-track derived
 * file set, independent of `adopt`/`noAdoptSafety`. Exported for unit testing
 * independent of the filesystem.
 */
export function buildAdoptPredicate(options: AdoptPolicyOptions): (key: string) => boolean {
  const adoptAll = options.adopt === true
  const adoptSafety = options.noAdoptSafety !== true
  const adoptGateSpine = options.adoptGateSpine === true
  const refreshDerived = options.refreshDerived === true
  return (key: string): boolean =>
    adoptAll ||
    (adoptSafety && isSafetyClassKey(key)) ||
    (adoptGateSpine && isGateSpineKey(key)) ||
    // #2120: no opt-out flag. These two are force-rendered on every selective
    // update by #2056, so the new provenance test would otherwise freeze them
    // and re-open the #2040 drift. `arbiter:preserve` is the deliberate freeze,
    // and it is checked ahead of every adopt policy.
    isGovernanceClassKey(key) ||
    (refreshDerived && isDerivedTrackKey(key))
}

/**
 * Persist an explicit, reversible local-override record for a force-adopted
 * file (T1). Deliberately human-inspectable JSON, not a stray `.arbiter-
 * backup` sibling: both the prior (user-modified) and new (shipped) content
 * are stored verbatim so the adoption is fully reversible without re-running
 * arbiter or digging through git history.
 */
function localOverrideSlug(key: string): string {
  return key.replace(/^\.+/, '').replace(/[/\\]+/g, '__')
}

/**
 * #1983: the local-override reason must name the actual trigger — a derived-
 * track file refreshed via `--refresh-derived` was not necessarily "user-
 * modified" (it may simply predate a template fix), so the `--adopt` wording
 * would misdescribe it.
 */
function localOverrideReason(key: string): string {
  if (isDerivedTrackKey(key)) {
    return (
      'update --refresh-derived: codex-track derived file force-refreshed to the ' +
      'current template render (skipIfExists bypassed for this known set only)'
    )
  }
  if (isGovernanceClassKey(key)) {
    return (
      'update: governance file force-adopted over locally-modified content — ' +
      'AGENTS.md carries the Iron Laws and .claude/settings.json the ARBITER_* ' +
      'deny list, and both are re-rendered on every update so they cannot go ' +
      'stale (#2056, #2120; mark the file `arbiter:preserve` to freeze it)'
    )
  }
  if (isGateSpineKey(key)) {
    return (
      'update: gate-spine file force-adopted over user-modified content — the gate ' +
      'entrypoint and its libs are the delivery vector for every later fix ' +
      '(#2109, reversed by #2119: this now happens only under explicit --adopt-gate-spine)'
    )
  }
  return (
    'update --adopt: template fix force-adopted over user-modified content ' +
    '(safety-class files adopt by default; see --no-adopt-safety)'
  )
}

export function recordLocalOverride(
  targetDir: string,
  record: AdoptRecord,
  now: () => Date = () => new Date(),
): string {
  const dir = join(targetDir, '.arbiter', 'evidence', 'local-overrides')
  mkdirSync(dir, { recursive: true })
  const envelope = {
    path: record.key,
    adoptedAt: now().toISOString(),
    reason: localOverrideReason(record.key),
    priorContent: record.priorContent,
    priorContentSha256: sha256(record.priorContent),
    newContent: record.newContent,
    newContentSha256: sha256(record.newContent),
  }
  const file = join(dir, `${localOverrideSlug(record.key)}.json`)
  writeFileTranslated(file, JSON.stringify(envelope, null, 2) + '\n')
  return file
}
