// SPDX-License-Identifier: Apache-2.0
/**
 * `.arbiter-generated-manifest.json` — per-file content-hash provenance (#1328).
 *
 * A sidecar to `.arbiter-generated.json`, kept at the repo ROOT (NOT under the
 * blanket-ignored `.arbiter/`) so it is committed by default and travels with
 * the repo — the prerequisite for a governed fleet to ever inherit template
 * fixes via `arbiter update`.
 *
 * It maps each arbiter-emitted file (targetDir-relative, posix-normalized) to
 * the SHA-256 of arbiter's last canonical render. `update` consults it to tell a
 * pristine (unmodified-since-generation) `skipIfExists` file — which it may
 * safely rewrite to propagate a fix — from a user-modified one it must preserve.
 *
 * Deliberately NOT inside the checksummed `.arbiter-generated.json` envelope:
 * `doctor --repair-state` re-derives that from `arbiter.json`, but file hashes
 * are NOT derivable from config. Integrity is the repo's git history, not an
 * in-file checksum: a corrupt/forged manifest is bounded to skip-or-overwrite of
 * two known canonical renders, both recoverable via git + `arbiter diff`.
 */
import { existsSync } from 'node:fs'
// #1991: re-exported from its leaf module so utils/fs.ts can import it without a cycle.
export { manifestKey } from './manifest-key.js'
import {
  ensureDir,
  renameTranslated,
  unlinkTranslated,
  writeFileTranslated,
  readFileTranslated,
} from '../utils/fs.js'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { FatalError } from '../utils/errors.js'

export const GENERATED_MANIFEST_FILE = '.arbiter-generated-manifest.json'

const CURRENT_MANIFEST_VERSION = 1

interface GeneratedManifestV1 {
  $schemaVersion: 1
  files: Record<string, string>
  /**
   * #1504 (M1): targetDir-relative paths of delivered guard scripts that are
   * SHIPPED-BUT-UNWIRED — present on disk (and tracked in `files`) but NOT invoked
   * by the project's effective gate because `scripts/check-all.mjs` is withheld
   * (user-modified, so the template fix that wires them was preserved, not applied).
   *
   * The honest counterpart to the post-update unwired-gate warning: a downstream
   * reader/auditor that trusts `files` as "delivered protection" would otherwise
   * over-read a guard that never runs. Listing it here records the gap instead of
   * silently claiming delivery. Omitted entirely when there is no gap (clean
   * manifests stay byte-identical — no fleet-wide churn).
   */
  unwiredGuards?: string[]
  /**
   * T1 (convergence playbook): targetDir-relative paths of safety-class files
   * (`.claude/hooks/*.mjs`) that are CURRENTLY WITHHELD — user-modified, so
   * the last `update` preserved them rather than landing the shipped fix.
   *
   * Recorded on every `update`/`init` run, mirroring {@link unwiredGuards}'s
   * honest-status shape: with `--adopt-safety` on (the default) this list is
   * normally empty because the divergence is closed at write-time; it is
   * non-empty only when adoption was explicitly disabled
   * (`--no-adopt-safety`) or the file could not be adopted. The ratchet gate
   * (`check-safety-adopt-ratchet.mjs`) reads this list and FAILS when it is
   * non-empty — the erosion this section exists to make visible can no
   * longer hide behind a silent "skipped".
   */
  withheldSafety?: string[]
}

/**
 * Compute the stable manifest key for a written file: posix-normalized path
 * relative to `targetDir`. Returns `null` when the path is absolute-outside or
 * escapes `targetDir` (`..`) — the recorder skips + warns rather than committing
 * a non-portable key (A7). Backslashes are normalized to `/` so a Windows/WSL
 * author cannot desync the keys from a posix-committed manifest.
 */

/**
 * Load the manifest's `files` map.
 *   - Missing file → `{}` (legitimate first run; conservative-skip is correct).
 *   - Present-but-unparseable → THROW (fail-closed, A5/INV-96): silently coercing
 *     a corrupt manifest to empty would withhold every fix fleet-wide while
 *     exiting 0 — the exact failure #1328 exists to kill.
 */
export function loadGeneratedManifest(dir: string): Record<string, string> {
  const path = join(dir, GENERATED_MANIFEST_FILE)
  if (!existsSync(path)) return {}
  const raw = readFileTranslated(path, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    // Fail CLOSED with a FATAL error (exit 2 per INV-53/INV-122) — never coerce a
    // corrupt manifest to empty, which would silently withhold template fixes.
    throw new FatalError(
      'E_MANIFEST_CORRUPT',
      `${GENERATED_MANIFEST_FILE} is present but unparseable (${err instanceof Error ? err.message : String(err)}). ` +
        `Refusing to treat a corrupt manifest as empty (would silently withhold template fixes). ` +
        `Fix the JSON or delete the file to re-baseline on the next \`arbiter update\`.`,
    )
  }
  if (!isManifestShape(parsed)) {
    throw new FatalError(
      'E_MANIFEST_SHAPE',
      `${GENERATED_MANIFEST_FILE} has an invalid shape or unsupported $schemaVersion ` +
        `(expected { "$schemaVersion": ${CURRENT_MANIFEST_VERSION}, "files": { <path>: <sha256> } }). ` +
        `Fix or delete the file to re-baseline on the next \`arbiter update\`.`,
    )
  }
  return parsed.files
}

