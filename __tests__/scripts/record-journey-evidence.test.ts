import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = process.cwd()
const WRITER = join(REPO_ROOT, 'scripts', 'record-journey-evidence.mjs')
const tempDirs: string[] = []

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function fixture(): { dir: string; branch: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-journey-writer-'))
  tempDirs.push(dir)
  git(dir, ['init', '-b', 'task/2382'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  git(dir, ['add', 'README.md'])
  git(dir, ['commit', '-m', 'fixture', '--no-gpg-sign'])
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'cli.js'), '#!/usr/bin/env node\n')
  return { dir, branch: git(dir, ['branch', '--show-current']), sha: git(dir, ['rev-parse', 'HEAD']) }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('record-journey-evidence.mjs (#2382)', () => {
  it('writes the artifact schema from the current checkout (AC-2382.1)', () => {
    const { dir, branch, sha } = fixture()
    const result = spawnSync(
      'node',
      [WRITER, '--task-id', '#2382', '--spec', 'node dist/cli.js --help', '--target', 'artifact'],
      { cwd: dir, encoding: 'utf8' },
    )

    expect(result.status).toBe(0)
    const path = join(dir, '.arbiter', 'evidence', 'journey', '_2382.json')
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      branch,
      sha,
      spec: 'node dist/cli.js --help',
      target: 'artifact',
    })
  })

  it('rejects a non-artifact target instead of recording dev-server evidence (AC-2382.1)', () => {
    const { dir } = fixture()
    const result = spawnSync(
      'node',
      [WRITER, '--task-id', '#2382', '--spec', 'npm run e2e', '--target', 'dev-server'],
      { cwd: dir, encoding: 'utf8' },
    )

    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/target.*artifact/i)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'journey', '_2382.json'))).toBe(false)
  })

  it('documents the runnable artifact command (AC-2382.1)', () => {
    const adr = readFileSync(join(REPO_ROOT, 'docs', 'internal', 'ADR', '037-evidence-harness-target-projects.md'), 'utf8')
    expect(adr).toContain('node scripts/record-journey-evidence.mjs')
    expect(adr).toContain('--target artifact')
  })
})
