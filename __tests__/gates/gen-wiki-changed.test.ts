// SPDX-License-Identifier: Apache-2.0
// TDD regression tests for #2111: --changed detects wiki source_sha drift.
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const generator = join(root, 'scripts', 'gen-wiki.mjs')
const template = join(root, 'src', 'templates', 'scripts', 'gen-wiki.mjs.ejs')
const tempDirs: string[] = []

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf-8' })
  expect(result.status, `${command} ${args.join(' ')} failed:\n${result.stderr}`).toBe(0)
  return result.stdout
}

function createRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'gen-wiki-changed-'))
  tempDirs.push(repo)
  mkdirSync(join(repo, 'docs'), { recursive: true })
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  copyFileSync(generator, join(repo, 'scripts', 'gen-wiki.mjs'))
  writeFileSync(join(repo, 'docs', 'guide.md'), '# Guide\n\nInitial content.\n')
  run('git', ['init'], repo)
  run('git', ['config', 'user.email', 'test@example.com'], repo)
  run('git', ['config', 'user.name', 'Test User'], repo)
  run('git', ['add', '.'], repo)
  run('git', ['commit', '-m', 'initial wiki source'], repo)
  return repo
}

function runGenerator(repo: string, ...args: string[]): string {
  return run('node', ['scripts/gen-wiki.mjs', ...args], repo)
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('gen-wiki.mjs --changed (#2111)', () => {
  it('regenerates a source_sha mismatch even when the docs change is outside HEAD~1', () => {
    const repo = createRepo()
    runGenerator(repo)
    writeFileSync(join(repo, 'docs', 'guide.md'), '# Guide\n\nUpdated content.\n')
    run('git', ['add', 'docs/guide.md'], repo)
    run('git', ['commit', '-m', 'update guide'], repo)
    writeFileSync(join(repo, 'README.md'), '# Unrelated\n')
    run('git', ['add', 'README.md'], repo)
    run('git', ['commit', '-m', 'unrelated change'], repo)

    runGenerator(repo, '--changed')

    const expectedSha = run('git', ['hash-object', 'docs/guide.md'], repo).trim()
    const page = readFileSync(join(repo, 'wiki', 'guide.md'), 'utf-8')
    expect(page).toContain(`source_sha: '${expectedSha}'`)
  })

  it('reports zero pages written when no source_sha values are stale', () => {
    const repo = createRepo()
    runGenerator(repo)
    runGenerator(repo, '--changed')

    const output = runGenerator(repo, '--changed')

    expect(output).toContain('0 page(s) written')
  })

  it('keeps the target-project template free of the one-commit selection and count fallback', () => {
    const source = readFileSync(template, 'utf-8')

    expect(source).not.toContain('HEAD~1')
    expect(source).not.toContain('generated > 0 ? generated')
  })
})
