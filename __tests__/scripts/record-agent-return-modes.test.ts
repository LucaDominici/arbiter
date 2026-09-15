// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const RECORDER = new URL('../../scripts/record-agent-return.mjs', import.meta.url).pathname
const CHECK = new URL('../../scripts/check-acceptance.mjs', import.meta.url).pathname
const PLAN = [
  '## Acceptance Criteria',
  '- [ ] AC-1: records the exact verifier result',
  '## Non-Goals',
  '- no alternate evidence store',
].join('\n')

let root: string

function head() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}

function envelope(sha = head()) {
  return {
    schema: 'arbiter-agent-return-v1',
    agent: 'acceptance-verifier',
    role: 'verifier',
    taskId: '#42',
    branch: 'task/#42-fit',
    sha,
    ts: '2026-09-15T00:00:00.000Z',
    verdict: 'PASS',
    confidence: 1,
    findings: [],
    acceptanceFit: {
      schema: 'arbiter-ac-fit-v1',
      taskId: '#42',
      criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'plan.md', line: 2 }] }],
    },
  }
}

function record(input: unknown) {
  return spawnSync(
    process.execPath,
    [RECORDER, '--mode', 'ac-fit', '--task', '#42', '--repo-root', root],
    { cwd: root, encoding: 'utf8', input: JSON.stringify(input) },
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arbiter-record-fit-'))
  execFileSync('git', ['init', '-b', 'task/#42-fit'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@fixture.invalid'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root })
  writeFileSync(join(root, 'plan.md'), PLAN)
  execFileSync('git', ['add', 'plan.md'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'test: seed'], { cwd: root, stdio: 'ignore' })
  mkdirSync(join(root, '.claude', '.task'), { recursive: true })
  writeFileSync(
    join(root, '.claude', '.task', 'status.json'),
    JSON.stringify({
      taskId: '#42',
      phase: 'verification',
      plan: 'plan.md',
      branch: 'task/#42-fit',
    }),
  )
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('record-agent-return evidence modes (#2687)', () => {
  it('derives the task-keyed fit from the recorded verifier envelope and admission accepts it', () => {
    const result = record(envelope())
    expect(result.status, result.stderr + result.stdout).toBe(0)

    const fit = JSON.parse(
      readFileSync(join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'), 'utf8'),
    )
    expect(fit).toMatchObject({ taskId: '#42', branch: 'task/#42-fit', sha: head() })
    expect(fit.sourceEnvelope).toMatchObject({
      path: expect.any(String),
      sha256: expect.any(String),
    })
    const check = spawnSync(process.execPath, [CHECK], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ARBITER_ACCEPTANCE_ANCHOR: '1' },
    })
    expect(check.status, check.stderr + check.stdout).toBe(0)
  })

  it('rejects a stale supplied SHA without replacing prior valid fit evidence', () => {
    expect(record(envelope()).status).toBe(0)
    const path = join(root, '.arbiter', 'evidence', 'ac-fit', '42.json')
    const before = readFileSync(path, 'utf8')

    const stale = record(envelope('deadbeef'))

    expect(stale.status).toBe(1)
    expect(stale.stdout + stale.stderr).toMatch(/sha|stale/i)
    expect(readFileSync(path, 'utf8')).toBe(before)
  })
})
