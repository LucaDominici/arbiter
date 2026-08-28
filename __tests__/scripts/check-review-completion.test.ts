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
}

function output(result: CheckResult): string {
  return `${result.stdout}${result.stderr}`
}

function runCheck(
  sidecar: string,
  evidenceDir: string,
  repoRoot: string,
  task: string = TASK,
): CheckResult {
  const result = spawnSync(
    'node',
    [
      CHECK_SCRIPT,
      '--task',
      task,
      `--sidecar=${sidecar}`,
      '--evidence-dir',
      evidenceDir,
      `--schema=${SCHEMA}`,
      '--repo-root',
      repoRoot,
    ],
    { encoding: 'utf-8', timeout: 10000 },
  )
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

  it('uses the legacy count fallback when two reviewer envelopes were returned', () => {
    writeSidecar({ count: 2, branch: BRANCH, sha: '0123456789abcdef' })
    writeEnvelope('alpha', envelope('alpha'))
    writeEnvelope('beta', envelope('beta'))

    expect(runCheck(sidecar, evidenceDir, tmpDir).exitCode).toBe(0)
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

  it('exits 0 when the dispatch sidecar is absent', () => {
    expect(runCheck(sidecar, evidenceDir, tmpDir).exitCode).toBe(0)
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
