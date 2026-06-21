// SPDX-License-Identifier: Apache-2.0
// conformance/shared.ts — shared IO helpers for conformance probes (#1395/C3).
//
// Extracted from dimensions.ts and engine.ts to eliminate CANON-22 duplication.
// safeResolve is security-sensitive: reject path traversal and null bytes.

import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs'
import { resolve, relative, isAbsolute, join } from 'node:path'

/** Safely resolve a path inside root, rejecting traversal and null bytes. Returns null on invalid path. */
export function safeResolve(root: string, p: string): string | null {
  if (p.includes('\0')) return null
  const abs = resolve(root, p)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return abs
}

/** Read file text, returning null on any IO error. */
export function readText(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf-8')
  } catch {
    return null
  }
}

/** Parse JSON, returning null on any parse or IO error. */
export function readJson(abs: string): unknown {
  const text = readText(abs)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Check if file exists (safe wrapper). */
export function fileExists(abs: string): boolean {
  try {
    return existsSync(abs)
  } catch {
    return false
  }
}

// ── Constrained deterministic glob (#1470) ──────────────────────────────────────
//
// One canonical glob matcher + tree-walk for the conformance engine, mirrored byte-for-byte by
// scripts/lib/glob-walk.mjs (the .mjs evaluator's source) so forbidden_pattern / file_stat verdicts
// are identical across engines (engine-parity gate). `**\/` crosses directory boundaries; `*` stays
// within one path component. walkRepo returns repo-relative POSIX paths and prunes SKIP_DIRS.

/** Vendor/build trees pruned during a repo walk (identical set to glob-walk.mjs). */
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.coverage'])

/**
 * Translate a restricted glob (`**`, `*`) into a RegExp and test a POSIX path. Shared by the
 * conformance engine and the dimension probes (one matcher, no hand-written copies — CANON-16).
 */
export function globMatch(pattern: string, filepath: string): boolean {
  let reStr = '^'
  let i = 0
  while (i < pattern.length) {
    const ch: string = pattern[i] ?? ''
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        reStr += '(?:[^/]*/)*'
        i += 3
      } else {
        reStr += '[\\s\\S]*'
        i += 2
      }
    } else if (ch === '*') {
      reStr += '[^/]*'
      i++
    } else if ('\\.+?^${}()|[]'.includes(ch)) {
      reStr += '\\' + ch
      i++
    } else {
      reStr += ch
      i++
    }
  }
  reStr += '$'
  return new RegExp(reStr).test(filepath)
}

/** Reject absolute or `..`-traversal globs (path-traversal guard). */
function validateGlob(pattern: string): boolean {
  if (isAbsolute(pattern)) return false
  return !pattern.split('/').includes('..')
}

/** Walk `root` collecting repo-relative POSIX file paths, pruning SKIP_DIRS. Never throws. */
function walkRepo(root: string): string[] {
  // Normalize a trailing slash once: a `dir/` root would make `slice(root.length+1)` drop an extra
  // leading char and mangle every relative path (a determinism foot-gun for the glob check types).
  const base = root.replace(/[/\\]+$/, '') || root
  const files: string[] = []
  const visit = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      const full = join(dir, entry)
      let stat
      try {
        stat = lstatSync(full)
      } catch {
        continue
      }
      if (stat.isSymbolicLink()) {
        // Record the symlink path (file/stat checks evaluate it via their own lstat) but NEVER
        // recurse into it — a symlinked directory could cycle and stack-overflow the walk. #1471.
        files.push(full.slice(base.length + 1).replace(/\\/g, '/'))
        continue
      }
      if (stat.isDirectory()) {
        visit(full)
      } else {
        files.push(full.slice(base.length + 1).replace(/\\/g, '/'))
      }
    }
  }
  visit(base)
  return files
}

/**
 * Expand a repo-rooted glob to a SORTED array of repo-relative POSIX paths, or null when the glob
 * is invalid (absolute / `..`-traversal / non-string / empty). An empty array is a valid "matched
 * nothing". Sort is a plain code-unit `.sort()` (NEVER localeCompare) for byte-identical ordering
 * across the TS and .mjs engines.
 */
export function expandGlob(root: string, pattern: string): string[] | null {
  if (typeof pattern !== 'string' || pattern === '' || !validateGlob(pattern)) return null
  return walkRepo(root)
    .filter((f) => globMatch(pattern, f))
    .sort()
}
