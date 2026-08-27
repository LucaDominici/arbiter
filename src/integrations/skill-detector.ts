// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { InstalledSkill } from './types.js'

const MAX_DEPTH = 6
// Safety ceiling against a pathological tree (symlink loops, an enormous
// unrelated dir). Real plugin caches already exceed 1600 SKILL.md (#1634), so
// the former 500 cap silently truncated ~70% of installs in filesystem-arbitrary
// order. Raised well above any realistic count, the walk is sorted (deterministic)
// and surfaces a diagnostic if the ceiling is ever reached — never a silent drop.
const MAX_ENTRIES = 50000

// Directories never worth walking for SKILL.md — VCS/editor metadata and
// dependency trees. Pruning them keeps the budget for real skills and avoids
// mis-detecting a SKILL.md vendored inside a dependency (#1634).
const SKIP_DIRS = new Set(['node_modules'])

interface ScanLimits {
  maxDepth: number
  maxEntries: number
}

interface DetectOptions {
  targetDir: string
  claudeHome: string
  scanLimits?: ScanLimits
}

/** Parse YAML frontmatter from a SKILL.md string. Returns null if no valid frontmatter found. */
function parseFrontmatter(content: string): Record<string, string> | null {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return null
  const end = normalized.indexOf('\n---', 4)
  if (end === -1) return null
  const block = normalized.slice(4, end)
  const result: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    let val = line.slice(colon + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key) result[key] = val
  }
  return result
}

interface WalkCount {
  n: number
  truncated: boolean
}

interface WalkContext {
  found: string[]
  count: WalkCount
  limits: ScanLimits
}

function sortedDirectoryEntries(dir: string): string[] | null {
  try {
    return readdirSync(dir).sort()
  } catch {
    return null
  }
}

function visitSkillEntry(
  dir: string,
  entry: string,
  depth: number,
  context: WalkContext,
): void {
  const { found, count } = context
  if (entry.startsWith('.') || SKIP_DIRS.has(entry)) return
  const full = join(dir, entry)
  let stat
  try {
    stat = statSync(full)
  } catch {
    return
  }
  if (stat.isDirectory()) {
    findSkillFiles(full, depth + 1, context)
    return
  }
  if (entry === 'SKILL.md') {
    found.push(full)
    count.n++
  }
}

/** Walk a directory tree up to maxDepth, returning paths of all SKILL.md files found. */
function findSkillFiles(
  dir: string,
  depth: number,
  context: WalkContext,
): void {
  const { count, limits } = context
  if (depth > limits.maxDepth || count.n >= limits.maxEntries) return
  if (!existsSync(dir)) return
  const entries = sortedDirectoryEntries(dir)
  if (entries === null) return
  // Sort so the traversal order is deterministic across machines — without this,
  // a residual truncation would drop a filesystem-arbitrary subset (#1634).
  for (const entry of entries) {
    if (count.n >= limits.maxEntries) {
      count.truncated = true
      break
    }
    // Prune VCS/editor metadata and dependency trees — never hosts a real skill,
    // and a vendored SKILL.md inside one would be mis-attributed (#1634).
    visitSkillEntry(dir, entry, depth, context)
  }
}

/**
 * Derive the owning plugin for a SKILL.md found under a plugin tree, relative to
 * the `root` it was discovered under. Two real layouts coexist (#1634):
 *
 *   - Official "skills"-segment: `<plugin>/<version>/skills/<name>/SKILL.md`
 *     (optionally prefixed by a `<marketplace>` segment). Owner = the dir two
 *     levels above `skills/` (falling back one level when there is no version dir).
 *   - Flat, version-less (the real majority on a live machine):
 *     `<marketplace>/<plugin>/<hash>/<name>/SKILL.md` — no `skills/` path part.
 *     The plugin dir is always three levels above the SKILL.md leaf
 *     (`…/<plugin>/<hash>/<name>/SKILL.md`), independent of a marketplace prefix.
 *
 * Anchoring on the scan `root` (not a brittle `lastIndexOf('skills')`) means the
 * flat majority resolves to the real plugin owner instead of the `'plugin'`
 * sentinel — which previously collapsed distinct plugins into colliding skillIds.
 */
function derivePluginOwner(path: string, root: string): string {
  const segs = path.split(/[\\/]+/).filter(Boolean)
  const rootLen = root.split(/[\\/]+/).filter(Boolean).length
  const rel = segs.slice(rootLen)
  const skillsIdx = rel.lastIndexOf('skills')
  if (skillsIdx >= 1) {
    return rel[skillsIdx - 2] ?? rel[skillsIdx - 1] ?? 'plugin'
  }
  // Flat layout: rel = [..., <plugin>, <hash>, <name>, 'SKILL.md'].
  if (rel.length >= 4) return rel[rel.length - 4] ?? 'plugin'
  if (rel.length >= 3) return rel[rel.length - 3] ?? 'plugin'
  return 'plugin'
}

