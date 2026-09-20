// SPDX-License-Identifier: Apache-2.0
// CATALOG: Output manifest + manifest-scoped prune for build-kernel-plugin.mjs (#2763). The
// CATALOG: writer only ever overwrote its current outputs, so a removed/renamed output left a
// CATALOG: stale file that check-kernel-plugin-parity.mjs rejected until deleted by hand. Rejected
// CATALOG: "delete everything in the root that is not emitted": that would silently delete a
// CATALOG: hand-added foreign file, making a regen turn the tree green over a file the parity gate
// CATALOG: (CANON-25) exists to reject. Provenance is persisted instead: the manifest lists what
// CATALOG: the last build emitted, and only entries that dropped out of it are removed.
// CATALOG: Fail-closed (INV-96, independent review of #2777): nothing is deleted until the WHOLE
// CATALOG: previous manifest and every stale target validated; a symlinked root/manifest, a missing
// CATALOG: manifest in a populated root, or a malformed one throws with a named reason.
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export const MANIFEST = '.kernel-build-manifest.json'

/** lstat (never follows a symlink); `null` only for a genuinely absent path, anything else throws. */
function lstatOrNull(path) {
  try {
    return lstatSync(path)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

function isPlainName(name) {
  return (
    typeof name === 'string' &&
    name !== '' &&
    !name.includes('\0') &&
    name === basename(name) &&
    name !== '.' &&
    name !== '..' &&
    name !== MANIFEST
  )
}

/** The previous build's file list — `[]` for a first build into an empty root; throws otherwise. */
function readPrevious(outDir) {
  const manifestPath = join(outDir, MANIFEST)
  const st = lstatOrNull(manifestPath)
  if (st === null) {
    if (readdirSync(outDir).length > 0) {
      throw new Error(
        `${MANIFEST}: manifest is missing from populated output root ${outDir}; ` +
          'restore it from git (nothing was pruned)',
      )
    }
    return []
  }
  if (st.isSymbolicLink()) throw new Error(`${MANIFEST} is a symlink; refusing to follow it`)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (err) {
    throw new Error(`${MANIFEST}: manifest is malformed (${err.message})`)
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.files)) {
    throw new Error(`${MANIFEST}: manifest is malformed (expected {"files": [...]})`)
  }
  for (const name of parsed.files) {
    if (!isPlainName(name)) {
      throw new Error(`${MANIFEST} entry ${JSON.stringify(name)} is not a plain file name`)
    }
  }
  return parsed.files
}

/**
 * Remove the files the previous build recorded in `outDir`'s manifest that `emitted` no
 * longer names, then record `emitted` as the new manifest. Returns the pruned names.
 * Everything is validated before the first deletion, so a bad manifest or an unsafe target
 * leaves the root untouched: the prune can never reach outside `outDir`. A root whose final
 * component is a symlink is refused (ancestors of the root may legitimately be links).
 */
export function syncManifest(rawOutDir, emitted) {
  // Normalize ONCE, before any check: lstat('link/') follows the link, so a trailing
  // separator would otherwise turn a symlinked root into its (external) target directory.
  const outDir = resolve(rawOutDir)
  const rootStat = lstatOrNull(outDir)
  if (rootStat === null) mkdirSync(outDir, { recursive: true })
  else if (rootStat.isSymbolicLink()) {
    throw new Error(`output root ${outDir} is a symlink; refusing to prune through it`)
  }
  const stale = readPrevious(outDir).filter((name) => !emitted.includes(name))
  for (const name of stale) {
    const st = lstatOrNull(join(outDir, name))
    // a listed symlink is unlinked itself (rmSync never follows it); a directory is not ours
    if (st !== null && !st.isFile() && !st.isSymbolicLink()) {
      throw new Error(`${MANIFEST} entry ${JSON.stringify(name)} is not a regular file`)
    }
  }
  for (const name of stale) rmSync(join(outDir, name), { force: true })
  writeFileSync(join(outDir, MANIFEST), JSON.stringify({ files: emitted }, null, 2) + '\n', 'utf-8')
  return stale
}
