// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getLogger } from './logger.js'

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
    getLogger().warn('safe_read.read_failed', { path, err: String(err) }, `could not read ${path}`)
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
    getLogger().warn(
      'safe_read.parse_failed',
      { path, err: String(err) },
      `could not parse ${path}`,
    )
    return {}
  }
}

/**
 * Read a benchmark/eval baseline JSON file, returning a plain object or `null`.
 * Shared by `benchmark` and `skill-eval` so regression detection degrades the
 * same way everywhere (#1264):
 * - Missing file → `null` silently (no baseline yet is a normal first run).
 * - Invalid JSON or a non-object top level → warn to stderr and return `null`
 *   so regression detection is disabled rather than crashing the run.
 *
 * Callers narrow the returned values to their own baseline value type.
 */
export function readBaselineFileSafe(baselineFile: string): Record<string, unknown> | null {
  if (!existsSync(baselineFile)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(baselineFile, 'utf-8'))
  } catch (err) {
    process.stderr.write(
      `Warning: baseline file exists but contains invalid JSON (${baselineFile}): ${String(err)}\n` +
        `Regression detection disabled. Delete or regenerate the baseline.\n`,
    )
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    process.stderr.write(
      `Warning: baseline file has unexpected structure (${baselineFile}). ` +
        `Expected object, got ${Array.isArray(raw) ? 'array' : typeof raw}.\n` +
        `Regression detection disabled. Delete or regenerate the baseline.\n`,
    )
    return null
  }
  return raw as Record<string, unknown>
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
