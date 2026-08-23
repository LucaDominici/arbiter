import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig } from '../../helpers.js'

const REPO_ROOT = resolve(process.cwd())
const RAW_HOOK_PATH = join(REPO_ROOT, '.claude', 'hooks', 'check-no-any.mjs')
const AXIS_PATH = join(REPO_ROOT, 'src', 'detectors', 'axis.ts')
const ANY_TYPE = 'any'
const VALID_SUPPRESSION =
  '// arbiter-suppress(INV-04, until=2099-01-01, reason="Legacy dependency injection boundary", owner=@luca)'

function makeRawHook(): { dir: string; hookPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-check-no-any-'))
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  const hookPath = join(hooksDir, 'check-no-any.mjs')
  writeFileSync(hookPath, readFileSync(RAW_HOOK_PATH, 'utf-8'))
  writeFileSync(
    join(hooksDir, 'lib.mjs'),
    renderTemplate(
      'claude/hooks/lib.mjs.ejs',
      makeConfig(dir, {
        language: 'typescript',
        projectName: 'check-no-any-test',
        testCommand: 'npm test',
        lintCommand: 'npm run lint',
        formatCommand: 'npx prettier --write',
      }),
    ),
  )
  return { dir, hookPath }
}

function runHook(hookPath: string, cwd: string, filePath: string) {
  return spawnSync('node', [hookPath], {
    cwd,
    encoding: 'utf-8',
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    timeout: 5000,
  })
}

describe('check-no-any — empirical fire', () => {
  let dir: string
  let hookPath: string

  beforeEach(() => {
    ;({ dir, hookPath } = makeRawHook())
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('allows line, block, and JSDoc comments that mention the type word', () => {
    const filePath = join(dir, 'comments-only.ts')
    writeFileSync(
      filePath,
      [
        '// This prose mentions any value.',
        '/* This block comment also mentions any value. */',
        '/**',
        ' * Precedence: any field already explicit on `stored` wins.',
        ' */',
        'export const value = 1',
      ].join('\n'),
    )

    const result = runHook(hookPath, dir, filePath)

    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('blocks an explicit annotation and names its offending line', () => {
    const filePath = join(dir, 'violation.ts')
    writeFileSync(filePath, `const x: ${ANY_TYPE} = 1\n`)

    const result = runHook(hookPath, dir, filePath)

    expect(result.status).toBe(2) // #2326: exit 2 is the blocking code
    expect(result.stderr).toContain('[arbiter] INV-04:')
    expect(result.stderr).toContain(`1: const x: ${ANY_TYPE} = 1`)
  })

  it('blocks an explicit annotation before a trailing comment', () => {
    const filePath = join(dir, 'trailing-comment.ts')
    writeFileSync(filePath, `const x: ${ANY_TYPE} = 1 // legitimate prose\n`)

    const result = runHook(hookPath, dir, filePath)

    expect(result.status).toBe(2) // #2326: exit 2 is the blocking code
    expect(result.stderr).toContain('[arbiter] INV-04:')
    expect(result.stderr).toContain(`1: const x: ${ANY_TYPE} = 1 // legitimate prose`)
  })

  it('honors a valid inline suppression for an explicit annotation', () => {
    const filePath = join(dir, 'suppressed.ts')
    writeFileSync(filePath, `${VALID_SUPPRESSION}\nconst x: ${ANY_TYPE} = 1\n`)

    const result = runHook(hookPath, dir, filePath)

    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('allows the repository axis detector source', () => {
    const result = runHook(RAW_HOOK_PATH, REPO_ROOT, AXIS_PATH)

    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
  })
})
