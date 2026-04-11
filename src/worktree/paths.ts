import { dirname, basename, join } from "node:path";

/**
 * Normalise a raw task ID to the canonical `#NNN` form.
 * Throws on IDs containing path separators (security guard).
 */
export function sanitizeTaskId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`Invalid task ID (must not contain slashes): ${raw}`);
  }
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

/**
 * Convert an arbitrary string into a safe, lowercase kebab-case slug
 * suitable for use in branch names and directory names. Truncates at 40 chars.
 */
export function sanitizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Compute the git branch name for a task worktree.
 * Format: `task/<taskId>[-<slug>]`
 */
export function branchNameFor(taskId: string, slug?: string): string {
  const id = sanitizeTaskId(taskId);
  if (!slug) return `task/${id}`;
  return `task/${id}-${sanitizeSlug(slug)}`;
}

/**
 * Compute the directory name for a task worktree.
 * Format: `<taskId>[-<slug>]`
 */
export function worktreeDirectoryName(taskId: string, slug?: string): string {
  const id = sanitizeTaskId(taskId);
  if (!slug) return id;
  return `${id}-${sanitizeSlug(slug)}`;
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
  if (envOverride) return envOverride;
  if (configBase) return configBase;
  const parent = dirname(gitRoot);
  const repoName = basename(gitRoot);
  return join(parent, `${repoName}.worktrees`);
}

/**
 * Compute the full path for a specific task's worktree directory.
 */
export function worktreePathFor(
  worktreeBase: string,
  taskId: string,
  slug?: string,
): string {
  return join(worktreeBase, worktreeDirectoryName(taskId, slug));
}
