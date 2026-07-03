// SPDX-License-Identifier: Apache-2.0
// CATALOG: Shared glob + tree-walk helpers for presence-gate scripts (#1366).
// CATALOG:   Used by check-render-smoke.mjs (INV-127). A minimal, dependency-free
// CATALOG:   matcher: `**` crosses directories, `*` stays within one path component.
// CATALOG:   walkRepo returns repo-relative POSIX paths; SKIP_DIRS prunes vendor trees.
// Pure module — no process exit, no I/O side effects beyond readdir/stat.
import { readdirSync, lstatSync, statSync, existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'

export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.coverage'])

/**
 * Compile a restricted glob (`**`, `*`) into a RegExp ONCE. Compiling is the per-check cost; a
 * caller filtering many paths against one glob compiles a single RegExp here and `.test()`s it per
 * file instead of `new RegExp` per file (#1522/#1600). Output-invariant ⇒ engine-parity preserved.
 * `**\/` crosses directory boundaries; `**` (not followed by /) matches any run; `*` stays within
 * a single path component. Mirrors src/conformance/shared.ts globToRegExp byte-for-byte.
 */
export function globToRegExp(pattern) {
  let reStr = '^'
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
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
  return new RegExp(reStr)
}

/**
 * Translate a restricted glob (`**`, `*`) into a RegExp and test a POSIX path. Convenience wrapper
 * over {@link globToRegExp} for one-off single-path tests (callers filtering a LIST should compile
 * once via globToRegExp and reuse the RegExp — see gold-audit-lib expandGlob).
 */
export function globMatch(pattern, filepath) {
  return globToRegExp(pattern).test(filepath)
}

/** Reject absolute or `..`-traversal globs (path-traversal guard). */
export function validateGlob(pattern) {
  if (isAbsolute(pattern)) return false
  return !pattern.split('/').includes('..')
}

/**
 * Walk `root` collecting repo-relative POSIX file paths, pruning SKIP_DIRS.
 * Unreadable dirs/entries are skipped silently (never throws).
 */
export function walkRepo(root) {
  // Normalize a trailing slash once: a `dir/` root would make `slice(root.length+1)` drop an extra
  // leading char and mangle every relative path (a determinism foot-gun for the glob check types).
  const base = root.replace(/[/\\]+$/, '') || root
  const files = []
  // Track visited real directories by device:inode so a directory that resolves back to an
  // ancestor (symlink OR hardlink/bind-mount cycle) terminates instead of looping forever / OOMing.
  // Strictly stronger than the skip-symlink guard below — that prevents following a symlinked dir;
  // this also catches a cycle reachable through real directory entries. #1521.
  const visited = new Set()
  const visit = (dir) => {
    let dirStat
    try {
      dirStat = statSync(dir)
    } catch {
      return
    }
    const key = `${dirStat.dev}:${dirStat.ino}`
    if (visited.has(key)) return
    visited.add(key)
    let entries
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
        // A subdirectory containing its own `.git` entry (file, for a worktree — a worktree's
        // `.git` is a pointer file — OR directory, for a plain nested clone/submodule) is a
        // SEPARATE checkout, not part of THIS repo's tree. Descending into it produces false
        // positives (e.g. thousands of "broken link" hits) from agent worktrees materialized
        // under `.claude/worktrees/**`. #1734/#1752.
        if (existsSync(join(full, '.git'))) continue
        visit(full)
      } else {
        files.push(full.slice(base.length + 1).replace(/\\/g, '/'))
      }
    }
  }
  visit(base)
  return files
}
