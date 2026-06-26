// SPDX-License-Identifier: Apache-2.0
// conformance/shared.ts — shared IO helpers for conformance probes (#1395/C3).
//
// Extracted from dimensions.ts and engine.ts to eliminate CANON-22 duplication.
// safeResolve is security-sensitive: reject path traversal and null bytes.

import { existsSync, readFileSync, readdirSync, lstatSync, statSync } from 'node:fs'
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

// ── #1525: ReDoS + unbounded-read hardening for registry-supplied regexes ────────────────────────
//
// The gold-registry is PROJECT-AUTHORED data and, in a consumer that wires gold-audit into CI and
// accepts fork PRs, an attacker controls both the registry pattern AND the scanned file contents.
// Registry authors do NOT own ReDoS-safety once an attacker can influence either input. Two layers,
// both DETERMINISTIC (fixed input ⇒ fixed verdict) so the engine-parity gate stays byte-identical:
//   1. readScanText caps the bytes a registry regex ever runs over (an over-cap file fails closed —
//      we cannot assert a property over bytes we refuse to read).
//   2. hasNestedUnboundedQuantifier rejects the catastrophic-backtracking regex family at compile.
// A bare try/catch around new RegExp() only catches INVALID-SYNTAX throws — it never stops a valid
// pattern like (a+)+$ from hanging the process, so it is a false-safe defense on its own.

/** Byte cap for any file a registry-supplied regex is run over (ReDoS input bound, ~2 MB). */
export const MAX_SCAN_BYTES = 2_000_000

/** Result of a capped read: the text, or a fail-closed reason (never throws). */
export type ScanRead = { ok: true; text: string } | { ok: false; reason: 'unreadable' | 'oversize' }

/**
 * Read a file for regex scanning, capped at {@link MAX_SCAN_BYTES}. An over-cap file is NEVER read
 * (it fails closed with `oversize`) so a registry regex can never run over unbounded input. Mirrors
 * scripts/lib/gold-audit-lib.mjs byte-for-byte (engine-parity).
 */
