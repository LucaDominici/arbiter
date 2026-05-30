import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { runGenerators } from '../../src/commands/init.js'
import { getLanguageHooks } from '../../src/detectors/language-hooks.js'

describe('brownfield: existing AGENTS.md', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function configWithExistingAgentsMd() {
    return makeConfig(dir, {
      language: 'typescript',
      buildTool: 'npm',
      buildCommand: 'npm run build',
      testCommand: 'npm test',
      lintCommand: 'npm run lint',
      formatCommand: 'npx prettier --check .',
      tools: ['claude'],
      useGitHub: false,
      languageHooks: getLanguageHooks('typescript'),
      existing: {
        agentsMd: true,
        claudeDir: false,
        agentsDir: false,
        aiRulez: false,
        settingsJson: false,
        checkAllScript: false,
      },
    })
  }

  it('backs up existing AGENTS.md before replacing', () => {
    const original = '# ORIGINAL CONTENT\nThis is hand-written governance.'
    writeFileSync(join(dir, 'AGENTS.md'), original)

    const config = configWithExistingAgentsMd()
    runGenerators(config)

    expect(existsSync(join(dir, 'AGENTS.md.arbiter-backup'))).toBe(true)
    const backup = readFileSync(join(dir, 'AGENTS.md.arbiter-backup'), 'utf-8')
    expect(backup).toBe(original)
  })

  it('replaces AGENTS.md with arbiter-generated content', () => {
    const original = '# ORIGINAL CONTENT\nThis is hand-written governance.'
    writeFileSync(join(dir, 'AGENTS.md'), original)

    const config = configWithExistingAgentsMd()
    runGenerators(config)

    const newContent = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(newContent).not.toContain('ORIGINAL CONTENT')
    expect(newContent).toContain('AGENTS.md')
    expect(newContent).toContain('Invariants')
  })

  it('returns backed-up-and-replaced action for AGENTS.md', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# old')

    const config = configWithExistingAgentsMd()
    const results = runGenerators(config)

    const agentsResult = results.find((r) => r.path.endsWith('AGENTS.md'))
    expect(agentsResult).toBeDefined()
    expect(agentsResult!.action).toBe('backed-up-and-replaced')
  })

  it('second identical run skips and leaves the first-run backup untouched (#1077 F6)', () => {
    const userContent = '# first version'
    writeFileSync(join(dir, 'AGENTS.md'), userContent)

    const config = configWithExistingAgentsMd()
    // First run backs up the user content and writes arbiter content.
    const first = runGenerators(config)
    expect(first.find((r) => r.path.endsWith('AGENTS.md'))?.action).toBe('backed-up-and-replaced')
    const backupPath = join(dir, 'AGENTS.md.arbiter-backup')
    expect(readFileSync(backupPath, 'utf-8')).toBe(userContent)

    // Second run with no on-disk change: arbiter content is byte-identical, so
    // writeFile SKIPS — it does NOT re-back-up or churn the file. The backup
    // therefore still holds the user's original content, not the arbiter output.
    // (Previously this was non-idempotent: every run overwrote the backup.)
    const second = runGenerators(config)
    expect(second.find((r) => r.path.endsWith('AGENTS.md'))?.action).toBe('skipped')
    expect(readFileSync(backupPath, 'utf-8')).toBe(userContent)
  })

  it('a differing second run backs up the current content before replacing (#1077)', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# first version')

    const config = configWithExistingAgentsMd()
    // First run replaces user content with arbiter content.
    runGenerators(config)
    const backupPath = join(dir, 'AGENTS.md.arbiter-backup')
    const arbiterContent = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')

    // Simulate a manual edit so the next regeneration genuinely differs from disk.
    writeFileSync(join(dir, 'AGENTS.md'), '# manually edited again\n')

    // Second (differing) run backs up the latest pre-run state and restores arbiter content.
    const second = runGenerators(config)
    expect(second.find((r) => r.path.endsWith('AGENTS.md'))?.action).toBe('backed-up-and-replaced')
    expect(readFileSync(backupPath, 'utf-8')).toBe('# manually edited again\n')
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toBe(arbiterContent)
  })
})
