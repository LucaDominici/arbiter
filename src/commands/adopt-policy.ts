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
  /**
   * #2141 (mirrors #2119): opt IN to force-adopting the governance class
   * (`AGENTS.md`, `.claude/settings.json`) over a user-modified copy.
   * Withholding it is the default.
   *
   * The template render is not a superset of a governed consumer's file.
   * Measured on one such consumer, a nude update stripped `$CLAUDE_PROJECT_DIR`
   * from 9 hook registrations, unquoted `PreToolUse:Edit|Write` so its pipe
   * became a shell pipe and the hooks stopped firing, and dropped about 175
   * lines from `AGENTS.md`. This explicit, destructive opt-in preserves the
   * #2119 superset principle while a pristine governance file still refreshes.
   */
  adoptGovernance?: boolean
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
 * Governance-class files (`AGENTS.md`, `.claude/settings.json`) follow the
 * same #2119 superset principle since #2141: they are WITHHELD by default and
 * adopted only under explicit `adoptGovernance`. The classes stay independent.
 * `adopt` broadens to every withheld file.
 * `refreshDerived` (#1983) broadens it to exactly the codex-track derived
 * file set, independent of `adopt`/`noAdoptSafety`. Exported for unit testing
 * independent of the filesystem.
 *
 * The predicate receives `provenanceKnown` (the file has a recorded manifest
 * baseline). Class policy differs:
 *  - safety class (`.claude/hooks/*.mjs`) adopts by default REGARDLESS of
 *    provenance — the documented contract (update.ts `noAdoptSafety`): hook
 *    enforcement must stay current on every update, and `onAdopt` persists a
 *    reversible local-override record, so a hand-customized hook is preserved
 *    (in `.arbiter/evidence/local-overrides/`), not lost. Provenance-gating
 *    the safety class here made `arbiter update` silently stop refreshing
 *    hooks on manifest-less consumers (the Consumer Reliability Bar caught it).
 *  - informative classes (gate spine, governance, derived) stay
 *    provenance-gated (#2220): a file with no manifest entry is withheld and
 *    preserved, never clobbered.
 */
export function buildAdoptPredicate(
  options: AdoptPolicyOptions,
): (key: string, provenanceKnown: boolean) => boolean {
  const adoptAll = options.adopt === true
  const adoptSafety = options.noAdoptSafety !== true
  const adoptGateSpine = options.adoptGateSpine === true
  const adoptGovernance = options.adoptGovernance === true
  const refreshDerived = options.refreshDerived === true
  return (key: string, provenanceKnown: boolean): boolean =>
    adoptAll ||
    (adoptSafety && isSafetyClassKey(key)) ||
    (provenanceKnown && adoptGateSpine && isGateSpineKey(key)) ||
    (provenanceKnown && adoptGovernance && isGovernanceClassKey(key)) ||
    (provenanceKnown && refreshDerived && isDerivedTrackKey(key))
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
      'update --adopt-governance: governance file force-adopted over locally-modified content — ' +
      'AGENTS.md carries the Iron Laws and .claude/settings.json the ARBITER_* ' +
      'deny list; this now happens only under explicit --adopt-governance ' +
      '(#2056, #2120, #2141; mark the file `arbiter:preserve` to freeze it)'
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
