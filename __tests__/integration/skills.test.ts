import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const commandsDir = join(__dirname, '..', '..', '.claude', 'commands')

describe('/wt-open skill', () => {
  const skillPath = join(commandsDir, 'wt-open.md')

  it('exists at .claude/commands/wt-open.md', () => {
    expect(existsSync(skillPath)).toBe(true)
  })

  it('references git worktree add command', () => {
    const content = readFileSync(skillPath, 'utf-8')
    expect(content).toContain('git worktree add')
  })

  it('mentions worktree path parsing', () => {
    const content = readFileSync(skillPath, 'utf-8')
    expect(content).toMatch(/worktree/i)
  })

  it('mentions the sibling directory pattern', () => {
    const content = readFileSync(skillPath, 'utf-8')
    expect(content).toMatch(/sibling/i)
  })
})

describe('/wt-close skill', () => {
  const skillPath = join(commandsDir, 'wt-close.md')

  it('exists at .claude/commands/wt-close.md', () => {
    expect(existsSync(skillPath)).toBe(true)
  })

  it('references git worktree remove command', () => {
    const content = readFileSync(skillPath, 'utf-8')
    expect(content).toContain('git worktree remove')
  })

  it('mentions harvest option', () => {
    const content = readFileSync(skillPath, 'utf-8')
    expect(content).toMatch(/harvest/i)
  })

  it('mentions switching back to main repo', () => {
    const content = readFileSync(skillPath, 'utf-8')
    expect(content).toMatch(/main.*repo|cd/i)
  })
})
