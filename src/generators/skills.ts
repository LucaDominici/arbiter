// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { hasSuperpowersSkill } from '../integrations/skill-detector.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface SkillsGeneratorResult {
  files: WriteResult[]
}

const SKILL_NAMES = [
  'tdd',
  'verification',
  'architect-review',
  'clean-code',
  'understand-code',
  'codebase-audit',
  'epic-decompose',
  'configure',
] as const

export function generateSkills(config: ProjectConfig, _homeDir?: string): SkillsGeneratorResult {
  if (!config.tools.includes('claude')) return { files: [] }

  const data = config
  const base = config.targetDir

  const files: WriteResult[] = []

  for (const name of SKILL_NAMES) {
    if (name === 'tdd' && hasSuperpowersSkill('test-driven-development', base, _homeDir)) {
      process.stdout.write(
        `  Skipped tdd skill — superpowers handles it (test-driven-development detected)\n`,
      )
      continue
    }
    files.push(
      writeFile(
        resolvedPath(base, '.claude', 'skills', name, 'SKILL.md'),
        renderTemplate(`claude/skills/${name}/SKILL.md.ejs`, data),
        { skipIfExists: true },
      ),
    )
  }

  return { files }
}
