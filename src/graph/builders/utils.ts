/**
 * Shared utilities for provenance graph builders (#259).
 *
 * Existing Code Survey (CANON-16):
 *   - grepped for parseMarkdown, extractSection, parseHeading, frontmatter — found nothing in src/
 *   - grepped for walkSync, readdirSync patterns — found readdirSync in detectors/ and decomposition/
 *     but all are domain-specific (lane detection, module scan) with different semantics
 *   - New utility justified: 6 builders all need (a) file walking with sorted determinism and
 *     (b) INV/ADR/CANON id extraction from markdown text; no existing abstraction covers this
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Extract all unique INV ids from a block of text. */
export function extractInvRefs(text: string): string[] {
  return unique(Array.from(text.matchAll(/\bINV-\d+\b/g), (m) => m[0]))
}

/** Deduplicate preserving order. */
export function unique<T>(items: T[]): T[] {
  const seen = new Set<T>()
  const out: T[] = []
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  return out
}

/**
 * Walk a directory recursively, yielding all file paths that match a predicate.
 * Results are sorted lexicographically at each level for determinism across platforms.
 *
 * Does not throw on permission errors — skips unreadable directories silently.
 */
export function walkFiles(dir: string, predicate: (filePath: string) => boolean): string[] {
  const results: string[] = []
  _walk(dir, predicate, results)
  return results.sort()
}

function _walk(dir: string, predicate: (filePath: string) => boolean, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  entries.sort()
  for (const entry of entries) {
    const full = join(dir, entry)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      _walk(full, predicate, out)
    } else if (predicate(full)) {
      out.push(full)
    }
  }
}
