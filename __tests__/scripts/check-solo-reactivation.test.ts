// SPDX-License-Identifier: Apache-2.0
/**
 * Behavioural tests — rendered solo reactivation gate (#1250 §11.10(k))
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const SCRIPT_NAME = 'check-solo-reactivation.mjs'
const renderedScript = renderTemplate(
  'scripts/check-solo-reactivation.mjs.ejs',
  makeConfig('/tmp/x', {
    collaborationMode: 'trunk-solo',
    governanceLevel: 'L3',
  }) as unknown as Record<string, unknown>,
)

interface CommandResult {
  status: number
  stdout: string
  stderr: string
}

const repoDirs: string[] = []

function testEmail(localPart: string): string {
  return `${localPart}${'@'}example.invalid`
}

function makeTempDir(): string {
  const repoDir = mkdtempSync(join(tmpdir(), 'solo-reactivation-'))
  repoDirs.push(repoDir)
  return repoDir
}

function makeRepo(authorEmails: string[]): string {
  const repoDir = makeTempDir()
  const init = spawnSync('git', ['init', '-q'], { cwd: repoDir, encoding: 'utf-8' })
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)

  for (const email of authorEmails) {
    const commit = spawnSync(
      'git',
      [
        '-c',
        'user.name=Test Author',
        '-c',
        `user.email=${email}`,
        'commit',
        '--allow-empty',
        '-q',
        '-m',
        'x',
      ],
      // Git identity environment variables override -c user.email; pin them so ambient values cannot collapse this fixture's distinct authors.
      {
        cwd: repoDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test Author',
          GIT_COMMITTER_NAME: 'Test Author',
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_EMAIL: email,
        },
      },
    )
    if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}`)
  }

  writeFileSync(join(repoDir, SCRIPT_NAME), renderedScript)
  return repoDir
}

function run(repoDir: string, env: NodeJS.ProcessEnv = {}): CommandResult {
  const processEnv = { ...process.env, ...env }
  if (env.EXTERNAL_AUDIT === undefined) {
    delete processEnv.EXTERNAL_AUDIT
  }
  const r = spawnSync('node', [join(repoDir, SCRIPT_NAME)], {
    cwd: repoDir,
    encoding: 'utf-8',
    env: processEnv,
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function cleanupRepos(): void {
  for (const repoDir of repoDirs.splice(0)) {
    rmSync(repoDir, { recursive: true, force: true })
  }
}

afterEach(cleanupRepos)
afterAll(cleanupRepos)

describe('scripts/check-solo-reactivation.mjs (#1250 §11.10(k)) — rendered gate behaviour', () => {
  it('passes for one distinct author without an external audit', () => {
    const r = run(makeRepo([testEmail('one')]), { EXTERNAL_AUDIT: undefined })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/OK/)
    expect(r.stdout).toMatch(/1 distinct author/)
  }, 20_000)

  it('passes for two distinct authors below the threshold', () => {
    const r = run(makeRepo([testEmail('one'), testEmail('two')]), {
      EXTERNAL_AUDIT: undefined,
    })
    expect(r.status).toBe(0)
  }, 20_000)

  it('triggers for three distinct authors', () => {
    const r = run(makeRepo([testEmail('one'), testEmail('two'), testEmail('three')]), {
      EXTERNAL_AUDIT: undefined,
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/REACTIVATION TRIGGERED/)
    expect(r.stderr).toMatch(/3 distinct author/)
  }, 20_000)

  it('triggers for an external audit', () => {
    const r = run(makeRepo([testEmail('one')]), { EXTERNAL_AUDIT: 'true' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/EXTERNAL_AUDIT/)
  }, 20_000)

  it('passes when EXTERNAL_AUDIT is false', () => {
    const r = run(makeRepo([testEmail('one')]), { EXTERNAL_AUDIT: 'false' })
    expect(r.status).toBe(0)
  }, 20_000)

  it('fails closed outside a git repository', () => {
    const repoDir = makeTempDir()
    writeFileSync(join(repoDir, SCRIPT_NAME), renderedScript)
    const r = run(repoDir, { EXTERNAL_AUDIT: undefined })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/git/i)
  }, 20_000)
})
