#!/usr/bin/env node
// bloat-lib.mjs — helpers for file-count and LOC measurement (CANON-16, INV-46)
import { readdirSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'

const TEST_RE = /(?:^|\/)__tests__(?:\/|$)|\.(test|spec)\.[cm]?[jt]s$/

const CODE_EXTS = ['.ts', '.mjs', '.js']

/** Shared bloat bucket contract for snapshots, baseline updates, and merge trees. */
export const BLOAT_BUCKETS = Object.freeze({
  srcDirect: Object.freeze({
    path: 'src',
    exts: CODE_EXTS,
    recursive: false,
    thresholds: { pct: 10, files: 5 },
  }),
  generators: Object.freeze({
    path: 'src/generators',
    exts: CODE_EXTS,
    recursive: true,
    thresholds: { pct: 10, files: 5 },
  }),
  commands: Object.freeze({
    path: 'src/commands',
    exts: CODE_EXTS,
    recursive: true,
    thresholds: { pct: 10, files: 5 },
  }),
  templates: Object.freeze({
    path: 'src/templates',
    exts: ['.ejs', ...CODE_EXTS],
    recursive: true,
    // jscpd cannot scan EJS, so templates get tighter limits.
    thresholds: { pct: 5, files: 3 },
  }),
})

/**
 * Recursively count files matching exts under dir, excluding test paths.
 * @param {string} dir
 * @param {string[]} exts e.g. ['.ts', '.mjs']
 * @param {boolean} recursive
 */
export function countFiles(dir, exts, recursive = true) {
  let count = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (TEST_RE.test(full)) continue
    if (entry.isDirectory() && recursive) {
      count += countFiles(full, exts, true)
    } else if (entry.isFile() && exts.includes(extname(entry.name))) {
      count++
    }
  }
  return count
}

/**
 * Recursively count lines across files matching exts under dir, excluding test paths.
 * @param {string} dir
 * @param {string[]} exts
 * @param {boolean} recursive
 */
export function countLOC(dir, exts, recursive = true) {
  let loc = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (TEST_RE.test(full)) continue
    if (entry.isDirectory() && recursive) {
      loc += countLOC(full, exts, true)
    } else if (entry.isFile() && exts.includes(extname(entry.name))) {
      try {
        loc += readFileSync(full, 'utf8').split('\n').length
      } catch {
        // skip unreadable files
      }
    }
  }
  return loc
}

/**
 * Count only direct-child files of dir (non-recursive), excluding test paths.
 * @param {string} dir
 * @param {string[]} exts
 */
export function countFilesShallow(dir, exts) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  return entries.filter(
    (e) => e.isFile() && exts.includes(extname(e.name)) && !TEST_RE.test(e.name),
  ).length
}

/** Measure all shared buckets in a working tree. */
export function snapshotBuckets(cwd) {
  return Object.fromEntries(
    Object.entries(BLOAT_BUCKETS).map(([name, bucket]) => {
      const dir = join(cwd, bucket.path)
      return [
        name,
        {
          files: bucket.recursive
            ? countFiles(dir, bucket.exts)
            : countFilesShallow(dir, bucket.exts),
          loc: countLOC(dir, bucket.exts, bucket.recursive),
        },
      ]
    }),
  )
}

/** Count shared buckets from git ls-tree's repository-relative path list. */
export function countBucketPaths(paths) {
  const counts = Object.fromEntries(Object.keys(BLOAT_BUCKETS).map((name) => [name, 0]))
  for (const path of paths) {
    if (TEST_RE.test(path)) continue
    for (const [name, bucket] of Object.entries(BLOAT_BUCKETS)) {
      const prefix = `${bucket.path}/`
      if (!path.startsWith(prefix) || !bucket.exts.includes(extname(path))) continue
      const remainder = path.slice(prefix.length)
      if (!bucket.recursive && remainder.includes('/')) continue
      counts[name]++
    }
  }
  return counts
}
