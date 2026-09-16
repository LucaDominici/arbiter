// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
const TREATMENT_HASH = 'a'.repeat(64)
const STANDARD_TREATMENT = {
  version: 1,
  requestedTier: 'Standard',
  tier: 'Standard',
  sensitive: false,
  planDepth: 'full',
  preCodeReviewers: 0,
  finalReviewers: 1,
  acceptanceFitReviewers: 1,
  reviewerVerticals: ['domain'],
  modelCapability: 'capable',
  qualifiedNarrow: false,
  signalsHash: TREATMENT_HASH,
  reasons: ['complete affirmative qualification'],
}

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
      collaborationMode: 'peer-review',
      treatment: STANDARD_TREATMENT,
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

  it('accepts the final reviewer as the acceptance-fit verifier', () => {
    const reviewer = { ...envelope(), agent: 'domain', role: 'reviewer' }
    const result = record(reviewer)
    expect(result.status, result.stderr + result.stdout).toBe(0)
    expect(
      JSON.parse(readFileSync(join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'), 'utf8')),
    ).toMatchObject({ taskId: '#42', sha: head() })
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

  it('rejects a stale native binding for a non-Claude host', () => {
    const statusPath = join(root, '.claude', '.task', 'status.json')
    const state = JSON.parse(readFileSync(statusPath, 'utf8')) as Record<string, unknown>
    writeFileSync(
      statusPath,
      JSON.stringify({
        ...state,
        hostBinding: {
          bindingId: 'stale-binding',
          worktreePath: root,
          branch: 'task/#42-fit',
        },
      }),
    )
    mkdirSync(join(root, '.arbiter'), { recursive: true })
    writeFileSync(
      join(root, '.arbiter', 'worktree-open.log.json'),
      JSON.stringify([
        {
          taskId: '#42',
          worktreePath: root,
          branch: 'task/#42-fit',
          bindingId: 'live-binding',
        },
      ]),
    )

    const result = record(envelope())

    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toMatch(/native host binding|stale/i)
  })

  it('derives a complete Standard reviewer sidecar from one accepted envelope', () => {
    const reviewer = { ...envelope(), agent: 'domain', role: 'reviewer' }

    const result = recordPanel([reviewer])

    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(
      JSON.parse(readFileSync(join(root, '.arbiter', 'agents-dispatched.json'), 'utf8')),
    ).toMatchObject({
      count: 1,
      agents: ['domain'],
      auditors: ['domain'],
      treatmentHash: TREATMENT_HASH,
      taskId: '#42',
    })
  })

  it('persists the reviewer result and its acceptance fit from one submission', () => {
    const reviewer = { ...envelope(), agent: 'domain', role: 'reviewer' }

    const result = recordPanel([reviewer])

    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(
      JSON.parse(readFileSync(join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'), 'utf8')),
    ).toMatchObject({ taskId: '#42', branch: 'task/#42-fit', sha: head() })
  })

  it('rejects an invalid acceptance fit before writing either reviewer artifact', () => {
    const reviewer = { ...envelope(), agent: 'domain', role: 'reviewer' }
    reviewer.acceptanceFit.criteria[0].evidence = [{ file: 'missing.ts', line: 999 }]

    const result = recordPanel([reviewer])

    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toMatch(/citation|does not resolve/i)
    expect(existsSync(join(root, '.arbiter', 'agents-dispatched.json'))).toBe(false)
    expect(existsSync(join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'))).toBe(false)
  })

  it('rejects a correctly-sized panel that did not fill the assigned verticals', () => {
    const result = recordPanel([
      { ...envelope(), agent: 'review-a', role: 'reviewer', acceptanceFit: undefined },
    ])

    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toMatch(/assigned verticals.*domain/i)
  })

  it('uses the same persisted one-reviewer panel in trunk-solo', () => {
    const statusPath = join(root, '.claude', '.task', 'status.json')
    const status = JSON.parse(readFileSync(statusPath, 'utf8'))
    writeFileSync(statusPath, JSON.stringify({ ...status, collaborationMode: 'trunk-solo' }))
    const reviewer = {
      ...envelope(),
      agent: 'domain',
      role: 'reviewer',
      acceptanceFit: undefined,
    }

    const result = recordPanel([reviewer])

    expect(result.status, result.stdout + result.stderr).toBe(0)
  })

  it('does not widen the persisted panel from an unvalidated raw config', () => {
    writeFileSync(
      join(root, 'arbiter.json'),
      JSON.stringify({ collaborationMode: 'trunk-solo', features: null }),
    )
    const reviewer = {
      ...envelope(),
      agent: 'domain',
      role: 'reviewer',
      acceptanceFit: undefined,
    }

    const result = recordPanel([reviewer])

    expect(result.status, result.stdout + result.stderr).toBe(0)
  })

  it('fails closed when the active task has no persisted treatment', () => {
    const statusPath = join(root, '.claude', '.task', 'status.json')
    const status = JSON.parse(readFileSync(statusPath, 'utf8'))
    delete status.treatment
    writeFileSync(statusPath, JSON.stringify(status))
    const reviewer = {
      ...envelope(),
      agent: 'domain',
      role: 'reviewer',
      acceptanceFit: undefined,
    }

    const result = recordPanel([reviewer])

    expect(result.status).toBe(2)
    expect(result.stdout + result.stderr).toMatch(/ship treatment/i)
  })

  it('uses the specialist panel already selected by the persisted treatment', () => {
    const statusPath = join(root, '.claude', '.task', 'status.json')
    const status = JSON.parse(readFileSync(statusPath, 'utf8'))
    writeFileSync(
      statusPath,
      JSON.stringify({
        ...status,
        treatment: {
          ...STANDARD_TREATMENT,
          sensitive: true,
          finalReviewers: 3,
          reviewerVerticals: ['security', 'migration', 'deployment'],
          modelCapability: 'frontier',
        },
      }),
    )
    const reviewers = ['security', 'migration', 'deployment'].map((agent) => ({
      ...envelope(),
      agent,
      role: 'reviewer',
      acceptanceFit: undefined,
    }))

    const incomplete = recordPanel(reviewers.slice(0, 2))
    expect(incomplete.status).toBe(1)
    expect(incomplete.stdout + incomplete.stderr).toMatch(/requires 3/i)
    expect(recordPanel(reviewers).status).toBe(0)
  })
})
