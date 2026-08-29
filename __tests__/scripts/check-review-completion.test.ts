// SPDX-License-Identifier: Apache-2.0
/**
 * RED tests for the task-scoped review-completion gate (#2177).
 *
 * The gate reconciles the review agents recorded in agents-dispatched.json with
 * their agent-return envelopes, so an orchestrator can re-dispatch an agent
 * whose review artifact did not arrive.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHECK_SCRIPT = new URL('../../scripts/check-review-completion.mjs', import.meta.url).pathname
const SCHEMA = new URL('../../schemas/agent-return.schema.json', import.meta.url).pathname
const TASK = '#2177'
const BRANCH = 'task/#2177'

type CheckResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type Sidecar = {
  count: number
  branch: string
  sha: string
  agents?: string[]
  taskId?: string
}

function output(result: CheckResult): string {
  return `${result.stdout}${result.stderr}`
}

function runCheck(
  sidecar: string,
  evidenceDir: string,
  repoRoot: string,
  task: string | null = TASK,
): CheckResult {
  const args = [
    CHECK_SCRIPT,
    `--sidecar=${sidecar}`,
    '--evidence-dir',
    evidenceDir,
    `--schema=${SCHEMA}`,
    '--repo-root',
    repoRoot,
  ]
  if (task !== null) args.splice(1, 0, '--task', task)
  const result = spawnSync('node', args, { encoding: 'utf-8', timeout: 10000 })
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function envelope(agent: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'arbiter-agent-return-v1',
    agent,
    role: 'reviewer',
    taskId: TASK,
    branch: BRANCH,
    sha: '0123456789abcdef',
    ts: '2026-08-02T10:00:00.000Z',
    verdict: 'PASS',
    confidence: 0.8,
    findings: [],
    ...overrides,
  }
}

describe('check-review-completion.mjs', () => {
  let tmpDir: string
  let sidecar: string
  let evidenceDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'review-completion-test-'))
    sidecar = join(tmpDir, '.arbiter', 'agents-dispatched.json')
    evidenceDir = join(tmpDir, '.arbiter', 'evidence', 'agent-returns')
    mkdirSync(evidenceDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeSidecar(value: Sidecar): void {
    mkdirSync(join(sidecar, '..'), { recursive: true })
    writeFileSync(sidecar, JSON.stringify({ taskId: TASK, ...value }, null, 2))
  }

  function writeTasklessSidecar(value: Sidecar): void {
    mkdirSync(join(sidecar, '..'), { recursive: true })
    writeFileSync(sidecar, JSON.stringify(value, null, 2))
  }

  function writeEnvelopeIn(taskDirName: string, name: string, body: Record<string, unknown>): void {
    const taskDir = join(evidenceDir, taskDirName)
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, `${name}.json`), JSON.stringify(body, null, 2))
  }

  function writeEnvelope(name: string, body: Record<string, unknown>): void {
    writeEnvelopeIn('_2177', name, body)
  }

  it('exits 0 when every dispatched agent returned a well-formed envelope', () => {
    writeSidecar({ count: 2, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha', 'beta'] })
    writeEnvelope('alpha', envelope('alpha'))
    writeEnvelope('beta', envelope('beta'))

    expect(runCheck(sidecar, evidenceDir, tmpDir).exitCode).toBe(0)
  })

  it('uses the recorder-compatible underscore-sanitized task directory', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha'] })
    writeEnvelope('alpha', envelope('alpha'))

    expect(runCheck(sidecar, evidenceDir, tmpDir).exitCode).toBe(0)
  })

  it('accepts legacy task directories when no recorder-compatible directory exists', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha'] })
    writeEnvelopeIn('2177', 'alpha', envelope('alpha'))

    expect(runCheck(sidecar, evidenceDir, tmpDir).exitCode).toBe(0)
  })

  it('fails closed when the recorder-compatible task directory is a symlink', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha'] })
    const outside = join(tmpDir, 'outside')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'alpha.json'), JSON.stringify(envelope('alpha'), null, 2))
    symlinkSync(outside, join(evidenceDir, '_2177'), 'dir')

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(2)
    expect(output(result)).toMatch(/symlink/i)
  })

  it('recognizes recorder-sanitized agent filenames when reporting malformed returns', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['reviewer/foo'] })
    writeEnvelopeIn('_2177', 'reviewer-foo-0', {})

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toMatch(/missing, empty, malformed, or schema-invalid/)
  })

  it('fails closed when an evidence-root ancestor is a symlink', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha'] })
    const evidenceParent = join(tmpDir, '.arbiter', 'evidence')
    const outside = join(tmpDir, 'outside')
    rmSync(evidenceParent, { recursive: true, force: true })
    mkdirSync(join(outside, 'agent-returns', '_2177'), { recursive: true })
    writeFileSync(
      join(outside, 'agent-returns', '_2177', 'alpha.json'),
      JSON.stringify(envelope('alpha'), null, 2),
    )
    symlinkSync(outside, evidenceParent, 'dir')

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(2)
    expect(output(result)).toMatch(/symlink/i)
  })

  it('exits 1 and names a dispatched agent that has no envelope', () => {
    writeSidecar({ count: 2, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha', 'beta'] })
    writeEnvelope('alpha', envelope('alpha'))

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toContain('beta')
  })

  it('exits 1 and names an agent whose envelope artifact is empty', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha'] })
    const taskDir = join(evidenceDir, '_2177')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, 'alpha.json'), '')

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toContain('alpha')
  })

  it('exits 1 and names an agent whose envelope artifact is malformed JSON', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha'] })
    const taskDir = join(evidenceDir, '_2177')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, 'alpha.json'), '{not valid json')

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toContain('alpha')
  })

  it('exits 1 and prints the expected branch for a stale envelope', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha'] })
    writeEnvelope('alpha', envelope('alpha', { branch: 'task/#9999' }))

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toContain(BRANCH)
  })

  it('rejects a same-branch envelope from a different commit', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha'] })
    writeEnvelope('alpha', envelope('alpha', { sha: 'deadbeef' }))

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toMatch(/sha/i)
  })

  it('uses the legacy count fallback when two reviewer envelopes were returned', () => {
    writeSidecar({ count: 2, branch: BRANCH, sha: '0123456789abcdef' })
    writeEnvelope('alpha', envelope('alpha'))
    writeEnvelope('beta', envelope('beta'))

    expect(runCheck(sidecar, evidenceDir, tmpDir).exitCode).toBe(0)
  })

  it('rejects legacy reviewer returns from a different commit', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef' })
    writeEnvelope('alpha', envelope('alpha', { sha: 'deadbeef' }))

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toMatch(/found 0/)
  })

  it('rejects a named reviewer return for a different task', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha'] })
    writeEnvelope('alpha', envelope('alpha', { taskId: '#9999' }))

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toMatch(/task/i)
  })

  it('rejects a named return whose role is not reviewer', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha'] })
    writeEnvelope('alpha', envelope('alpha', { role: 'scanner' }))

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toMatch(/missing|reviewer/i)
  })

  it('rejects a valid envelope whose filename belongs to another agent', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha'] })
    writeEnvelopeIn('_2177', 'evil-name', envelope('alpha'))

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toMatch(/missing/i)
  })

  it('counts distinct reviewer agents in the legacy fallback', () => {
    writeSidecar({ count: 2, branch: BRANCH, sha: '0123456789abcdef' })
    writeEnvelopeIn('_2177', 'alpha-0', envelope('alpha'))
    writeEnvelopeIn('_2177', 'alpha-1', envelope('alpha'))

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toMatch(/found 1/)
  })

  it('fails the legacy count fallback when only one of two reviewer envelopes was returned', () => {
    writeSidecar({ count: 2, branch: BRANCH, sha: '0123456789abcdef' })
    writeEnvelope('alpha', envelope('alpha'))

    expect(runCheck(sidecar, evidenceDir, tmpDir).exitCode).toBe(1)
  })

  it('does not count a non-reviewer envelope toward the legacy fallback', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef' })
    writeEnvelope('verifier', envelope('verifier', { role: 'verifier' }))

    expect(runCheck(sidecar, evidenceDir, tmpDir).exitCode).toBe(1)
  })

  it('fails when a task has no dispatch sidecar', () => {
    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toMatch(/sidecar is required/i)
  })

  it('exits 0 without task context when the dispatch sidecar is absent', () => {
    expect(runCheck(sidecar, evidenceDir, tmpDir, null).exitCode).toBe(0)
  })

  it('fails closed when the dispatch sidecar is a symlink', () => {
    const outside = join(tmpDir, 'outside.json')
    writeFileSync(outside, '{}')
    symlinkSync(outside, sidecar)

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(2)
    expect(output(result)).toMatch(/symlink/i)
  })

  it('exits 2 when the dispatch sidecar contains malformed JSON', () => {
    mkdirSync(join(sidecar, '..'), { recursive: true })
    writeFileSync(sidecar, '{not valid json')

    expect(runCheck(sidecar, evidenceDir, tmpDir).exitCode).toBe(2)
  })

  it('exits 1 when named agents are fewer than the recorded dispatch count', () => {
    writeSidecar({ count: 3, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha', 'beta'] })
    writeEnvelope('alpha', envelope('alpha'))
    writeEnvelope('beta', envelope('beta'))

    expect(runCheck(sidecar, evidenceDir, tmpDir).exitCode).toBe(1)
  })

  it('rejects duplicate named agents in the dispatch sidecar', () => {
    writeSidecar({ count: 2, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha', 'alpha'] })
    writeEnvelope('alpha', envelope('alpha'))

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(2)
    expect(output(result)).toMatch(/sidecar/i)
  })

  it('rejects an empty reviewer panel', () => {
    writeSidecar({ count: 0, branch: BRANCH, sha: '0123456789abcdef', agents: [] })

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(2)
    expect(output(result)).toMatch(/sidecar/i)
  })

  // #2399: the tracked sidecar is shared by every branch, so one recorded for another
  // task is ABSENT for this one — required (exit 1) rather than a mismatch error, and the
  // message names the other task so the failure does not read as a missing file.
  it('treats a sidecar recorded for another task as absent', () => {
    writeSidecar({
      count: 1,
      agents: ['alpha'],
      taskId: '#9999',
      branch: BRANCH,
      sha: '0123456789abcdef',
    })
    writeEnvelope('alpha', envelope('alpha'))

    const result = runCheck(sidecar, evidenceDir, tmpDir)
    expect(result.exitCode).toBe(1)
    expect(output(result)).toContain('#9999')
    expect(output(result)).toMatch(/belongs to task/i)
  })

  it('rejects an explicit task when a legacy sidecar has no task id', () => {
    writeTasklessSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef' })
    writeEnvelopeIn('_9999', 'alpha', envelope('alpha', { taskId: '#9999' }))

    const result = runCheck(sidecar, evidenceDir, tmpDir, '#9999')
    expect(result.exitCode).toBe(2)
    expect(output(result)).toMatch(/task/i)
  })

  // #2399: the gate runs without --task in the L2 ring; a leftover sidecar from another
  // branch's task must not fail it — it is absent, and the message says whose it is.
  it('ignores a foreign sidecar for the task recorded in .claude/.task/status.json', () => {
    mkdirSync(join(tmpDir, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(tmpDir, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#2399' }),
    )
    writeSidecar({
      count: 1,
      agents: ['alpha'],
      taskId: '#9999',
      branch: BRANCH,
      sha: '0123456789abcdef',
    })

    const result = runCheck(sidecar, evidenceDir, tmpDir, null)
    expect(result.exitCode).toBe(0)
    expect(output(result)).toContain('#9999')
  })

  it('keeps an ancestor sidecar valid after an evidence-only commit', () => {
    const repo = mkdtempSync(join(tmpdir(), 'review-completion-git-'))
    try {
      const git = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf-8' })
      expect(git(['init', '-q']).status).toBe(0)
      expect(git(['config', 'user.email', 'test-user']).status).toBe(0)
      expect(git(['config', 'user.name', 'Test']).status).toBe(0)
      writeFileSync(join(repo, 'tracked.txt'), 'before\n')
      expect(git(['add', 'tracked.txt']).status).toBe(0)
      expect(git(['commit', '-qm', 'before']).status).toBe(0)
      const base = git(['rev-parse', 'HEAD']).stdout.trim()
      const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
      const evidence = join(repo, '.arbiter', 'evidence', 'agent-returns', '_2177')
      mkdirSync(evidence, { recursive: true })
      writeFileSync(
        join(repo, '.arbiter', 'agents-dispatched.json'),
        JSON.stringify({ taskId: TASK, count: 1, agents: ['alpha'], branch, sha: base }),
      )
      writeFileSync(
        join(evidence, 'alpha.json'),
        JSON.stringify(envelope('alpha', { branch, sha: base })),
      )
      // Committing the evidence moves HEAD without touching reviewed source.
      expect(git(['add', '-f', '--', '.arbiter']).status).toBe(0)
      expect(git(['commit', '-qm', 'record evidence']).status).toBe(0)

      const result = runCheck(
        join(repo, '.arbiter', 'agents-dispatched.json'),
        join(repo, '.arbiter', 'evidence', 'agent-returns'),
        repo,
      )
      expect(output(result)).toMatch(/reconciled/)
      expect(result.exitCode).toBe(0)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('binds the sidecar SHA to the current checkout when git metadata exists', () => {
    const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    })
    if (branchResult.status !== 0) return
    const currentBranch = branchResult.stdout.trim()
    writeSidecar({ count: 1, agents: ['alpha'], branch: currentBranch, sha: 'deadbeef' })
    writeEnvelope('alpha', envelope('alpha', { branch: currentBranch, sha: 'deadbeef' }))

    const result = runCheck(sidecar, evidenceDir, process.cwd())
    expect(result.exitCode).toBe(2)
    expect(output(result)).toMatch(/checkout|ancestor|sha/i)
  })

  it('rejects an ancestor sidecar after tracked files change', () => {
    const repo = mkdtempSync(join(tmpdir(), 'review-completion-git-'))
    try {
      const git = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf-8' })
      expect(git(['init', '-q']).status).toBe(0)
      expect(git(['config', 'user.email', 'test-user']).status).toBe(0)
      expect(git(['config', 'user.name', 'Test']).status).toBe(0)
      writeFileSync(join(repo, 'tracked.txt'), 'before\n')
      expect(git(['add', 'tracked.txt']).status).toBe(0)
      expect(git(['commit', '-qm', 'before']).status).toBe(0)
      const base = git(['rev-parse', 'HEAD']).stdout.trim()
      writeFileSync(join(repo, 'tracked.txt'), 'after\n')
      expect(git(['add', 'tracked.txt']).status).toBe(0)
      expect(git(['commit', '-qm', 'after']).status).toBe(0)
      const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
      const evidence = join(repo, '.arbiter', 'evidence', 'agent-returns', '_2177')
      mkdirSync(evidence, { recursive: true })
      writeFileSync(
        join(repo, '.arbiter', 'agents-dispatched.json'),
        JSON.stringify({ taskId: TASK, count: 1, agents: ['alpha'], branch, sha: base }),
      )
      writeFileSync(
        join(evidence, 'alpha.json'),
        JSON.stringify(envelope('alpha', { branch, sha: base })),
      )

      const result = runCheck(
        join(repo, '.arbiter', 'agents-dispatched.json'),
        join(repo, '.arbiter', 'evidence', 'agent-returns'),
        repo,
      )
      expect(result.exitCode).toBe(2)
      expect(output(result)).toMatch(/stale|changed|ancestor/i)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('rejects a sidecar when tracked files change without a commit', () => {
    const repo = mkdtempSync(join(tmpdir(), 'review-completion-git-'))
    try {
      const git = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf-8' })
      expect(git(['init', '-q']).status).toBe(0)
      expect(git(['config', 'user.email', 'test-user']).status).toBe(0)
      expect(git(['config', 'user.name', 'Test']).status).toBe(0)
      writeFileSync(join(repo, 'tracked.txt'), 'before\n')
      expect(git(['add', 'tracked.txt']).status).toBe(0)
      expect(git(['commit', '-qm', 'before']).status).toBe(0)
      const base = git(['rev-parse', 'HEAD']).stdout.trim()
      const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
      const evidence = join(repo, '.arbiter', 'evidence', 'agent-returns', '_2177')
      mkdirSync(evidence, { recursive: true })
      writeFileSync(
        join(repo, '.arbiter', 'agents-dispatched.json'),
        JSON.stringify({ taskId: TASK, count: 1, agents: ['alpha'], branch, sha: base }),
      )
      writeFileSync(
        join(evidence, 'alpha.json'),
        JSON.stringify(envelope('alpha', { branch, sha: base })),
      )
      writeFileSync(join(repo, 'tracked.txt'), 'after\n')

      const result = runCheck(
        join(repo, '.arbiter', 'agents-dispatched.json'),
        join(repo, '.arbiter', 'evidence', 'agent-returns'),
        repo,
      )
      expect(result.exitCode).toBe(2)
      expect(output(result)).toMatch(/stale|changed/i)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('rejects a sidecar when a source file is untracked', () => {
    const repo = mkdtempSync(join(tmpdir(), 'review-completion-git-'))
    try {
      const git = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf-8' })
      expect(git(['init', '-q']).status).toBe(0)
      expect(git(['config', 'user.email', 'test-user']).status).toBe(0)
      expect(git(['config', 'user.name', 'Test']).status).toBe(0)
      writeFileSync(join(repo, 'tracked.txt'), 'before\n')
      expect(git(['add', 'tracked.txt']).status).toBe(0)
      expect(git(['commit', '-qm', 'before']).status).toBe(0)
      const base = git(['rev-parse', 'HEAD']).stdout.trim()
      const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
      const evidence = join(repo, '.arbiter', 'evidence', 'agent-returns', '_2177')
      mkdirSync(evidence, { recursive: true })
      writeFileSync(
        join(repo, '.arbiter', 'agents-dispatched.json'),
        JSON.stringify({ taskId: TASK, count: 1, agents: ['alpha'], branch, sha: base }),
      )
      writeFileSync(
        join(evidence, 'alpha.json'),
        JSON.stringify(envelope('alpha', { branch, sha: base })),
      )
      writeFileSync(join(repo, 'untracked-source.ts'), 'export const stale = true\n')

      const result = runCheck(
        join(repo, '.arbiter', 'agents-dispatched.json'),
        join(repo, '.arbiter', 'evidence', 'agent-returns'),
        repo,
      )
      expect(result.exitCode).toBe(2)
      expect(output(result)).toMatch(/stale|changed|untracked/i)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('accepts a complete well-formed envelope without a turn-budget field', () => {
    writeSidecar({ count: 1, branch: BRANCH, sha: '0123456789abcdef', agents: ['alpha'] })
    writeEnvelope('alpha', envelope('alpha'))

    expect(runCheck(sidecar, evidenceDir, tmpDir).exitCode).toBe(0)
  })

  it('prints usage and exits 0 for --help', () => {
    const result = spawnSync('node', [CHECK_SCRIPT, '--help'], {
      encoding: 'utf-8',
      timeout: 10000,
    })

    expect(result.status).toBe(0)
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toMatch(/usage/i)
  })
})
