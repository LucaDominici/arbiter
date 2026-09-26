// SPDX-License-Identifier: Apache-2.0
// #2904 — a round after the first reviews acceptance fit against the task base; the delta is focus only.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invokeExternalReview } from '../../src/integrations/external-review.js'
import { runShipCrossModelReview } from '../../src/commands/cross-model-review.js'
import { reviewScopeLine } from '../../src/commands/ship-review.js'
import { runCli } from '../../src/utils/run-cli.js'

vi.mock('../../src/integrations/external-review.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/integrations/external-review.js')>()
  return { ...actual, invokeExternalReview: vi.fn() }
})
vi.mock('../../src/utils/run-cli.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/utils/run-cli.js')>()
  return { ...actual, runCli: vi.fn() }
})

const mockedInvoke = vi.mocked(invokeExternalReview)
const mockedRunCli = vi.mocked(runCli)
const TASK_BASE = 'c'.repeat(40)
const PREV_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const cfg = {
  enabled: true,
  diffEgressConsent: true,
  providers: ['codex'],
  slots: { codeReview: 1, redTeamReview: 0 },
  timeoutMs: 300_000,
  onUnavailable: 'degrade',
} as const
const BRIEF = JSON.stringify({
  criteria: [{ id: 'AC-1', text: 'Whole-task criterion.' }],
  nonGoals: [],
  acHash: 'h',
})
const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, durationMs: 1 })

function renderRound(baseSha: string | null): string {
  mockedRunCli.mockImplementation((command, args) => {
    if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD')
      return ok(`${HEAD_SHA}\n`)
    if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'origin/main')
      return ok(`${TASK_BASE}\n`)
    if (command === 'git' && args[0] === 'show')
      return ok('# Plan\n## Acceptance Criteria\n- [ ] AC-1: x')
    if (command === process.execPath) return ok(BRIEF)
    return ok('')
  })
  runShipCrossModelReview({
    dir: '/tmp/project',
    taskId: '#2904',
    tier: 'Standard',
    phase: 'refactor',
    vertical: 'bugs',
    cfg: cfg as never,
    baseSha,
    headSha: HEAD_SHA,
    planRef: '.claude/plans/task-2904.md',
  })
  return mockedInvoke.mock.calls.at(-1)?.[0].prompt ?? ''
}

describe('#2904 round >= 2 review scope', () => {
  beforeEach(() => {
    mockedInvoke.mockReset()
    mockedRunCli.mockReset()
    mockedInvoke.mockReturnValue({ provider: 'codex', status: 'fulfilled' } as never)
  })

  it('AC-1: egresses the whole task diff and labels the task base for acceptance fit', () => {
    const prompt = renderRound(PREV_SHA)
    expect(mockedRunCli).toHaveBeenCalledWith(
      'git',
      ['diff', '--binary', `${TASK_BASE}..${HEAD_SHA}`],
      expect.anything(),
    )
    expect(prompt).toContain(`Task base SHA (acceptance fit): ${TASK_BASE}`)
    expect(prompt).toContain(`Task diff: ${TASK_BASE}..${HEAD_SHA}`)
  })

  it('AC-1: names the delta only as the labelled changed-since-last-round focus', () => {
    const prompt = renderRound(PREV_SHA)
    expect(prompt).toContain(
      `Changed since last round (focus; previous reviewed candidate, not the task base): ${PREV_SHA}..${HEAD_SHA}`,
    )
  })

  it('AC-2: never labels the previous reviewed SHA as the base', () => {
    const prompt = renderRound(PREV_SHA)
    expect(prompt).not.toContain(`Base SHA: ${PREV_SHA}`)
    expect(prompt).not.toContain(`Diff: ${PREV_SHA}..`)
  })

  it('AC-3: pins the round-2 header block in order', () => {
    const lines = renderRound(PREV_SHA).split('\n')
    const at = (prefix: string) => lines.findIndex((l) => l.startsWith(prefix))
    expect(at('Task base SHA (acceptance fit):')).toBeGreaterThan(at('Task: #2904'))
    expect(at('Task diff:')).toBe(at('Task base SHA (acceptance fit):') + 2)
    expect(at('Changed since last round')).toBe(at('Task diff:') + 1)
  })

  it('AC-3: round 1 names the task base and has no delta line', () => {
    const prompt = renderRound(null)
    expect(prompt).toContain(`Task base SHA (acceptance fit): ${TASK_BASE}`)
    expect(prompt).not.toContain('Changed since last round')
  })

  it('AC-2: the Ship scope line labels the delta, not a base', () => {
    expect(reviewScopeLine(PREV_SHA, 2, 2)).toMatch(
      new RegExp(`^changed since last round: git diff ${PREV_SHA}\\.\\.HEAD \\(round 2 of 2`),
    )
  })
})
