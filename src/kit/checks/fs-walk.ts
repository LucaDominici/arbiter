// SPDX-License-Identifier: Apache-2.0
/**
 * Shared recursive file walker for the A9/A10 opt-in kit checks (#1817).
 * Kept separate from the pure text-based check functions so those stay fs-free and
 * trivially unit-testable with in-memory fixtures.
 */

import { readdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'target',
  'build',
  '.gradle',
  'coverage',
])

export interface WalkOptions {
  /** Only include files with these extensions (e.g. ['.sql', '.vue']). Omit for all files. */
  extensions?: string[]
  /** Directory names to skip entirely. Defaults to common build/vendor dirs. */
  skipDirs?: Set<string>
}

/** Recursively lists absolute file paths under `rootDir`, honoring extension/skip filters. */
export function walkFiles(rootDir: string, options: WalkOptions = {}): string[] {
  if (!existsSync(rootDir)) return []

  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS
  const extensions = options.extensions
  const results: string[] = []

  function recurse(dir: string): void {
    // Fail closed (INV-96): an unreadable directory mid-walk means we cannot
    // certify the tree is clean, so let the error propagate to the caller and
    // fail the governance check loudly rather than silently under-reporting.
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue
        recurse(full)
      } else if (entry.isFile()) {
        if (!extensions || extensions.includes(extname(entry.name))) {
          results.push(full)
        }
      }
    }
  }

  recurse(rootDir)
  return results
}
