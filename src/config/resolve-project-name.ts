// SPDX-License-Identifier: Apache-2.0
//
// #1978: the project name must never be derived from the cwd basename when a
// durable source is available. Worktree-based invocations (arbiter's OWN
// recommended isolation model — /wt-open, ADR-103 carve-out) always run in a
// directory whose basename is NOT the project name (e.g. `1978-fix-cwd`,
// `repo-wt-x`), so a naive `basename(targetDir)` derivation misnames every
// generated artifact (GLOBAL_INVARIANTS.md, AGENTS.md, suppressions-schema.json
// title, etc.).
//
// Existing Code Survey (CANON-16 / 35-refactor-first):
//   - grep `resolveProjectName` src/ → no prior definition (new function).
//   - grep `slugifyProjectName(basename` src/ → 3 raw call sites in
//     commands/init.ts, commands/update.ts, commands/diff.ts — each computes
//     the name with no precedence over the durable sources below.
//   - `detectGitInfo` (detectors/git.ts) already derives a `projectName` from
//     the git remote origin URL, but it was unused for actual naming.
//   - Decision: new pure function here, consumed by init/update/diff in place
//     of the raw cwd-basename derivation. Additive: the precedence chain is a
//     genuinely new responsibility, not a variant of an existing helper.
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { detectGitInfo } from '../detectors/git.js'
import { getLogger } from '../utils/logger.js'
import type { ArbiterConfigV2 } from './schema.js'

/**
 * Normalize a raw directory basename into a structurally inert project name (#1550).
 *
 * `projectName` is interpolated into generated JSON / `.properties` / TOML /
 * shell config files. A raw basename (or package.json/git-remote name) may
 * carry JSON-structural (`"`, `\`), HTML-meta (`&`, `<`, `>`) or shell metacharacters
 * that corrupt or break those emitted files. Slugifying ONCE here — the config
 * boundary shared by init/update/diff — collapses every disallowed character to `-`
 * and keeps only `[A-Za-z0-9._-]`, so downstream interpolation is always safe. Falls
 * back to `app` when nothing survives (e.g. a basename of only metacharacters).
 */
export function slugifyProjectName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'app'
}

/** Strip an npm scope prefix: `@myorg/pkg-project` → `pkg-project`. */
function unscopePackageName(name: string): string {
  const slashIndex = name.indexOf('/')
  return name.startsWith('@') && slashIndex !== -1 ? name.slice(slashIndex + 1) : name
}

/** Read `package.json` `name` at `dir`, if present and a non-empty string. Crash-safe. */
function readPackageJsonName(dir: string): string | null {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: unknown }
    return typeof pkg.name === 'string' && pkg.name.trim() !== ''
      ? unscopePackageName(pkg.name.trim())
      : null
    // FAIL-OPEN-INTENT: a malformed package.json only skips this precedence source; the chain continues to git remote / cwd fallback.
  } catch {
    return null
  }
}

/**
 * Resolve the project name for `dir` using a precedence chain that never
 * starts at the cwd basename (#1978):
 *
 *   1. `stored.projectName` — the durable name persisted in arbiter.json.
 *   2. `package.json` `name` — scoped names (`@org/pkg`) are unscoped.
 *   3. git remote `origin` repo name (via {@link detectGitInfo}).
 *   4. `basename(dir)` — last resort, since a bare invocation with none of
 *      the above (no git repo, no package.json, no prior arbiter.json) has no
 *      other durable signal to fall back on.
 *
 * The result is NOT slugified here — callers already run the result through
 * `slugifyProjectName` at the point they interpolate it, mirroring the prior
 * call sites (`slugifyProjectName(basename(targetDir))`).
 */
export function resolveProjectName(dir: string, stored: ArbiterConfigV2 | null): string {
  if (stored?.projectName) return stored.projectName

  const fromPackageJson = readPackageJsonName(dir)
  if (fromPackageJson) return fromPackageJson

  const fromGitRemote = detectGitInfo(dir).projectName
  if (fromGitRemote) return fromGitRemote

  const fallback = basename(dir)
  getLogger().warn(
    'config.project_name_cwd_fallback',
    { dir, fallback },
    `no stored arbiter.json name, package.json name, or git remote found — falling back to ` +
      `the current directory name "${fallback}" as the project name. If this directory is a ` +
      `git worktree, the project name may be wrong; set it explicitly via arbiter.json.`,
  )
  return slugifyProjectName(fallback)
}
