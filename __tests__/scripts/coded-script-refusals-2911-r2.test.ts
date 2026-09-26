// SPDX-License-Identifier: Apache-2.0
// #2911 review round 1: every recorder mode names the one stale check; the check-acceptance
// hints read only current, same-plan evidence; the plan-bytes cause hashes raw bytes.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
const TREATMENT = {
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
  signalsHash: 'a'.repeat(64),
  reasons: ['complete affirmative qualification'],
}

let root: string

function git(...args: string[]) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' })
}

function head() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}

function writeState(extra: Record<string, unknown> = {}) {
  writeFileSync(
    join(root, '.claude', '.task', 'status.json'),
    JSON.stringify({
      taskId: '#42',
      phase: 'verification',
      plan: 'plan.md',
      branch: 'task/#42-fit',
      treatment: TREATMENT,
      ...extra,
    }),
  )
}

function envelope(overrides: Record<string, unknown> = {}, verdict = 'PASS') {
  return {
    schema: 'arbiter-agent-return-v1',
    agent: 'acceptance-verifier',
    role: 'verifier',
    taskId: '#42',
    branch: 'task/#42-fit',
    sha: head(),
    ts: '2026-09-15T00:00:00.000Z',
    verdict: 'PASS',
    confidence: 1,
    findings: [],
    acceptanceFit: {
      schema: 'arbiter-ac-fit-v1',
      taskId: '#42',
      criteria: [
        {
          id: 'AC-1',
          verdict,
          evidence: verdict === 'PASS' ? [{ file: 'plan.md', line: 2 }] : [],
        },
      ],
    },
    ...overrides,
  }
}

function recorder(mode: string, input: unknown) {
  return spawnSync(
    process.execPath,
    [RECORDER, '--mode', mode, '--task', '#42', '--repo-root', root],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: undefined },
      input: JSON.stringify(input),
    },
  )
}

function check(...args: string[]) {
  return spawnSync(process.execPath, [CHECK, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ARBITER_ACCEPTANCE_ANCHOR: '1' },
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arbiter-2911-r2-'))
  git('init', '-b', 'task/#42-fit')
  git('config', 'user.email', 'fixture.invalid')
  git('config', 'user.name', 'Fixture')
  writeFileSync(join(root, 'plan.md'), PLAN)
  git('add', 'plan.md')
  git('commit', '-m', 'seed')
  mkdirSync(join(root, '.claude', '.task'), { recursive: true })
  writeState()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

// The first envelope passes modeContext; a two-reviewer panel reaches validatedReviewers for the second.
describe('#2911 r2: reviewer-panel mode names the one stale check', () => {
  const PANEL = { ...TREATMENT, finalReviewers: 2, reviewerVerticals: ['domain', 'security'] }
  const panel = (second: Record<string, unknown> = {}) => ({
    envelopes: [
      envelope({ agent: 'domain', role: 'reviewer' }),
      envelope({ agent: 'security', role: 'reviewer', ...second }),
    ],
  })

  it('names the stale sha without the preflight remedy', () => {
    writeState({ treatment: PANEL })

    const result = recorder('reviewer-panel', panel({ sha: 'deadbeef' }))

    const out = result.stdout + result.stderr
    expect(result.status).toBe(1)
    expect(out).toMatch(/stale sha \(deadbeef ≠ [0-9a-f]+\)/)
    expect(out).not.toMatch(/lifecycle preflight/)
    expect(out).not.toMatch(/reviewer envelope subject is stale/)
  })

  it('names the broken binding field and gives the preflight remedy', () => {
    writeState({ treatment: PANEL, hostBinding: { worktreePath: root } })

    const result = recorder('reviewer-panel', panel())

    const out = result.stdout + result.stderr
    expect(result.status).toBe(1)
    expect(out).toMatch(/binding id is missing/i)
    expect(out).toMatch(/lifecycle preflight --id '#42'/)
    expect(out).not.toMatch(/reviewer envelope subject is stale/)
  })
})

describe('#2911 r2: ac-fit mode names the task and branch causes', () => {
  it('names a stale task', () => {
    const result = recorder('ac-fit', envelope({ taskId: '#43' }))

    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toMatch(/stale task \(#43 ≠ #42\)/)
  })

  it('names a stale branch', () => {
    const result = recorder('ac-fit', envelope({ branch: 'task/#42-old' }))

    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toMatch(/stale branch \(task\/#42-old/)
  })
})

describe('#2911 r2: the NOT-TESTED hint reads only current, same-plan evidence', () => {
  const FIT = '.arbiter/evidence/ac-fit/42.json'

  beforeEach(() => {
    const recorded = recorder('ac-fit', envelope({}, 'NOT-TESTED'))
    expect(recorded.status, recorded.stdout + recorded.stderr).toBe(0)
  })

  it('lists the ids for the active plan at the recorded sha', () => {
    const result = check('--plan', 'plan.md', '--ac-fit', FIT)

    expect(result.status).toBe(2)
    expect(result.stdout + result.stderr).toMatch(/NOT-TESTED for AC-1/)
  })

  it('omits a previous round envelope once HEAD moves', () => {
    git('commit', '--allow-empty', '-m', 'rework')

    const result = check('--plan', 'plan.md', '--ac-fit', FIT)

    expect(result.status).toBe(2)
    expect(result.stdout + result.stderr).not.toMatch(/NOT-TESTED/)
  })

  it("omits another task's ids when --plan is not the active task's plan", () => {
    writeFileSync(join(root, 'other.md'), PLAN)

    const result = check('--plan', 'other.md', '--ac-fit', FIT)

    expect(result.status).toBe(2)
    expect(result.stdout + result.stderr).not.toMatch(/NOT-TESTED/)
  })
})

describe('#2911 r2: the plan-bytes cause hashes raw bytes', () => {
  it('does not report plan bytes changed for an unchanged plan with invalid UTF-8', () => {
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(
      join(root, 'scripts', 'check-all.mjs'),
      [
        '// @arbiter-gate-contract arbiter-gate-contract-v1',
        "import { createHash } from 'node:crypto'",
        "import { readFileSync } from 'node:fs'",
        "import { fileURLToPath } from 'node:url'",
        'const path = fileURLToPath(import.meta.url)',
        "const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')",
        "console.log(JSON.stringify({ schema: 'arbiter-gate-contract-v1', authority: [{ path: 'scripts/check-all.mjs', sha256 }], gates: [], external: [], unresolved: [] }))",
        '',
      ].join('\n'),
    )
    const plan = Buffer.concat([
      Buffer.from(['---', 'files:', '  - src/a.ts', '---', PLAN, '- bad byte '].join('\n')),
      Buffer.from([0xff, 0x0a]),
    ])
    writeFileSync(join(root, 'plan.md'), plan)
    writeFileSync(
      join(root, 'arbiter.json'),
      JSON.stringify({
        collaborationMode: 'trunk-solo',
        solo: { mergeMode: 'pr-ff' },
        features: { acceptanceAnchor: true },
      }),
    )
    writeState({
      phase: 'plan',
      derivedGates: [],
      derivedGatesPlan: createHash('sha256')
        .update(readFileSync(join(root, 'plan.md')))
        .digest('hex'),
    })

    const result = check('--plan', 'plan.md')

    const out = result.stdout + result.stderr
    expect(result.status).toBe(1)
    expect(out).toMatch(/derived gates are missing or stale \(verification authority/)
    expect(out).not.toMatch(/plan bytes changed/)
  })
})
