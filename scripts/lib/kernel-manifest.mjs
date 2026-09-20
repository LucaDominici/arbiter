// SPDX-License-Identifier: Apache-2.0
// CATALOG: Output manifest + manifest-scoped prune for build-kernel-plugin.mjs (#2763). The
// CATALOG: writer only ever overwrote its current outputs, so a removed/renamed output left a
// CATALOG: stale file that check-kernel-plugin-parity.mjs rejected until deleted by hand. Rejected
// CATALOG: "delete everything in the root that is not emitted": that would silently delete a
// CATALOG: hand-added foreign file, making a regen turn the tree green over a file the parity gate
// CATALOG: (CANON-25) exists to reject. Provenance is persisted instead: the manifest lists what
// CATALOG: the last build emitted, and only entries that dropped out of it are removed.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export const MANIFEST = '.kernel-build-manifest.json'

/**
 * Remove the files the previous build recorded in `outDir`'s manifest that `emitted` no
 * longer names, then record `emitted` as the new manifest. Returns the pruned names.
 * An entry that is not a plain file name (`../x`, `a/b`) throws before anything is deleted
 * (INV-96 fail-closed): the prune can never reach outside `outDir`.
 */
export function syncManifest(outDir, emitted) {
  const manifestPath = join(outDir, MANIFEST)
  const previous = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf-8')).files
    : []
  for (const name of previous) {
    if (typeof name !== 'string' || name !== basename(name) || name === '..' || name === '.') {
      throw new Error(`${MANIFEST} entry ${JSON.stringify(name)} is not a plain file name`)
    }
  }
  const stale = previous.filter((name) => !emitted.includes(name))
  for (const name of stale) rmSync(join(outDir, name), { force: true })
  writeFileSync(manifestPath, JSON.stringify({ files: emitted }, null, 2) + '\n', 'utf-8')
  return stale
}