function readSkill(path: string, deriveOwner: (p: string) => string): InstalledSkill | null {
  let content: string
  try {
    content = readFileSync(path, 'utf-8')
  } catch {
    return null
  }
  const fm = parseFrontmatter(content)
  // `name` is the only mandatory frontmatter field (the Claude skill spec is
  // `name` + `description`). `pluginOwner` is an OPTIONAL override — when absent
  // (every real skill) the owner is derived from the install path.
  if (!fm || !fm['name']) return null
  const owner = fm['pluginOwner'] ?? deriveOwner(path)
  const skillId = `${owner}:${fm['name']}`
  return {
    skillId,
    pluginOwner: owner,
    version: fm['version'] ?? 'unknown',
    sourcePath: path,
    ...(fm['role'] ? { role: fm['role'] } : {}),
  }
}

function collectFromDir(
  dir: string,
  seen: Set<string>,
  results: InstalledSkill[],
  deriveOwner: (p: string) => string,
  limits: ScanLimits,
): void {
  const found: string[] = []
  const count: WalkCount = { n: 0, truncated: false }
  findSkillFiles(dir, 0, { found, count, limits })
  if (count.truncated) {
    // Never a silent partial scan: surface the ceiling so a missing skill is
    // attributable rather than mysterious (#1634).
    process.stderr.write(
      `[arbiter] skill scan reached MAX_ENTRIES (${limits.maxEntries}) under ${dir}; results may be partial\n`,
    )
  }
  for (const path of found) {
    const skill = readSkill(path, deriveOwner)
    if (!skill) continue
    if (seen.has(skill.skillId)) continue
    seen.add(skill.skillId)
    results.push(skill)
  }
}

// Owner sentinels for the two non-plugin scan roots (a SKILL.md placed directly
// under a `skills/` dir, not inside a versioned plugin tree).
const projectOwner = (): string => 'project'
const userOwner = (): string => 'user'

// Detect installed skills by scanning 4 locations in priority order.
// First hit per skillId wins. Scan order:
//   1. targetDir/.claude/plugins/**/skills/NAME/SKILL.md
//   2. targetDir/.claude/skills/NAME/SKILL.md
//   3. claudeHome/plugins/cache/PLUGIN/VERSION/skills/NAME/SKILL.md
//   4. claudeHome/skills/NAME/SKILL.md
//
// Per-session cache keyed by (targetDir, claudeHome, scanLimits). Subsequent calls
// with the same key reuse the previous scan result instead of walking
// the FS again. Tests / long-running processes that mutate skills on
// disk between scans MUST call `clearSkillCache()` to force a re-walk.
export function detectInstalledSkills(opts: DetectOptions): InstalledSkill[] {
  const { targetDir, claudeHome } = opts
  const limits = opts.scanLimits ?? { maxDepth: MAX_DEPTH, maxEntries: MAX_ENTRIES }
  const cacheKey = `${targetDir}\x00${claudeHome}\x00${limits.maxDepth}\x00${limits.maxEntries}`
  const hit = skillCache.get(cacheKey)
  if (hit) return hit

  const seen = new Set<string>()
  const results: InstalledSkill[] = []

  // Guard against a CWD-relative walk: when targetDir/claudeHome is falsy,
  // `join('', 'plugins', 'cache')` collapses to the RELATIVE path `plugins/cache`
  // and the detector would scan dirs under the process CWD instead of the user
  // home. Skip a scan root entirely when its base is empty (#1566).
  if (targetDir) {
    const pluginsRoot = join(targetDir, '.claude', 'plugins')
    collectFromDir(pluginsRoot, seen, results, (p) => derivePluginOwner(p, pluginsRoot), limits)
    collectFromDir(join(targetDir, '.claude', 'skills'), seen, results, projectOwner, limits)
  }
  if (claudeHome) {
    const cacheRoot = join(claudeHome, 'plugins', 'cache')
    collectFromDir(cacheRoot, seen, results, (p) => derivePluginOwner(p, cacheRoot), limits)
    collectFromDir(join(claudeHome, 'skills'), seen, results, userOwner, limits)
  }

  // Freeze before caching so a consumer that mutates the result (sort/push)
  // cannot corrupt the shared per-session cache for later callers (#1566). The
  // reference stays stable, preserving the #798 cache-identity contract.
  Object.freeze(results)
  skillCache.set(cacheKey, results)
  return results
}

const skillCache = new Map<string, InstalledSkill[]>()

/**
 * Clear the per-session skill-detector cache (#798).
 *
 * Long-running processes (daemons, watchers) and test suites that
 * mutate skills on disk between scans MUST call this to force the
 * next `detectInstalledSkills` call to re-walk the FS.
 */
export function clearSkillCache(): void {
  skillCache.clear()
}
