// SPDX-License-Identifier: Apache-2.0
// RED phase (acceptance-anchor, INV-138): the gate script must be inert without the
// feature flag, vacuous without an active task, hard-fail a plan missing the frozen
// AC anchor during implementation phases, fail-closed (exit 2) on malformed state,
// strip #fragment plan anchors (wave mode), and demand an all-PASS ac-fit artifact
// at verification/close.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve(__dirname, '../../scripts/check-acceptance.mjs')

const GOOD_PLAN = [
  '## Acceptance Criteria',
  '- [ ] AC-1: observable behavior one',
  '## Non-Goals',
  '- out of scope',
].join('\n')

let root: string

function run(env: Record<string, string> = {}, args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ARBITER_ACCEPTANCE_ANCHOR: '1', ...env },
  })
}

function writeState(phase: string, plan = 'plan.md', planBody = GOOD_PLAN) {
  mkdirSync(join(root, '.claude', '.task'), { recursive: true })
  writeFileSync(
    join(root, '.claude', '.task', 'status.json'),
    JSON.stringify({ taskId: '#42', phase, plan }),
  )
  if (planBody !== null) writeFileSync(join(root, plan), planBody)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-acceptance-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('check-acceptance gate', () => {
  it('exits 0 (inert) when the flag is off', () => {
    writeState('red', 'plan.md', 'no anchor at all')
    const r = run({ ARBITER_ACCEPTANCE_ANCHOR: '0' })
    expect(r.status).toBe(0)
  })

  it('exits 0 (vacuous) with no active task state', () => {
    expect(run().status).toBe(0)
  })

  it('exits 0 in pre-implementation phases regardless of plan content', () => {
    writeState('plan', 'plan.md', 'no anchor')
    expect(run().status).toBe(0)
  })

  it('fails (1) an implementation-phase task whose plan lacks the AC anchor', () => {
    writeState('red', 'plan.md', '# Plan\nno sections')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/Acceptance Criteria/i)
  })

  it('fails (1) when the anchor has criteria without explicit AC-N ids', () => {
    writeState('red', 'plan.md', '## Acceptance Criteria\n- [ ] bare\n## Non-Goals\n- x')
    expect(run().status).toBe(1)
  })

  it('passes (0) an implementation-phase task with a frozen anchor', () => {
    writeState('green')
    expect(run().status).toBe(0)
  })

  it('treats legacy phase "implementation" as red', () => {
    writeState('implementation', 'plan.md', 'no anchor')
    expect(run().status).toBe(1)
  })

  it('exits 2 (fail-closed, with reset instructions) on an unknown phase', () => {
    writeState('what-even-is-this')
    const r = run()
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/ARBITER_ACCEPTANCE_ANCHOR=0/)
  })

  it('exits 2 when the anchored plan file is missing', () => {
    mkdirSync(join(root, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#42', phase: 'red', plan: 'gone.md' }),
    )
    expect(run().status).toBe(2)
  })

  it('exits 2 on malformed status.json', () => {
    mkdirSync(join(root, '.claude', '.task'), { recursive: true })
    writeFileSync(join(root, '.claude', '.task', 'status.json'), '{not json')
    expect(run().status).toBe(2)
  })

  it('strips a #fragment from the anchored plan path (wave mode)', () => {
    writeState('red', 'wave-1.md')
    mkdirSync(join(root, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#42', phase: 'red', plan: 'wave-1.md#group-a' }),
    )
    expect(run().status).toBe(0)
  })

  it('validates an ac-fit artifact when present (invalid ⇒ 1)', () => {
    writeState('refactor')
    mkdirSync(join(root, '.arbiter', 'evidence', 'ac-fit'), { recursive: true })
    writeFileSync(
      join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'),
      JSON.stringify({ schema: 'wrong', criteria: [] }),
    )
    expect(run().status).toBe(1)
  })

  it('requires an all-PASS ac-fit artifact at verification (missing ⇒ 1)', () => {
    writeState('verification')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/ac-fit/i)
  })

  it('passes verification with a complete all-PASS ac-fit artifact', () => {
    writeState('verification')
    mkdirSync(join(root, '.arbiter', 'evidence', 'ac-fit'), { recursive: true })
    writeFileSync(
      join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'),
      JSON.stringify({
        schema: 'arbiter-ac-fit-v1',
        taskId: '#42',
        sha: 'abc',
        criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'src/x.ts', line: 1 }] }],
      }),
    )
    expect(run().status).toBe(0)
  })

  it('--plan mode validates a given plan file directly (wave integrate)', () => {
    writeFileSync(join(root, 'wave.md'), GOOD_PLAN)
    expect(run({}, ['--plan', 'wave.md']).status).toBe(0)
    writeFileSync(join(root, 'bad.md'), 'nothing')
    expect(run({}, ['--plan', 'bad.md']).status).toBe(1)
    expect(run({}, ['--plan', 'missing.md']).status).toBe(2)
  })

  it('--plan --ac-fit combined mode enforces all-PASS wave fit — red-team F5', () => {
    writeFileSync(
      join(root, 'wave.md'),
      ['## Acceptance Criteria', '- [ ] AC-123.1: behavior', '## Non-Goals', '- x'].join('\n'),
    )
    mkdirSync(join(root, '.arbiter', 'evidence', 'ac-fit'), { recursive: true })
    const fit = join('.arbiter', 'evidence', 'ac-fit', 'wave-1.json')
    writeFileSync(
      join(root, fit),
      JSON.stringify({
        schema: 'arbiter-ac-fit-v1',
        taskId: 'wave-1',
        criteria: [{ id: 'AC-123.1', verdict: 'NOT-TESTED', evidence: [] }],
      }),
    )
    expect(run({}, ['--plan', 'wave.md', '--ac-fit', fit]).status).toBe(1)
    writeFileSync(
      join(root, fit),
      JSON.stringify({
        schema: 'arbiter-ac-fit-v1',
        taskId: 'wave-1',
        criteria: [{ id: 'AC-123.1', verdict: 'PASS', evidence: [{ file: 'src/x.ts', line: 3 }] }],
      }),
    )
    expect(run({}, ['--plan', 'wave.md', '--ac-fit', fit]).status).toBe(0)
  })

  it('rejects duplicate anchor ids (wave plans must namespace) — red-team F3', () => {
    writeState(
      'red',
      'plan.md',
      [
        '## Acceptance Criteria',
        '- [ ] AC-1: from issue A',
        '- [ ] AC-1: from issue B',
        '## Non-Goals',
        '- x',
      ].join('\n'),
    )
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/duplicate/i)
  })

  it('treats an empty/absent phase as preflight (SKIP) — red-team F10', () => {
    mkdirSync(join(root, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#42', plan: 'plan.md' }),
    )
    expect(run().status).toBe(0)
  })

  it('wave workers (fragment-anchored) are not required to carry a per-task ac-fit at verification — red-team F7', () => {
    writeState('verification', 'wave-1.md')
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#42', phase: 'verification', plan: 'wave-1.md#group-a' }),
    )
    expect(run().status).toBe(0)
  })

  it('rejects an ac-fit artifact whose taskId does not match the active task — red-team F12', () => {
    writeState('refactor')
    mkdirSync(join(root, '.arbiter', 'evidence', 'ac-fit'), { recursive: true })
    writeFileSync(
      join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'),
      JSON.stringify({
        schema: 'arbiter-ac-fit-v1',
        taskId: '#99',
        criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'src/x.ts', line: 1 }] }],
      }),
    )
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/does not match/)
  })
})
