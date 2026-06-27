// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'
import type { InstalledSkill, SkipReport } from '../integrations/types.js'
import { getSkillsMatrixEntries } from '../compatibility/skills-validator.js'
import skillNames from './skill-names.json' with { type: 'json' }

export interface SkillsGeneratorResult {
  files: WriteResult[]
  skipped: SkipReport[]
}

/**
 * Canonical list of built-in skill names — the single source of truth.
 *
 * Sourced from `skill-names.json` so every consumer (the validator allow-list,
 * the `check-skills-matrix.mjs` gate, and the test suites) derives from ONE
 * file. Hand-copying this list is the drift class that #1559/#1583 eliminated.
 */
export const SKILL_NAMES: readonly string[] = skillNames

/** Parse a `X.Y.Z` core version. Returns null when the string is not a semver. */
function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/**
 * Whether `version` satisfies a single-comparator range (`>=X.Y.Z`, `>`, `<=`,
 * `<`, `=`, or a bare `X.Y.Z` treated as exact). The skills matrix only uses
 * `>=` ranges today; the others are handled for forward-compatibility. An
 * unparseable version or range never satisfies — fail closed.
 */
function satisfiesRange(version: string, range: string): boolean {
  const m = /^\s*(>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+.*)$/.exec(range.trim())
  if (!m) return false
  const target = parseSemver(m[2] ?? '')
  const have = parseSemver(version)
  if (!target || !have) return false
  const cmp = compareSemver(have, target)
  switch (m[1] ?? '=') {
    case '>=':
      return cmp >= 0
    case '>':
      return cmp > 0
    case '<=':
      return cmp <= 0
    case '<':
      return cmp < 0
    default:
      return cmp === 0
  }
}

function findReplacingSkill(
  skillName: string,
  installedSkills: InstalledSkill[],
): InstalledSkill | undefined {
  const matrixEntries = getSkillsMatrixEntries()
  for (const installed of installedSkills) {
    const entry = matrixEntries.find((e) => e.skillId === installed.skillId)
    if (!entry?.replaces.includes(skillName)) continue
    // Version gate (#1613 Problem 2): only defer to an installed skill whose
    // version satisfies the matrix range. An 'unknown' version (no `version`
    // frontmatter) is NOT trusted to clear a minimum — refuse, so an outdated
    // or unverifiable upstream skill can never silently disable a governance
    // built-in.
    if (installed.version === 'unknown') continue
    if (!satisfiesRange(installed.version, entry.versionRange)) continue
    return installed
  }
  return undefined
}

/** Compute which built-in skills would be skipped without writing any files. */
export function computeSkipReport(installedSkills: InstalledSkill[]): SkipReport[] {
  if (installedSkills.length === 0) return []
  const skipped: SkipReport[] = []
  for (const name of SKILL_NAMES) {
    const replacing = findReplacingSkill(name, installedSkills)
    if (replacing) {
      skipped.push({
        generator: name,
        reason: `Replaced by installed skill "${replacing.skillId}" — no built-in SKILL.md generated`,
        replacedBy: replacing.skillId,
      })
    }
  }
  return skipped
}

export function generateSkills(
  config: ProjectConfig,
  installedSkills: InstalledSkill[] = [],
  opts: { dryRun: boolean } = { dryRun: false },
): SkillsGeneratorResult {
  if (!config.tools.includes('claude')) return { files: [], skipped: [] }

  const base = config.targetDir
  const files: WriteResult[] = []
  const skipped: SkipReport[] = []

  for (const name of SKILL_NAMES) {
    const replacing = findReplacingSkill(name, installedSkills)
    if (replacing) {
      skipped.push({
        generator: name,
        reason: `Replaced by installed skill "${replacing.skillId}" — no built-in SKILL.md generated`,
        replacedBy: replacing.skillId,
      })
      continue
    }
    files.push(
      writeFile(
        resolvedPath(base, '.claude', 'skills', name, 'SKILL.md'),
        renderTemplate(`claude/skills/${name}/SKILL.md.ejs`, config),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files, skipped }
}
