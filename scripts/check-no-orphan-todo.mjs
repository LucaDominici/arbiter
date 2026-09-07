#!/usr/bin/env node
// Scans source files for orphan TODO comments (missing task ID).
// Valid: // TODO(#123): description
// Invalid: // TODO: description  or  // TODO without task ID
// Usage: node scripts/check-no-orphan-todo.mjs [dir...]
// Exits 1 if any violations are found.
//
// Directory walking is delegated to the shared cycle-safe walkRepo (#1521/#1544): a single helper
// owns tree traversal (symlink-cycle safe, vendor-tree pruning) instead of a hand-rolled recursion.
// This gate's own SKIP_DIRS is re-applied as a path-segment filter so `templates/` stays pruned —
// walkRepo's SKIP_DIRS already covers node_modules/.git/dist (plus build/coverage/.coverage).
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { walkRepo } from './lib/glob-walk.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

// Match // TODO or /* TODO or * TODO (in comment context), but NOT TODO(#NNN)
// Exported so .claude/hooks/check-no-orphan-todo.mjs can reuse the same reference
// semantics rather than drifting to a naive \bTODO\b regex (#1796/#1799).
export const ORPHAN_TODO = /(?:\/\/|\/\*|\*)\s*TODO(?!\s*\(#\d+\))/
export const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js'])
export const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'templates'])

/**
 * Collect every source file under `root` to scan: walkRepo handles traversal, then this gate's own
 * SKIP_DIRS (path-segment filter) and EXTENSIONS narrow the set. Returns absolute paths.
 */
export function collectSourceFiles(root) {
  const out = []
  for (const rel of walkRepo(root)) {
    if (rel.split('/').some((seg) => SKIP_DIRS.has(seg))) continue
    if (!EXTENSIONS.has(rel.slice(rel.lastIndexOf('.')))) continue
    out.push(join(root, rel))
  }
  return out
}

/**
 * Return every orphan-TODO line in `content` as { line (1-based), text }.
 * Pure: no I/O, no exit.
 */
function findOrphanTodos(content) {
  const hits = []
  const lines = String(content ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (ORPHAN_TODO.test(lines[i])) hits.push({ line: i + 1, text: lines[i].trim() })
  }
  return hits
}

export function main(exitFn = process.exit) {
  const scanDirs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['src', '__tests__']
  const baseDir = process.cwd()
  let violations = 0
  let filesScanned = 0

  for (const dir of scanDirs) {
    // #2512: resolve(), not join(), against baseDir. join('/repo', dir) does NOT reset on an
    // absolute `dir` — join('/repo', '/tmp/fixture/src') silently becomes
    // '/repo/tmp/fixture/src', a path that (almost certainly) does not exist, so the gate scanned
    // nothing and exited 0: a green that means "I looked nowhere", not "there is nothing to
    // find". resolve() has POSIX/Node's documented right-to-left semantics: an absolute segment
    // discards everything to its left, so an absolute `dir` is used as-is and a relative one is
    // still joined under baseDir exactly as before.
    const resolvedDir = resolve(baseDir, dir)
    const files = collectSourceFiles(resolvedDir)
    filesScanned += files.length
    for (const file of files) {
      const rel = relative(baseDir, file)
      for (const hit of findOrphanTodos(readFileSync(file, 'utf-8'))) {
        process.stdout.write(`  ${rel}:${hit.line}  ${hit.text}\n`)
        violations++
      }
    }
  }

  // Programme-membership assertion (CANON-24): "nothing found" and "nothing looked at" must
  // never produce the same green. A resolved scan set of zero files — an empty directory, a
  // typo'd path, or (pre-fix) an absolute argument silently mis-resolved under baseDir — means
  // the gate proved nothing, so it fails loudly instead of reporting a false "no violations".
  process.stdout.write(
    `  Scanned ${filesScanned} file(s) across ${scanDirs.length} dir(s): ${scanDirs.join(', ')}\n`,
  )
  if (filesScanned === 0) {
    process.stdout.write(
      `\n  ABORT: resolved scan set is empty — 0 files found under ${scanDirs.join(', ')}. ` +
        `A gate that finds nothing must first prove it looked somewhere (CANON-24).\n\n`,
    )
    return exitFn(1)
  }

  if (violations > 0) {
    process.stdout.write(`\n  Found ${violations} orphan TODO(s). Use TODO(#NNN): format.\n\n`)
    return exitFn(1)
  }
  return exitFn(0)
}

// Only run main when invoked as CLI (not imported in tests).
if (isMainModule(import.meta.url)) {
  main()
}
