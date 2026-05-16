// SPDX-License-Identifier: Apache-2.0
import { SKILL_NAMES } from '../generators/skills.js'

export type InstallSource = 'builtin' | 'plugin' | 'npm'

export interface SkillEntry {
  id: string
  owner: string
  role: string
  installCmd: string
  installSource: InstallSource
}

const ARBITER_SKILLS: SkillEntry[] = SKILL_NAMES.map((id) => ({
  id,
  owner: 'arbiter',
  role: 'governance',
  installCmd: 'arbiter init  # generates automatically',
  installSource: 'builtin',
}))

// Known third-party skills referenced by detect-and-reference posture (docs/INTEGRATIONS.md)
const UPSTREAM_SKILLS: SkillEntry[] = [
  {
    id: 'superpowers:using-superpowers',
    owner: 'claude-plugins-official',
    role: 'session-bootstrap',
    installCmd: '/plugin add claude-plugins-official/superpowers',
    installSource: 'plugin',
  },
  {
    id: 'pr-review-toolkit:review-pr',
    owner: 'claude-plugins-official',
    role: 'pr-review',
    installCmd: '/plugin add claude-plugins-official/pr-review-toolkit',
    installSource: 'plugin',
  },
  {
    id: 'frontend-design:frontend-design',
    owner: 'claude-plugins-official',
    role: 'ui-design',
    installCmd: '/plugin add claude-plugins-official/frontend-design',
    installSource: 'plugin',
  },
]

export const SKILLS_MATRIX: SkillEntry[] = [...ARBITER_SKILLS, ...UPSTREAM_SKILLS]
