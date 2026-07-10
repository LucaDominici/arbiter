// SPDX-License-Identifier: Apache-2.0
import {
  existsSync,
  mkdirSync,
  symlinkSync,
  copyFileSync,
  cpSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { WorktreeLinkSpec } from '../wizard/types.js'

type LinkResult =
  | 'LINKED'
  | 'LINKED_DIR'
  | 'LINKED_CHILDREN'
  | 'COPIED_TEMPLATE'
  | 'COPIED_DIR'
  | 'MISSING'

/**
 * Children NEVER symlinked by the 'symlink-children' strategy (#1873 T4, M1):
 * Vite's default cacheDir is node_modules/.vite and esbuild/dep-optimizers
 * write node_modules/.cache — shared through a whole-dir symlink, N parallel
 * worktree builds corrupt them into non-deterministic spurious reds. Each
 * worktree creates these locally instead.
 */
const SYMLINK_CHILDREN_EXCLUSIONS: ReadonlySet<string> = new Set(['.vite', '.cache'])

export interface MaterializeResult {
  spec: WorktreeLinkSpec
  result: LinkResult
}

// Creates a symlink; on EEXIST re-checks the dest is already a symlink (TOCTOU guard).
function symlinkSafe(
  srcPath: string,
  destPath: string,
  linkResult: 'LINKED' | 'LINKED_DIR',
): LinkResult {
  try {
    symlinkSync(srcPath, destPath)
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST' && lstatSync(destPath).isSymbolicLink()) {
      return linkResult
    }
    throw e
  }
  return linkResult
}

/**
 * Materialize a single link spec from the main repo into a worktree.
 *
 * For files (default):
 *   1. If source exists → create an absolute symlink at the destination.
 *   2. Else if a template path is given and exists → copy it once (no symlink).
 *   3. Else if required=true → throw.
 *   4. Else → return MISSING.
 *
 * For directories (type: "directory"):
 *   1. If source exists → symlink the entire directory (strategy: "symlink", default)
 *      or copy it recursively (strategy: "copy").
 *   2. Else if required=true → throw.
 *   3. Else → return MISSING.
 *
 * Idempotent: skips if the destination already exists.
 */
export function materializeLink(
  spec: WorktreeLinkSpec,
  mainRepoPath: string,
  worktreePath: string,
): MaterializeResult {
  const sourcePath = resolve(mainRepoPath, spec.path)
  const destPath = resolve(worktreePath, spec.path)
  const linkType = spec.type ?? 'file'

  const strategy = spec.strategy ?? 'symlink'

  // Idempotency — destination already present.
  // Must be a symlink: a real file/dir at the dest means a previous run left a non-link
  // (copy-from-template, external tool, or botched run) — refuse silently to avoid
  // masking the mismatch and silently skipping what should have been a symlink.
  // Exception: 'symlink-children' owns a REAL dest directory — handled below.
  if (existsSync(destPath) && !(linkType === 'directory' && strategy === 'symlink-children')) {
    if (!lstatSync(destPath).isSymbolicLink()) {
      throw new Error(
        `Cannot materialize '${spec.path}': a non-symlink already exists at ${destPath}. ` +
          `Remove it manually then retry.`,
      )
    }
    return { spec, result: linkType === 'directory' ? 'LINKED_DIR' : 'LINKED' }
  }

  const sourceExists = existsSync(sourcePath)

  if (linkType === 'directory') {
    // --- Directory handling ---
    if (sourceExists) {
      const sourceStat = statSync(sourcePath)
      if (!sourceStat.isDirectory()) {
        throw new Error(`Expected directory but found file at: ${spec.path} in ${mainRepoPath}`)
      }
      mkdirSync(dirname(destPath), { recursive: true })
      if (strategy === 'symlink') {
        return { spec, result: symlinkSafe(sourcePath, destPath, 'LINKED_DIR') }
      }
      if (strategy === 'symlink-children') {
        return { spec, result: materializeChildren(sourcePath, destPath, spec.path) }
      }
      // strategy === "copy"
      cpSync(sourcePath, destPath, { recursive: true })
      return { spec, result: 'COPIED_DIR' }
    }

    if (spec.required === true) {
      throw new Error(`Required directory missing: ${spec.path} in ${mainRepoPath}`)
    }
    return { spec, result: 'MISSING' }
  }

  // --- File handling ---
  if (sourceExists) {
    mkdirSync(dirname(destPath), { recursive: true })
    return { spec, result: symlinkSafe(sourcePath, destPath, 'LINKED') }
  }

  if (spec.template) {
    const templatePath = resolve(mainRepoPath, spec.template)
    if (existsSync(templatePath)) {
      mkdirSync(dirname(destPath), { recursive: true })
      copyFileSync(templatePath, destPath)
      return { spec, result: 'COPIED_TEMPLATE' }
    }
  }

  if (spec.required === true) {
    throw new Error(`Required link source missing: ${spec.path} in ${mainRepoPath}`)
  }

  return { spec, result: 'MISSING' }
}

