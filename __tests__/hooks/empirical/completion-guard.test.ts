import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'

function configFor() {
  return makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
    buildTool: 'npm',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --write',
  })
}

function setup(phase: string) {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-completion-guard-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })

  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', configFor()))

  const hookPath = join(hooksDir, 'guard-task-completion.mjs')
  writeFileSync(hookPath, renderTemplate('claude/hooks/guard-task-completion.mjs.ejs', configFor()))

  writeTaskStateFile(dir, { phase, tier: 'Standard' })
  writeFileSync(join(dir, '.agents-dispatched'), '4\n')

  return { dir, hookPath }
}

describe('completion-guard — empirical spawn', () => {
  it('exits 2 and writes to stderr on completion claim during red phase', () => {
    const { dir, hookPath } = setup('red')
    try {
      const result = spawnSync('node', [hookPath], {
        cwd: dir,
        input: JSON.stringify({ prompt: 'task complete, ready to merge' }),
        encoding: 'utf-8',
      })

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('COMPLETION GUARD')
      expect(result.stdout).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 on benign prompt (no completion claim)', () => {
    const { dir, hookPath } = setup('red')
    try {
      const result = spawnSync('node', [hookPath], {
        cwd: dir,
        input: JSON.stringify({
          prompt: 'can you help me refactor this function?',
        }),
        encoding: 'utf-8',
      })

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 and writes to stderr on completion claim during verification', () => {
    const { dir, hookPath } = setup('verification')
    try {
      const result = spawnSync('node', [hookPath], {
        cwd: dir,
        input: JSON.stringify({ prompt: 'task complete, ready to merge' }),
        encoding: 'utf-8',
      })

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('COMPLETION GUARD')
      expect(result.stdout).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when phase is complete (completion allowed)', () => {
    const { dir, hookPath } = setup('complete')
    try {
      const result = spawnSync('node', [hookPath], {
        cwd: dir,
        input: JSON.stringify({ prompt: 'task complete, ready to merge' }),
        encoding: 'utf-8',
      })

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
