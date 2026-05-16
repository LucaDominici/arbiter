// SPDX-License-Identifier: Apache-2.0
// Minimal superpowers skill presence check (#550).
// Full detector with discovery + metadata ships in #556.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Returns true if the named superpowers skill is present at either the
 * project-local path or the user-global path.
 *
 * Checked paths (first match wins):
 *   <projectRoot>/.claude/skills/<skillName>/SKILL.md
 *   ~/.claude/skills/superpowers/<skillName>/SKILL.md
 */
export function hasSuperpowersSkill(
  skillName: string,
  projectRoot: string,
  homeDir?: string,
): boolean {
  const local = join(projectRoot, '.claude', 'skills', skillName, 'SKILL.md')
  if (existsSync(local)) return true

  const resolvedHome = homeDir ?? homedir()
  const globalPath = join(resolvedHome, '.claude', 'skills', 'superpowers', skillName, 'SKILL.md')
  return existsSync(globalPath)
}
