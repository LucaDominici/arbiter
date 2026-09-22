// SPDX-License-Identifier: Apache-2.0
import { existsSync, lstatSync, readdirSync, readlinkSync, statSync } from 'node:fs'
import {
  copyFileTranslated,
  copyTreeTranslated,
  ensureDir,
  readFileTranslated,
  symlinkTranslated,
  toFsError,
} from '../utils/fs.js'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { WorktreeLinkSpec } from '../wizard/types.js'

type LinkResult =
  'LINKED' | 'LINKED_DIR' | 'LINKED_CHILDREN' | 'COPIED_TEMPLATE' | 'COPIED_DIR' | 'MISSING'

/**
 * Children NEVER symlinked by the 'symlink-children' strategy (#1873 T4, M1):
 * a transient, tool-owned directory that its owner can delete must be created
 * locally per worktree. Sharing it through an absolute child symlink makes the
 * link dangle after the owner cleans its main-repository copy.
 */
const SYMLINK_CHILDREN_EXCLUSIONS: ReadonlySet<string> = new Set([
  '.vite',
  '.cache',
  '.vite-temp',
  '.arbiter-test-scratch',
])

export interface MaterializeResult {
  spec: WorktreeLinkSpec
  result: LinkResult
}

function resolveContained(root: string, candidate: string): string {
  const resolved = resolve(root, candidate)
  const rel = relative(resolve(root), resolved)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Worktree resource '${candidate}' must stay inside the repository.`)
  }
  return resolved
}

function assertDestinationParents(root: string, destination: string): void {
  const parent = dirname(destination)
  const rel = relative(resolve(root), parent)
  let current = resolve(root)
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Worktree resource destination escapes through symlink: ${current}`)
    }
  }
}

function symlinkTarget(path: string): string {
  return resolve(dirname(path), readlinkSync(path))
}

function matchesCopiedTemplate(
  sourcePath: string,
  destPath: string,
  templatePath: string | undefined,
): boolean {
  return (
    !existsSync(sourcePath) &&
    templatePath !== undefined &&
    existsSync(templatePath) &&
    readFileTranslated(destPath).equals(readFileTranslated(templatePath))
  )
}

function existingRegularFile(
  spec: WorktreeLinkSpec,
  sourcePath: string,
  destPath: string,
  templatePath: string | undefined,
): MaterializeResult {
  if (matchesCopiedTemplate(sourcePath, destPath, templatePath)) {
    return { spec, result: 'COPIED_TEMPLATE' }
  }
  throw new Error(
    `Cannot materialize '${spec.path}': a non-symlink already exists at ${destPath}. ` +
      `Remove it manually then retry.`,
  )
}

function needsMaterialization(
  destPath: string,
  linkType: 'file' | 'directory',
  strategy: 'symlink' | 'symlink-children' | 'copy',
): boolean {
  if (linkType === 'directory' && strategy === 'symlink-children') return true
  return !existsSync(destPath) && !lstatSync2IsLink(destPath)
}

function existingMaterialization(
  spec: WorktreeLinkSpec,
  sourcePath: string,
  destPath: string,
  templatePath: string | undefined,
): MaterializeResult | null {
  const linkType = spec.type ?? 'file'
  const strategy = spec.strategy ?? 'symlink'
  if (needsMaterialization(destPath, linkType, strategy)) return null
  if (!lstatSync(destPath).isSymbolicLink()) {
    return existingRegularFile(spec, sourcePath, destPath, templatePath)
  }
  if (symlinkTarget(destPath) !== sourcePath) {
    throw new Error(`Cannot materialize '${spec.path}': existing symlink has the wrong target.`)
  }
  if (!existsSync(sourcePath)) {
    return { spec, result: missingOrThrow(spec, `Required resource missing: ${spec.path}`) }
  }
  return { spec, result: linkType === 'directory' ? 'LINKED_DIR' : 'LINKED' }
}

// Creates a symlink; on EEXIST re-checks the dest is already a symlink (TOCTOU guard).
function symlinkSafe(
  srcPath: string,
  destPath: string,
  linkResult: 'LINKED' | 'LINKED_DIR',
): LinkResult {
  try {
    symlinkTranslated(srcPath, destPath)
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST' && lstatSync(destPath).isSymbolicLink()) {
      return linkResult
    }
    // Already translated by symlinkTranslated (CANON-17); EEXIST is not in the errno
    // catalog, so it reaches the check above with its raw `code` intact.
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
  const sourcePath = resolveContained(mainRepoPath, spec.path)
  const destPath = resolveContained(worktreePath, spec.path)
  assertDestinationParents(worktreePath, destPath)
  const templatePath =
    spec.template === undefined ? undefined : resolveContained(mainRepoPath, spec.template)
  const linkType = spec.type ?? 'file'

  const strategy = spec.strategy ?? 'symlink'

  // Idempotency — destination already present.
  // Must be a symlink: a real file/dir at the dest means a previous run left a non-link
  // (copy-from-template, external tool, or botched run) — refuse silently to avoid
  // masking the mismatch and silently skipping what should have been a symlink.
  // Exception: 'symlink-children' owns a REAL dest directory — handled below.
  const existing = existingMaterialization(spec, sourcePath, destPath, templatePath)
  if (existing !== null) return existing

  const sourceExists = existsSync(sourcePath)

  if (linkType === 'directory') {
    const result = sourceExists
      ? materializeDirectory(spec, strategy, sourcePath, destPath, mainRepoPath)
      : missingOrThrow(spec, `Required directory missing: ${spec.path} in ${mainRepoPath}`)
    return { spec, result }
  }

  return { spec, result: materializeFile(spec, sourcePath, destPath, mainRepoPath) }
}