export function readScanText(abs: string): ScanRead {
  let size: number
  try {
    size = statSync(abs).size
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  if (size > MAX_SCAN_BYTES) return { ok: false, reason: 'oversize' }
  const text = readText(abs)
  return text === null ? { ok: false, reason: 'unreadable' } : { ok: true, text }
}

/** Advance past a `[...]` char class starting at `i` (on '['). Returns the index just after ']'. */
function skipCharClass(src: string, i: number): number {
  let j = i + 1
  if (src[j] === '^') j++
  if (src[j] === ']') j++ // a ']' immediately after '[' / '[^' is a literal class member
  while (j < src.length && src[j] !== ']') {
    if (src[j] === '\\') j++ // an escaped char inside the class spans two positions
    j++
  }
  return j + 1
}

/** Parse a `{...}` quantifier at `i` (on '{'). isQuant=false ⇒ '{' is a literal, not a quantifier. */
function braceQuantifier(
  src: string,
  i: number,
): { isQuant: false } | { isQuant: true; unbounded: boolean; next: number } {
  const close = src.indexOf('}', i)
  if (close < 0) return { isQuant: false }
  const body = src.slice(i + 1, close)
  // JS quantifier syntax: {n}, {n,}, {n,m}. {,m} is NOT a quantifier (treated as a literal).
  if (!/^\d+(,\d*)?$/.test(body)) return { isQuant: false }
  return { isQuant: true, unbounded: /^\d+,$/.test(body), next: close + 1 }
}

/**
 * True when `source` applies an UNBOUNDED quantifier (`*`, `+`, `{n,}`) to a group whose body itself
 * contains an unbounded quantifier — the nested-quantifier / star-height≥2 family (e.g. `(a+)+`,
 * `(a*)*`, `(.*)+`, `((a+))+`) whose backtracking grows exponentially with input length. One linear,
 * dependency-free, DETERMINISTIC scan (pattern text ⇒ fixed answer) so it is byte-identical across
 * the TS and .mjs engines. Deliberately NARROW defense-in-depth (paired with {@link MAX_SCAN_BYTES}):
 * it does not model every ReDoS family (e.g. overlapping alternation `(a|a)+`).
 */
export function hasNestedUnboundedQuantifier(source: string): boolean {
  // groupSawUnbounded[d] = the group open at depth d has an unbounded quantifier somewhere in its body
  // so far. Index 0 is the implicit top level. prevGroupSawUnbounded tracks whether the atom just
  // consumed was a group carrying such a quantifier — a quantifier right after it is the unsafe case.
  const groupSawUnbounded: boolean[] = [false]
  let prevGroupSawUnbounded = false
  let i = 0
  const n = source.length
  while (i < n) {
    const ch = source[i]
    if (ch === '\\') {
      i += 2
      prevGroupSawUnbounded = false
      continue
    }
    if (ch === '[') {
      i = skipCharClass(source, i)
      prevGroupSawUnbounded = false
      continue
    }
    if (ch === '(') {
      groupSawUnbounded.push(false)
      i++
      prevGroupSawUnbounded = false
      continue
    }
    if (ch === ')') {
      const closed = groupSawUnbounded.length > 1 ? (groupSawUnbounded.pop() ?? false) : false
      // Bubble the unbounded-ness to the enclosing group so a quantifier on an OUTER wrapper of a
      // quantified group is still caught (e.g. `((a+))+`).
      if (closed) groupSawUnbounded[groupSawUnbounded.length - 1] = true
      prevGroupSawUnbounded = closed
      i++
      continue
    }
    let unbounded = false
    let next = i + 1
    if (ch === '*' || ch === '+') {
      unbounded = true
    } else if (ch === '{') {
      const q = braceQuantifier(source, i)
      if (q.isQuant) {
        unbounded = q.unbounded
        next = q.next
      }
    }
    if (unbounded) {
      if (prevGroupSawUnbounded) return true // unbounded quantifier on a quantifier-bearing group
      groupSawUnbounded[groupSawUnbounded.length - 1] = true
      prevGroupSawUnbounded = false
      i = next
      continue
    }
    // Any other atom (literal, '?', a bounded {n}/{n,m}) does not nest unbounded quantifiers.
    prevGroupSawUnbounded = false
    i = next
  }
  return false
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
 * Compile a restricted glob (`**`, `*`) into a RegExp ONCE. Compiling is the per-check cost; a
 * caller filtering many paths against one glob compiles a single RegExp here and `.test()`s it per
 * file (instead of `new RegExp` per file — #1522). Output-invariant ⇒ engine-parity is preserved.
 * Internal: callers go through {@link globMatch} (single path) or {@link expandGlob} (a file list).
 */
function globToRegExp(pattern: string): RegExp {
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
  return new RegExp(reStr)
}

/**
 * Translate a restricted glob (`**`, `*`) into a RegExp and test a POSIX path. Shared by the
 * conformance engine and the dimension probes (one matcher, no hand-written copies — CANON-16).
 * Convenience wrapper over {@link globToRegExp} for one-off single-path tests.
 */
export function globMatch(pattern: string, filepath: string): boolean {
  return globToRegExp(pattern).test(filepath)
}

/** Reject absolute or `..`-traversal globs (path-traversal guard). */
function validateGlob(pattern: string): boolean {
  if (isAbsolute(pattern)) return false
  return !pattern.split('/').includes('..')
}

/** Walk `root` collecting repo-relative POSIX file paths, pruning SKIP_DIRS. Never throws. */
export function walkRepo(root: string): string[] {
  // Normalize a trailing slash once: a `dir/` root would make `slice(root.length+1)` drop an extra
  // leading char and mangle every relative path (a determinism foot-gun for the glob check types).
  const base = root.replace(/[/\\]+$/, '') || root
  const files: string[] = []
  // Track visited real directories by device:inode so a directory that resolves back to an
  // ancestor (symlink OR hardlink/bind-mount cycle) terminates instead of looping forever / OOMing.
  // Strictly stronger than the skip-symlink guard below — that prevents following a symlinked dir;
  // this also catches a cycle reachable through real directory entries. #1521.
  const visited = new Set<string>()
  const visit = (dir: string): void => {
    let dirStat
    try {
      dirStat = statSync(dir)
    } catch {
      return
    }
    const key = `${dirStat.dev}:${dirStat.ino}`
    if (visited.has(key)) return
    visited.add(key)
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
 *
 * `files` is an OPTIONAL pre-walked repo file list (#1522): when a single `evaluate()` resolves
 * several globs it walks the tree once and threads the result here, so K glob checks share ONE
 * tree-walk instead of K. Absent ⇒ this walks the tree itself (the standalone-call contract is
 * unchanged). The glob's RegExp is compiled once (via {@link globToRegExp}) and tested per file.
 */
export function expandGlob(root: string, pattern: string, files?: string[]): string[] | null {
  if (typeof pattern !== 'string' || pattern === '' || !validateGlob(pattern)) return null
  const re = globToRegExp(pattern)
  return (files ?? walkRepo(root)).filter((f) => re.test(f)).sort()
}
