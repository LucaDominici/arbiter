import {
  existsSync,
  mkdirSync,
  symlinkSync,
  copyFileSync,
  lstatSync,
  readlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { WorktreeLinkSpec } from "../wizard/types.js";

export type LinkResult = "LINKED" | "COPIED_TEMPLATE" | "MISSING";

export interface MaterializeResult {
  spec: WorktreeLinkSpec;
  result: LinkResult;
}

/**
 * Materialize a single link spec from the main repo into a worktree.
 *
 * Strategy (symlink, default):
 *   1. If source exists → create an absolute symlink at the destination.
 *   2. Else if a template path is given and exists → copy it once (no symlink).
 *   3. Else if required=true → throw.
 *   4. Else → return MISSING (caller decides what to do).
 *
 * Idempotent: skips if the destination already exists.
 */
export function materializeLink(
  spec: WorktreeLinkSpec,
  mainRepoPath: string,
  worktreePath: string,
): MaterializeResult {
  const sourcePath = resolve(mainRepoPath, spec.path);
  const destPath = resolve(worktreePath, spec.path);

  // Idempotency — destination already present
  if (existsSync(destPath)) {
    return { spec, result: "LINKED" };
  }

  if (existsSync(sourcePath)) {
    mkdirSync(dirname(destPath), { recursive: true });
    // Always use absolute symlink target to avoid cross-filesystem breakage
    symlinkSync(sourcePath, destPath);
    return { spec, result: "LINKED" };
  }

  if (spec.template) {
    const templatePath = resolve(mainRepoPath, spec.template);
    if (existsSync(templatePath)) {
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(templatePath, destPath);
      return { spec, result: "COPIED_TEMPLATE" };
    }
  }

  if (spec.required === true) {
    throw new Error(
      `Required link source missing: ${spec.path} in ${mainRepoPath}`,
    );
  }

  return { spec, result: "MISSING" };
}

/**
 * Walk the link specs for a worktree and return paths of dangling symlinks
 * (symlinks whose targets no longer exist).
 * Does NOT modify the filesystem.
 */
export function checkLinkIntegrity(
  specs: WorktreeLinkSpec[],
  worktreePath: string,
): string[] {
  const dangling: string[] = [];
  for (const spec of specs) {
    const linkPath = resolve(worktreePath, spec.path);
    try {
      const stat = lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(linkPath);
        if (!existsSync(target)) {
          dangling.push(`${spec.path} → ${target} (target missing)`);
        }
      }
    } catch {
      // Entry absent — not a dangling link, just never created
    }
  }
  return dangling;
}
