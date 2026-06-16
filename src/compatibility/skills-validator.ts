// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import skillsMatrixJson from './skills-matrix.json' with { type: 'json' }
import type { SkillMatrixEntry } from '../integrations/types.js'

// Keep in sync with SKILL_NAMES in src/generators/skills.ts
const VALID_SKILL_NAMES = new Set([
  'tdd',
  'verification',
  'architect-review',
  'clean-code',
  'understand-code',
  'codebase-audit',
  'epic-decompose',
  'configure',
  'brainstorming',
  'wave-drain',
  'impact',
  'close-gold-gap',
])

const SkillEntrySchema = z.object({
  skillId: z.string().min(1),
  pluginOwner: z.string().min(1),
  versionRange: z.string().min(1),
  role: z.string(),
  integrationStatus: z.enum(['proven', 'beta', 'unknown']),
  replaces: z.array(z.string()),
  referenceUrl: z.string(),
})

const SkillsMatrixSchema = z.object({
  $schemaVersion: z.literal(1),
  _lastUpdated: z.string(),
  _refreshCadence: z.string(),
  _promotionCriteria: z.string(),
  skills: z.array(SkillEntrySchema),
})

export type SkillsMatrix = z.infer<typeof SkillsMatrixSchema>

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateSkillsMatrix(raw: unknown): ValidationResult {
  const errors: string[] = []

  const parsed = SkillsMatrixSchema.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`)
    }
    return { valid: false, errors }
  }

  for (const entry of parsed.data.skills) {
    for (const name of entry.replaces) {
      if (!VALID_SKILL_NAMES.has(name)) {
        errors.push(
          `skills-matrix: "${entry.skillId}" replaces unknown SKILL_NAME "${name}". ` +
            `Valid names: ${[...VALID_SKILL_NAMES].join(', ')}`,
        )
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

export function loadSkillsMatrix(): SkillsMatrix {
  const raw: unknown = skillsMatrixJson
  const result = validateSkillsMatrix(raw)
  if (!result.valid) {
    throw new Error(`skills-matrix.json is invalid:\n${result.errors.join('\n')}`)
  }
  return raw as SkillsMatrix
}

export function getSkillsMatrixEntries(): SkillMatrixEntry[] {
  const matrix = loadSkillsMatrix()
  return matrix.skills.map((s) => ({
    skillId: s.skillId,
    pluginOwner: s.pluginOwner,
    versionRange: s.versionRange,
    role: s.role,
    integrationStatus: s.integrationStatus,
    replaces: s.replaces,
    referenceUrl: s.referenceUrl,
  }))
}
