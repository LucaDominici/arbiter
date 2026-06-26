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

function findReplacingSkill(
  skillName: string,
  installedSkills: InstalledSkill[],
): InstalledSkill | undefined {
  const matrixEntries = getSkillsMatrixEntries()
  for (const installed of installedSkills) {
    const entry = matrixEntries.find((e) => e.skillId === installed.skillId)
    if (entry?.replaces.includes(skillName)) return installed
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