/**
 * Read the honest shipped-but-unwired guard list (#1504/M1). Returns `[]` for a
 * missing manifest or one with no gap. Shares the same fail-closed load path as
 * {@link loadGeneratedManifest}: a corrupt/wrong-shape manifest THROWS rather than
 * masking the gap. The downstream counterpart to the post-update warning — an
 * auditor calls this to see which delivered guards never run.
 */
export function loadUnwiredGuards(dir: string): string[] {
  const path = join(dir, GENERATED_MANIFEST_FILE)
  if (!existsSync(path)) return []
  const raw = readFileTranslated(path, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new FatalError(
      'E_MANIFEST_CORRUPT',
      `${GENERATED_MANIFEST_FILE} is present but unparseable (${err instanceof Error ? err.message : String(err)}).`,
    )
  }
  if (!isManifestShape(parsed)) {
    throw new FatalError(
      'E_MANIFEST_SHAPE',
      `${GENERATED_MANIFEST_FILE} has an invalid shape or unsupported $schemaVersion.`,
    )
  }
  return parsed.unwiredGuards ?? []
}

/**
 * Read the honest currently-withheld-safety-class list (T1). Same fail-closed
 * load path as {@link loadGeneratedManifest} / {@link loadUnwiredGuards}: a
 * corrupt/wrong-shape manifest THROWS rather than masking the gap. This is
 * what `check-safety-adopt-ratchet.mjs` calls.
 */
export function loadWithheldSafety(dir: string): string[] {
  const path = join(dir, GENERATED_MANIFEST_FILE)
  if (!existsSync(path)) return []
  const raw = readFileTranslated(path, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new FatalError(
      'E_MANIFEST_CORRUPT',
      `${GENERATED_MANIFEST_FILE} is present but unparseable (${err instanceof Error ? err.message : String(err)}).`,
    )
  }
  if (!isManifestShape(parsed)) {
    throw new FatalError(
      'E_MANIFEST_SHAPE',
      `${GENERATED_MANIFEST_FILE} has an invalid shape or unsupported $schemaVersion.`,
    )
  }
  return parsed.withheldSafety ?? []
}

function isManifestShape(v: unknown): v is GeneratedManifestV1 {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  // Version must match exactly — a future V2 manifest read by this code fails
  // closed rather than being mis-parsed under V1 semantics.
  if (obj['$schemaVersion'] !== CURRENT_MANIFEST_VERSION) return false
  const files = obj['files']
  if (typeof files !== 'object' || files === null || Array.isArray(files)) return false
  if (!Object.values(files as Record<string, unknown>).every((h) => typeof h === 'string'))
    return false
  // Optional honest-status section (#1504/M1): when present it MUST be a string[]
  // — a malformed unwiredGuards fails closed rather than being silently dropped,
  // which would re-hide the gap it exists to surface.
  const unwired = obj['unwiredGuards']
  if (unwired !== undefined) {
    if (!Array.isArray(unwired) || !unwired.every((s) => typeof s === 'string')) return false
  }
  // T1: same malformed-fails-closed contract as unwiredGuards — a bad
  // withheldSafety must not be silently dropped (that would re-hide erosion).
  const withheldSafety = obj['withheldSafety']
  if (withheldSafety !== undefined) {
    if (!Array.isArray(withheldSafety) || !withheldSafety.every((s) => typeof s === 'string'))
      return false
  }
  return true
}

/**
 * Persist the manifest atomically (tmp-file + rename). NO rotateBackup: a
 * `.arbiter-generated-manifest.json.bak.*` sibling would NOT match the template
 * `.gitignore`'s specific `.arbiter-generated.json.bak.*` pattern and would leak
 * into fleet commits; the manifest is deterministic/regenerated, so no backup is
 * warranted.
 */
export function saveGeneratedManifest(
  dir: string,
  files: Record<string, string>,
  unwiredGuards: string[] = [],
  withheldSafety: string[] = [],
): void {
  const path = join(dir, GENERATED_MANIFEST_FILE)
  // Codepoint order, NOT `localeCompare`: the manifest is a committed, deterministically
  // regenerated integrity file, so its byte layout must be locale-independent (#1601).
  const sorted = Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  const envelope: GeneratedManifestV1 = { $schemaVersion: CURRENT_MANIFEST_VERSION, files: sorted }
  // Only attach the honest-status section when there IS a gap, so a clean update
  // leaves the manifest byte-identical to today (no fleet-wide diff churn). The
  // list is re-derived every update, so wiring the gate later clears it.
  if (unwiredGuards.length > 0) {
    envelope.unwiredGuards = [...new Set(unwiredGuards)].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
  }
  // T1: same re-derived-every-update, omit-when-empty contract as unwiredGuards.
  if (withheldSafety.length > 0) {
    envelope.withheldSafety = [...new Set(withheldSafety)].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
  }
  const body = JSON.stringify(envelope, null, 2) + '\n'
  ensureDir(dirname(path))
  const tmp = `${path}.arbiter-tmp-${randomBytes(4).toString('hex')}`
  try {
    writeFileTranslated(tmp, body)
    renameTranslated(tmp, path)
  } catch (err) {
    try {
      unlinkTranslated(tmp)
    } catch {
      // best-effort cleanup; the primary error takes precedence.
    }
    throw err
  }
}