/**
 * Materialize a directory under the 'symlink-children' strategy (#1873 T4):
 * the dest is a REAL directory; each top-level child of the source is
 * symlinked absolute, except SYMLINK_CHILDREN_EXCLUSIONS (created locally by
 * whatever tool needs them). Idempotent AND healing: a re-run creates only the
 * child links that are missing (e.g. a dependency added in the main repo after
 * the worktree was opened).
 *
 * Fail-closed migration: a whole-dir symlink at the dest (left by the old
 * 'symlink' strategy) is refused with an explicit remove-and-retry message —
 * silently layering child links behind a dir symlink would write into the
 * SHARED source.
 */
function materializeChildren(sourcePath: string, destPath: string, specPath: string): LinkResult {
  if (existsSync(destPath) && lstatSync(destPath).isSymbolicLink()) {
    throw new Error(
      `Cannot materialize '${specPath}' with strategy 'symlink-children': ${destPath} is a ` +
        `whole-directory symlink (old 'symlink' strategy). Remove it manually then retry.`,
    )
  }
  mkdirSync(destPath, { recursive: true })
  for (const child of readdirSync(sourcePath)) {
    if (SYMLINK_CHILDREN_EXCLUSIONS.has(child)) continue
    const childDest = join(destPath, child)
    if (existsSync(childDest) || lstatSync2IsLink(childDest)) continue
    symlinkSync(join(sourcePath, child), childDest)
  }
  return 'LINKED_CHILDREN'
}

/** lstat-based link probe that treats ENOENT as "not a link" (dangling-safe). */
function lstatSync2IsLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Walk the link specs for a worktree and return paths of dangling symlinks
 * (symlinks whose targets no longer exist).
 * Does NOT modify the filesystem.
 */
export function checkLinkIntegrity(specs: WorktreeLinkSpec[], worktreePath: string): string[] {
  const dangling: string[] = []
  for (const spec of specs) {
    const linkPath = resolve(worktreePath, spec.path)
    try {
      const stat = lstatSync(linkPath)
      if (stat.isSymbolicLink()) {
        pushIfDangling(linkPath, spec.path, dangling)
      } else if (stat.isDirectory() && spec.strategy === 'symlink-children') {
        // #1873 T4: the dest itself is a real dir — the links live one level
        // down. Check each top-level child symlink for a missing target.
        for (const child of readdirSync(linkPath)) {
          const childPath = join(linkPath, child)
          if (lstatSync(childPath).isSymbolicLink()) {
            pushIfDangling(childPath, `${spec.path}/${child}`, dangling)
          }
        }
      }
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      // ENOENT: entry never created — not a dangling link
    }
  }
  return dangling
}

/** Append a `path → target (target missing)` entry when the symlink dangles. */
function pushIfDangling(linkPath: string, displayPath: string, dangling: string[]): void {
  const target = readlinkSync(linkPath)
  const resolvedTarget = resolve(dirname(linkPath), target)
  if (!existsSync(resolvedTarget)) {
    dangling.push(`${displayPath} → ${target} (target missing)`)
  }
}
