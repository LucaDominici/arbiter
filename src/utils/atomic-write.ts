// SPDX-License-Identifier: Apache-2.0
/**
 * Atomic file-write and advisory lock primitives.
 *
 * `atomicWriteFile`: writes to a `.tmp.${pid}` sibling then `fs.rename` —
 * on POSIX, rename is atomic so readers never see a partial write.
 *
 * `withLock`: creates an exclusive lock file (O_EXCL), runs the callback,
 * then removes it. Advisory only — relies on cooperative callers.
 *
 * Issue: #1043
 */

import { writeFile, rename, rm, open } from 'node:fs/promises'

export async function atomicWriteFile(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp.${process.pid}`
  await writeFile(tmp, content, 'utf-8')
  try {
    await rename(tmp, path)
  } catch (err) {
    // EXDEV: cross-device rename (tmp on different filesystem) — clean up and rethrow
    await rm(tmp, { force: true })
    throw err
  }
}

export async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const fd = await open(lockPath, 'wx')
  await fd.close()
  try {
    return await fn()
  } finally {
    await rm(lockPath, { force: true }).catch((err: unknown) => {
      process.stderr.write(`[atomic-write] lock cleanup failed: ${String(err)}\n`)
    })
  }
}
