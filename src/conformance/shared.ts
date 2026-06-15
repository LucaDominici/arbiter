// SPDX-License-Identifier: Apache-2.0
// conformance/shared.ts — shared IO helpers for conformance probes (#1395/C3).
//
// Extracted from dimensions.ts and engine.ts to eliminate CANON-22 duplication.
// safeResolve is security-sensitive: reject path traversal and null bytes.

import { existsSync, readFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'

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
