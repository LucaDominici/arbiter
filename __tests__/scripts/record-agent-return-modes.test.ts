// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

function recordWithEnv(input: unknown, env: Record<string, string>) {
  return spawnSync(
    process.execPath,
    [RECORDER, '--mode', 'ac-fit', '--task', '#42', '--repo-root', root],
    { cwd: root, encoding: 'utf8', input: JSON.stringify(input), env: { ...process.env, ...env } },
  )
}

function recordPanel(envelopes: unknown[]) {
  return spawnSync(
    process.execPath,
    [RECORDER, '--mode', 'reviewer-panel', '--task', '#42', '--repo-root', root],
    { cwd: root, encoding: 'utf8', input: JSON.stringify({ envelopes }) },
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arbiter-record-fit-'))
  execFileSync('git', ['init', '-b', 'task/#42-fit'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'fixture.invalid'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root })
  writeFileSync(join(root, 'plan.md'), PLAN)
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(
    join(root, 'scripts', 'route-auditors.mjs'),
    "process.stdin.resume(); process.stdin.on('end',()=>console.log(JSON.stringify({active:[]})))\n",
  )
  execFileSync('git', ['add', 'plan.md'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'test: seed'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: root })
  mkdirSync(join(root, '.claude', '.task'), { recursive: true })
  writeFileSync(
    join(root, '.claude', '.task', 'status.json'),
    JSON.stringify({
      taskId: '#42',
      phase: 'verification',
      plan: 'plan.md',
      branch: 'task/#42-fit',
      tier: 'Standard',
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

  it('rejects same-ID plan text drift without writing a replacement envelope or fit', () => {
    expect(record(envelope()).status).toBe(0)
    const fitPath = join(root, '.arbiter', 'evidence', 'ac-fit', '42.json')
    const envelopeDir = join(root, '.arbiter', 'evidence', 'agent-returns', '_42')
    const fitBefore = readFileSync(fitPath, 'utf8')
    const envelopesBefore = readdirSync(envelopeDir)

    writeFileSync(
      join(root, 'plan.md'),
      PLAN.replace('exact verifier result', 'changed verifier result'),
    )
    const drifted = record(envelope())

    expect(drifted.status).toBe(1)
    expect(drifted.stdout + drifted.stderr).toMatch(/plan.*drift|changed|frozen/i)
    expect(readFileSync(fitPath, 'utf8')).toBe(fitBefore)
    expect(readdirSync(envelopeDir)).toEqual(envelopesBefore)
  })

  it('rejects fit admission after its recorded verifier envelope is changed', () => {
    expect(record(envelope()).status).toBe(0)
    const fit = JSON.parse(
      readFileSync(join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'), 'utf8'),
    )
    writeFileSync(join(root, fit.sourceEnvelope.path), '{}\n')

    const check = spawnSync(process.execPath, [CHECK], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ARBITER_ACCEPTANCE_ANCHOR: '1' },
    })

    expect(check.status).toBe(1)
    expect(check.stdout + check.stderr).toMatch(/source|digest|envelope/i)
  })

  it('rejects nonexistent acceptance evidence citations', () => {
    const invalid = envelope()
    invalid.acceptanceFit.criteria[0].evidence = [{ file: 'missing.ts', line: 999 }]

    const result = record(invalid)

    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toMatch(/citation|does not resolve/i)
  })

  it('rejects a stale native host tuple before writing qualified evidence', () => {
    const sessionId = 'missing-session'
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({
        taskId: '#42',
        phase: 'verification',
        plan: 'plan.md',
        branch: 'task/#42-fit',
        tier: 'Standard',
        hostBinding: {
          worktreePath: root,
          branch: 'wrong-branch',
          sessionId,
          transcriptPath: join(root, 'not-a-transcript.jsonl'),
        },
      }),
    )

    const result = recordWithEnv(envelope(), {
      CLAUDE_CODE_SESSION_ID: sessionId,
      CLAUDE_PROJECT_DIR: root,
      HOME: root,
    })

    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toMatch(/native host binding|stale/i)
  })

  it('derives a complete Standard reviewer sidecar from distinct accepted envelopes', () => {
    const first = { ...envelope(), agent: 'review-a', role: 'reviewer', acceptanceFit: undefined }
    const second = { ...envelope(), agent: 'review-b', role: 'reviewer', acceptanceFit: undefined }

    const result = recordPanel([first, second])

    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(
      JSON.parse(readFileSync(join(root, '.arbiter', 'agents-dispatched.json'), 'utf8')),
    ).toMatchObject({ count: 2, agents: ['review-a', 'review-b'], taskId: '#42' })
  })

  it('fails closed when the canonical reviewer router is unavailable', () => {
    writeFileSync(join(root, 'scripts', 'route-auditors.mjs'), 'process.exit(1)\n')
    const first = { ...envelope(), agent: 'review-a', role: 'reviewer', acceptanceFit: undefined }
    const second = { ...envelope(), agent: 'review-b', role: 'reviewer', acceptanceFit: undefined }

    const result = recordPanel([first, second])

    expect(result.status).toBe(2)
    expect(result.stdout + result.stderr).toMatch(/reviewer panel|router/i)
  })

  it.each(['.env.local', '.claude/settings.json'])(
    'escalates generated-project review when %s changes without a router',
    (changedPath) => {
      rmSync(join(root, 'scripts', 'route-auditors.mjs'))
      mkdirSync(dirname(join(root, changedPath)), { recursive: true })
      writeFileSync(join(root, changedPath), '{}\n')
      execFileSync('git', ['add', changedPath], { cwd: root })
      execFileSync('git', ['commit', '-m', 'test: sensitive change'], {
        cwd: root,
        stdio: 'ignore',
      })
      const reviewers = ['review-a', 'review-b', 'review-c'].map((agent) => ({
        ...envelope(),
        agent,
        role: 'reviewer',
        acceptanceFit: undefined,
      }))

      const incomplete = recordPanel(reviewers.slice(0, 2))
      expect(incomplete.status).toBe(1)
      expect(incomplete.stdout + incomplete.stderr).toMatch(/requires 3/i)
      expect(recordPanel(reviewers).status).toBe(0)
    },
  )
})
