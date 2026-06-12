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
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { FatalError } from '../utils/errors.js'

export const GENERATED_MANIFEST_FILE = '.arbiter-generated-manifest.json'

const CURRENT_MANIFEST_VERSION = 1

interface GeneratedManifestV1 {
  $schemaVersion: 1
  files: Record<string, string>
}

/**
 * Compute the stable manifest key for a written file: posix-normalized path
 * relative to `targetDir`. Returns `null` when the path is absolute-outside or
 * escapes `targetDir` (`..`) — the recorder skips + warns rather than committing
 * a non-portable key (A7). Backslashes are normalized to `/` so a Windows/WSL
 * author cannot desync the keys from a posix-committed manifest.
 */
export function manifestKey(targetDir: string, filePath: string): string | null {
  const rel = relative(targetDir, filePath).replace(/\\/g, '/')
  if (rel === '' || rel.startsWith('../') || rel === '..' || isAbsolute(rel)) return null
  return rel
}

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
  const raw = readFileSync(path, 'utf-8')
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

function isManifestShape(v: unknown): v is GeneratedManifestV1 {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  // Version must match exactly — a future V2 manifest read by this code fails
  // closed rather than being mis-parsed under V1 semantics.
  if (obj['$schemaVersion'] !== CURRENT_MANIFEST_VERSION) return false
  const files = obj['files']
  if (typeof files !== 'object' || files === null || Array.isArray(files)) return false
  return Object.values(files as Record<string, unknown>).every((h) => typeof h === 'string')
}

/**
 * Persist the manifest atomically (tmp-file + rename). NO rotateBackup: a
 * `.arbiter-generated-manifest.json.bak.*` sibling would NOT match the template
 * `.gitignore`'s specific `.arbiter-generated.json.bak.*` pattern and would leak
 * into fleet commits; the manifest is deterministic/regenerated, so no backup is
 * warranted.
 */
export function saveGeneratedManifest(dir: string, files: Record<string, string>): void {
  const path = join(dir, GENERATED_MANIFEST_FILE)
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
  const envelope: GeneratedManifestV1 = { $schemaVersion: CURRENT_MANIFEST_VERSION, files: sorted }
  const body = JSON.stringify(envelope, null, 2) + '\n'
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.arbiter-tmp-${randomBytes(4).toString('hex')}`
  try {
    writeFileSync(tmp, body, 'utf-8')
    renameSync(tmp, path)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      // best-effort cleanup; the primary error takes precedence.
    }
    throw err
  }
}
