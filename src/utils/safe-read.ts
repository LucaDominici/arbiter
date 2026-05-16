// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Read a file as UTF-8 text, distinguishing ENOENT from other errors.
 * - ENOENT → returns '' silently (file not present is expected in detectors)
 * - Any other error → logs a warning and returns '' (unexpected; surface to operator)
 */
export function readFileSafe(path: string): string {
  try {
    return readFileSync(path, 'utf-8')
  } catch (err) {
    if (isEnoent(err)) return ''
    console.warn(`[arbiter] could not read ${path}: ${String(err)}`)
    return ''
  }
}

/**
 * Parse package.json from `dir`, distinguishing ENOENT from other errors.
 * - ENOENT → returns {} silently
 * - IO error or invalid JSON → logs a warning and returns {}
 */
export function readPackageJsonSafe(dir: string): Record<string, unknown> {
  const path = join(dir, 'package.json')
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    if (isEnoent(err)) return {}
    console.warn(`[arbiter] could not parse ${path}: ${String(err)}`)
    return {}
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
