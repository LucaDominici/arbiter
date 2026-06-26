// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { InstalledSkill } from './types.js'

const MAX_DEPTH = 6
const MAX_ENTRIES = 500

interface DetectOptions {
  targetDir: string
  claudeHome: string
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

/** Walk a directory tree up to maxDepth, returning paths of all SKILL.md files found. */
function findSkillFiles(dir: string, depth: number, found: string[], count: { n: number }): void {
  if (depth > MAX_DEPTH || count.n >= MAX_ENTRIES) return
  if (!existsSync(dir)) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (count.n >= MAX_ENTRIES) break
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      findSkillFiles(full, depth + 1, found, count)
    } else if (entry === 'SKILL.md') {
      found.push(full)
      count.n++
    }
  }
}

/**
 * Derive the owning plugin for a SKILL.md found under a plugin tree
 * (`.../<PLUGIN>/<VERSION>/skills/<NAME>/SKILL.md`). The owner is the directory
 * two levels above the `skills/` segment — robust to an extra marketplace
 * segment (`plugins/cache/<MARKETPLACE>/<PLUGIN>/<VERSION>/skills/...`) and to a
 * flat, version-less layout. This replaces the former hard requirement that the
 * SKILL.md carry an arbiter-invented `pluginOwner` frontmatter key — no real
 * Claude skill carries it (#1566).
 */
function derivePluginOwner(path: string): string {
  const segs = path.split(/[\\/]+/).filter(Boolean)
  const skillsIdx = segs.lastIndexOf('skills')
  if (skillsIdx < 1) return 'plugin'
  const grandparent = segs[skillsIdx - 2]
  if (grandparent && grandparent !== 'cache' && grandparent !== 'plugins') return grandparent
  return segs[skillsIdx - 1] ?? 'plugin'
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
): void {
  const found: string[] = []
  findSkillFiles(dir, 0, found, { n: 0 })
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
// Per-session cache keyed by (targetDir, claudeHome). Subsequent calls
// with the same key reuse the previous scan result instead of walking
// the FS again. Tests / long-running processes that mutate skills on
// disk between scans MUST call `clearSkillCache()` to force a re-walk.
export function detectInstalledSkills(opts: DetectOptions): InstalledSkill[] {
  const { targetDir, claudeHome } = opts
  const cacheKey = `${targetDir}\x00${claudeHome}`
  const hit = skillCache.get(cacheKey)
  if (hit) return hit

  const seen = new Set<string>()
  const results: InstalledSkill[] = []

  // Guard against a CWD-relative walk: when targetDir/claudeHome is falsy,
  // `join('', 'plugins', 'cache')` collapses to the RELATIVE path `plugins/cache`
  // and the detector would scan dirs under the process CWD instead of the user
  // home. Skip a scan root entirely when its base is empty (#1566).
  if (targetDir) {
    collectFromDir(join(targetDir, '.claude', 'plugins'), seen, results, derivePluginOwner)
    collectFromDir(join(targetDir, '.claude', 'skills'), seen, results, projectOwner)
  }
  if (claudeHome) {
    collectFromDir(join(claudeHome, 'plugins', 'cache'), seen, results, derivePluginOwner)
    collectFromDir(join(claudeHome, 'skills'), seen, results, userOwner)
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
