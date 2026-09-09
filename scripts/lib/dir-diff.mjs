// SPDX-License-Identifier: Apache-2.0
// CATALOG: Pure byte-level directory-diff helper (#2548). Extracted from
// CATALOG: regenerate-examples.mjs (diffDirs, #2222) rather than duplicated a
// CATALOG: second time in check-kernel-plugin-parity.mjs — both compare a
// CATALOG: COMMITTED tree against a FRESHLY REGENERATED one by relative path +
// CATALOG: byte content and need identical removed/added/changed semantics.
//
// removed: present in `committedDir` but not in `freshDir` (an extra file the
//          generator no longer emits, or never emitted).
// added:   present in `freshDir` but not in `committedDir` (a file the generator
//          emits that was never committed, or was deleted from the committed copy).
// changed: present in both, byte-different.
//
// `.git` directories are skipped (a fixture staged as a real repo carries one).
// A missing `committedDir` is treated as empty (every fresh file reports as
// "added") rather than an error — fail-closed for the caller, never a vacuous
// pass from a directory that does not exist yet.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

function listFiles(dir) {
  const out = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current)) {
      if (entry === '.git') continue
      const full = join(current, entry)
      const st = statSync(full)
      if (st.isDirectory()) {
        stack.push(full)
      } else {
        out.push(relative(dir, full))
      }
    }
  }
  return out.sort()
}

/** Pure diff between two staged directory trees. */
export function diffDirs(committedDir, freshDir) {
  const committed = new Set(existsSync(committedDir) ? listFiles(committedDir) : [])
  const fresh = new Set(listFiles(freshDir))
  const removed = [...committed].filter((f) => !fresh.has(f)).sort()
  const added = [...fresh].filter((f) => !committed.has(f)).sort()
  const changed = [...fresh]
    .filter((f) => committed.has(f))
    .filter((f) => {
      const a = readFileSync(join(committedDir, f))
      const b = readFileSync(join(freshDir, f))
      return !a.equals(b)
    })
    .sort()
  return { removed, added, changed }
}