/** Directory branch of materializeLink — source exists; dispatch on strategy. */
function materializeDirectory(
  spec: WorktreeLinkSpec,
  strategy: NonNullable<WorktreeLinkSpec['strategy']>,
  sourcePath: string,
  destPath: string,
  mainRepoPath: string,
): LinkResult {
  const sourceStat = statSync(sourcePath)
  if (!sourceStat.isDirectory()) {
    throw new Error(`Expected directory but found file at: ${spec.path} in ${mainRepoPath}`)
  }
  ensureDir(dirname(destPath))
  if (strategy === 'symlink') {
    return symlinkSafe(sourcePath, destPath, 'LINKED_DIR')
  }
  if (strategy === 'symlink-children') {
    return materializeChildren(sourcePath, destPath, spec.path)
  }
  // strategy === "copy"
  copyTreeTranslated(sourcePath, destPath, { recursive: true })
  return 'COPIED_DIR'
}

/** File branch of materializeLink: symlink → template copy → missing/throw. */
function materializeFile(
  spec: WorktreeLinkSpec,
  sourcePath: string,
  destPath: string,
  mainRepoPath: string,
): LinkResult {
  if (existsSync(sourcePath)) {
    ensureDir(dirname(destPath))
    return symlinkSafe(sourcePath, destPath, 'LINKED')
  }

  if (spec.template) {
    const templatePath = resolveContained(mainRepoPath, spec.template)
    if (existsSync(templatePath)) {
      ensureDir(dirname(destPath))
      copyFileTranslated(templatePath, destPath)
      return 'COPIED_TEMPLATE'
    }
  }

  return missingOrThrow(spec, `Required link source missing: ${spec.path} in ${mainRepoPath}`)
}

/** MISSING for optional specs; throws the given message for required ones. */
function missingOrThrow(spec: WorktreeLinkSpec, message: string): LinkResult {
  if (spec.required === true) {
    throw new Error(message)
  }
  return 'MISSING'
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
  ensureDir(destPath)
  for (const child of readdirSync(sourcePath)) {
    if (SYMLINK_CHILDREN_EXCLUSIONS.has(child)) continue
    const childDest = join(destPath, child)
    const childSource = join(sourcePath, child)
    if (lstatSync2IsLink(childDest)) {
      if (symlinkTarget(childDest) !== childSource) {
        throw new Error(
          `Cannot materialize '${specPath}/${child}': existing symlink has the wrong target.`,
        )
      }
      continue
    }
    if (existsSync(childDest)) continue
    symlinkTranslated(childSource, childDest)
  }
  return 'LINKED_CHILDREN'
}

/** lstat-based link probe that treats ENOENT as "not a link" (dangling-safe). */
function lstatSync2IsLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
    // FAIL-OPEN-INTENT: ENOENT probe — an absent entry is not a symlink; caller creates the missing child link
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
  const visited = new Set<string>()
  for (const spec of specs) {
    const linkPath = resolve(worktreePath, spec.path)
    try {
      const stat = lstatSync(linkPath)
      if (stat.isSymbolicLink()) {
        pushIfDangling(linkPath, spec.path, dangling)
      } else if (stat.isDirectory() && spec.strategy === 'symlink-children') {
        checkChildLinks(linkPath, spec.path, dangling, visited)
      }
    } catch (e: unknown) {
      // CANON-17: ENOENT means the entry was never created (not dangling); anything
      // else is a real fs failure and is translated.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw toFsError(e, linkPath)
      // ENOENT: entry never created — not a dangling link
    }
  }
  return dangling
}

/**
 * #1873 T4: under 'symlink-children' the dest itself is a real dir. Inspect its
 * dependency tree for nested dangling links while deduplicating directory cycles.
 */
function checkChildLinks(
  dirPath: string,
  specPath: string,
  dangling: string[],
  visited: Set<string>,
): void {
  for (const child of readdirSync(dirPath)) {
    const childPath = join(dirPath, child)
    const stat = lstatSync(childPath)
    if (stat.isSymbolicLink()) {
      pushIfDangling(childPath, `${specPath}/${child}`, dangling)
      if (existsSync(childPath))
        checkNestedLinks(childPath, `${specPath}/${child}`, dangling, visited)
    } else if (stat.isDirectory()) {
      checkNestedLinks(childPath, `${specPath}/${child}`, dangling, visited)
    }
  }
}

/** Follow resolvable dependency-directory links once and report nested dangling links. */
function checkNestedLinks(
  dirPath: string,
  displayPath: string,
  dangling: string[],
  visited: Set<string>,
): void {
  const stat = statSync(dirPath)
  if (!stat.isDirectory()) return
  const key = `${stat.dev}:${stat.ino}`
  if (visited.has(key)) return
  visited.add(key)
  for (const child of readdirSync(dirPath)) {
    const childPath = join(dirPath, child)
    const childDisplay = `${displayPath}/${child}`
    const childStat = lstatSync(childPath)
    if (childStat.isSymbolicLink()) {
      pushIfDangling(childPath, childDisplay, dangling)
      if (existsSync(childPath)) checkNestedLinks(childPath, childDisplay, dangling, visited)
    } else if (childStat.isDirectory()) {
      checkNestedLinks(childPath, childDisplay, dangling, visited)
    }
  }
}

/** Append a `path → target (target missing)` entry when the symlink dangles. */
function pushIfDangling(linkPath: string, displayPath: string, dangling: string[]): void {
  const target = readlinkSync(linkPath)
  const resolvedTarget = resolve(dirname(linkPath), target)
  if (!existsSync(resolvedTarget)) {
    dangling.push(`${displayPath} → ${target} (target missing)`)
  }
}
