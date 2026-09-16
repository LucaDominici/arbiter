import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const commandsDir = join(__dirname, '..', '..', '.claude', 'commands')
const waveDrainPath = join(__dirname, '..', '..', '.claude', 'skills', 'wave-drain', 'SKILL.md')

describe('native worktree guidance', () => {
  it('does not expose retired worktree slash commands', () => {
    for (const command of ['wt-open.md', 'wt-close.md', 'wt-list.md', 'wt-prune.md']) {
      expect(existsSync(join(commandsDir, command))).toBe(false)
    }
  })

  it('routes wave worktrees through the native host and canonical CLI helpers', () => {
    const content = readFileSync(waveDrainPath, 'utf-8')
    expect(content).toContain('native host')
    expect(content).toContain('arbiter worktree prepare/check/relink')
    expect(content).not.toMatch(/\/(?:wt-open|wt-close|wt-list|wt-prune)\b/)
  })
})
