// SPDX-License-Identifier: Apache-2.0
import { dirname, basename, join } from 'node:path'

/**
 * Normalise a raw task ID to the canonical `#NNN` form.
 *
 * Security guard (#1541): the id becomes part of an on-disk worktree path AND a
 * git branch ref, so the validation here is intrinsic, not merely backstopped by
 * git's downstream ref-format check. Rejects (after stripping the single
 * optional leading `#`):
 *   - empty input
 *   - any character outside the whitelist `[A-Za-z0-9._-]` (covers `/`, `\`, and
 *     shell/space metacharacters)
 *   - a leading `-` (would be parsed as a flag by git / other CLIs)
 *   - a `..` parent-directory traversal segment
 */
export function sanitizeTaskId(raw: string): string {
  const trimmed = raw.trim()
  const core = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  if (core.length === 0) {
    throw new Error(`Invalid task ID (empty): ${JSON.stringify(raw)}`)
  }
  if (!/^[A-Za-z0-9._-]+$/.test(core)) {
    throw new Error(`Invalid task ID (illegal characters, must match [A-Za-z0-9._-]): ${raw}`)
  }
  if (core.startsWith('-')) {
    throw new Error(`Invalid task ID (must not start with '-'): ${raw}`)
  }
  if (core.includes('..')) {
    throw new Error(`Invalid task ID (must not contain '..'): ${raw}`)
  }
  return `#${core}`
}

/**
 * Convert an arbitrary string into a safe, lowercase kebab-case slug
 * suitable for use in branch names and directory names. Truncates at 40 chars.
 */
export function sanitizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * Compute the git branch name for a task worktree.
 * Format: `task/<taskId>[-<slug>]`
 */
export function branchNameFor(taskId: string, slug?: string): string {
  const id = sanitizeTaskId(taskId)
  if (!slug) return `task/${id}`
  return `task/${id}-${sanitizeSlug(slug)}`
}

/**
 * Compute the directory name for a task worktree.
 * Format: `<taskNumber>[-<slug>]`
 *
 * The leading `#` of the task id is stripped: `#` is a URL-fragment delimiter
 * that breaks Vite/Vitest/Node-ESM path resolution when it appears in a
 * directory path (the tool reads everything after `#` as a fragment, truncating
 * the real path). The git BRANCH keeps the `#` for issue linking — see
 * {@link branchNameFor}; only the on-disk directory is sanitised. (#1108)
 */
export function worktreeDirectoryName(taskId: string, slug?: string): string {
  const id = sanitizeTaskId(taskId).replace(/^#/, '')
  if (!slug) return id
  return `${id}-${sanitizeSlug(slug)}`
}

/**
 * Resolve the base directory that will hold all worktrees.
 * Priority: envOverride > configBase > sibling of gitRoot named `<repoName>.worktrees`
 */
export function resolveWorktreeBase(
  gitRoot: string,
  configBase: string | null,
  envOverride?: string,
): string {
  if (envOverride) return envOverride
  if (configBase) return configBase
  const parent = dirname(gitRoot)
  const repoName = basename(gitRoot)
  return join(parent, `${repoName}.worktrees`)
}

/**
 * Compute the full path for a specific task's worktree directory.
 */
export function worktreePathFor(worktreeBase: string, taskId: string, slug?: string): string {
  return join(worktreeBase, worktreeDirectoryName(taskId, slug))
}

/**
 * Compute the sibling worktree path: <repoParent>/<repoName>.worktrees/<slug>.
 * Used by --sibling flag to place the worktree next to the main repo.
 * Precedence: explicit `--sibling <slug>` > default `worktreeDirectoryName(taskId, slug)`.
 */
export function siblingWorktreePathFor(gitRoot: string, siblingSlug: string): string {
  // #1541: the `--sibling <v>` value reaches here verbatim with a valid branch
  // name, so (unlike the default flow) git does NOT backstop a traversal. Reject
  // path separators and `..` so the worktree cannot be placed outside the
  // `<repo>.worktrees` base.
  if (siblingSlug.length === 0 || /[/\\]/.test(siblingSlug) || siblingSlug.includes('..')) {
    throw new Error(
      `Invalid sibling worktree name (must not be empty or contain path separators or '..'): ${JSON.stringify(siblingSlug)}`,
    )
  }
  const parent = dirname(gitRoot)
  const repoName = basename(gitRoot)
  return join(parent, `${repoName}.worktrees`, siblingSlug)
}
