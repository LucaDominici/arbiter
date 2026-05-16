// SPDX-License-Identifier: Apache-2.0

export interface InstalledSkill {
  /** Composite key: "<pluginOwner>:<skillName>" */
  skillId: string
  pluginOwner: string
  version: string
  sourcePath: string
  role?: string
}

export interface SkillMatrixEntry {
  skillId: string
  pluginOwner: string
  versionRange: string
  role: string
  integrationStatus: 'proven' | 'beta' | 'unknown'
  /** Built-in SKILL_NAMES this skill replaces when detected */
  replaces: string[]
  referenceUrl: string
}

export interface SkipReport {
  generator: string
  reason: string
  replacedBy: string
}
