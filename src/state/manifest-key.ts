// SPDX-License-Identifier: Apache-2.0
// #1991: `manifestKey` lives in its own LEAF module so `src/utils/fs.ts` can reach it
// without importing `generated-manifest.ts`.
//
// The façade consolidation made `generated-manifest.ts` route its atomic tmp+rename
// through `utils/fs.ts` — but `utils/fs.ts` needed `manifestKey`, which closed a
// `no-circular` cycle (.dependency-cruiser). Pinning the manifest out of the façade would
// have left arbiter's own second atomic-write implementation as the one place a raw errno
// still leaked, which is precisely what CANON-17 forbids. Extracting the pure path helper
// — no I/O, no imports beyond node:path — costs one small file and removes the pin
// entirely. `generated-manifest.ts` re-exports it, so every existing importer is unchanged.
import { relative, isAbsolute } from 'node:path'

/**
 * Manifest key for `filePath` within `targetDir`: the target-relative POSIX path, or
 * `null` when the path is not relative (absolute, escaping via `../`, or the dir itself).
 * Portable across machines by construction — an absolute path in a manifest would not
 * survive a clone.
 */
export function manifestKey(targetDir: string, filePath: string): string | null {
  const rel = relative(targetDir, filePath).replace(/\\/g, '/')
  if (rel === '' || rel.startsWith('../') || rel === '..' || isAbsolute(rel)) return null
  return rel
}
