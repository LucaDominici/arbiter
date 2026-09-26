// SPDX-License-Identifier: Apache-2.0
/**
 * RED tests for #2912 — the review-dispatch sidecar must be keyed per task, not a single
 * shared tracked file (`.arbiter/agents-dispatched.json`) that every task overwrites and that
 * `lifecycle start` deletes outright.
 *
 * Target layout (orchestrator decision, not yet implemented):
 *   .arbiter/agents-dispatched/<sanitizeTaskId(taskId)>.json   — one file per task
 *   readers fall back to the legacy single file ONLY when its taskId matches the active task
 *   `lifecycle start` (via invalidateTaskReceipts) touches only the ACTIVE task's own sidecar
 *
 * Mirrors the harness style of __tests__/scripts/record-agent-return-modes.test.ts (spawnSync
 * the real script) and __tests__/commands/task-host-preflight.test.ts (call the TS function
 * directly against a throwaway git fixture).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { invalidateTaskReceipts } from '../../src/commands/task-state.js'

const RECORDER = new URL('../../scripts/record-agent-return.mjs', import.meta.url).pathname
const CHECK = new URL('../../scripts/check-review-completion.mjs', import.meta.url).pathname
const SCHEMA = new URL('../../schemas/agent-return.schema.json', import.meta.url).pathname
const PLAN = [
  '## Acceptance Criteria',
  '- [ ] AC-1: records the exact verifier result',
  '## Non-Goals',
  '- no alternate evidence store',
].join('\n')
const TREATMENT_HASH = 'a'.repeat(64)
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
  signalsHash: TREATMENT_HASH,
  reasons: ['complete affirmative qualification'],
}

const roots: string[] = []

function head(root: string) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}

/** Fresh git fixture with a committed plan, task-state status.json, and given task/branch. */
function setup(taskId: string, branch: string) {
  const root = mkdtempSync(join(tmpdir(), 'arbiter-sidecar-2912-'))
  roots.push(root)
  execFileSync('git', ['init', '-b', branch], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'fixture.invalid'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root })
  writeFileSync(join(root, 'plan.md'), PLAN)
  writeFileSync(join(root, '.gitignore'), '.claude/.task/\n')
  execFileSync('git', ['add', 'plan.md', '.gitignore'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'test: seed'], { cwd: root, stdio: 'ignore' })
  mkdirSync(join(root, '.claude', '.task'), { recursive: true })
  writeFileSync(
    join(root, '.claude', '.task', 'status.json'),
    JSON.stringify({
      taskId,
      phase: 'verification',
      plan: 'plan.md',
      branch,
      tier: 'Standard',
      collaborationMode: 'peer-review',
      treatment: TREATMENT,
    }),
  )
  return root
}

function reviewerEnvelope(root: string, taskId: string, branch: string) {
  return {
    schema: 'arbiter-agent-return-v1',
    agent: 'domain',
    role: 'reviewer',
    taskId,
    branch,
    sha: head(root),
    ts: '2026-09-26T00:00:00.000Z',
    verdict: 'PASS',
    confidence: 1,
    provenance: { vendor: 'anthropic', dispatch: 'subagent' },
    findings: [],
    acceptanceFit: {
      schema: 'arbiter-ac-fit-v1',
      taskId,
      criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'plan.md', line: 2 }] }],
    },
  }
}

function recordPanel(root: string, taskId: string, envelopes: unknown[]) {
  return spawnSync(
    process.execPath,
    [RECORDER, '--mode', 'reviewer-panel', '--task', taskId, '--repo-root', root],
    { cwd: root, encoding: 'utf8', input: JSON.stringify({ envelopes }) },
  )
}

function runCheck(root: string, taskId: string) {
  const result = spawnSync(
    process.execPath,
    [
      CHECK,
      '--task',
      taskId,
      '--evidence-dir',
      join(root, '.arbiter/evidence/agent-returns'),
      `--schema=${SCHEMA}`,
      '--repo-root',
      root,
    ],
    { cwd: root, encoding: 'utf8' },
  )
  return { exitCode: result.status ?? 1, out: `${result.stdout}${result.stderr}` }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('per-task review-dispatch sidecar (#2912)', () => {
  it('(a) record-agent-return writes .arbiter/agents-dispatched/<task>.json, not the shared single file', () => {
    const root = setup('#2912', 'task/#2912-sidecar')
    const result = recordPanel(root, '#2912', [
      reviewerEnvelope(root, '#2912', 'task/#2912-sidecar'),
    ])
    expect(result.status, result.stdout + result.stderr).toBe(0)

    // Target per-task layout — FAILS today: the writer still writes the single shared file.
    const perTaskPath = join(root, '.arbiter', 'agents-dispatched', '_2912.json')
    expect(existsSync(perTaskPath)).toBe(true)
    expect(JSON.parse(readFileSync(perTaskPath, 'utf8'))).toMatchObject({ taskId: '#2912' })
  })

  it('(b) lifecycle start (invalidateTaskReceipts) for task B leaves task A sidecar byte-identical', () => {
    const root = setup('#2913', 'task/#2913-other')
    mkdirSync(join(root, '.arbiter'), { recursive: true })
    // Task A's sidecar as it exists on disk TODAY: the single tracked file every task shares.
    // (The per-task path `.arbiter/agents-dispatched/_2911.json` is the GREEN target; it does
    // not exist yet, so the pre-fix writer/deleter both still only know this one path.)
    const taskAPath = join(root, '.arbiter', 'agents-dispatched.json')
    const taskAContent = `${JSON.stringify({ count: 1, agents: ['domain'], taskId: '#2911' })}\n`
    writeFileSync(taskAPath, taskAContent)
    execFileSync('git', ['add', '-f', taskAPath], { cwd: root })
    execFileSync('git', ['commit', '-m', 'test: commit task A sidecar'], {
      cwd: root,
      stdio: 'ignore',
    })

    // #2913's own lifecycle event (e.g. a rebound host, or a re-anchored plan) must never
    // touch another task's committed sidecar (AC-1: `git status --porcelain` stays empty).
    invalidateTaskReceipts(root, '#2913')

    // FAILS today: invalidateTaskReceipts unconditionally deletes
    // `.arbiter/agents-dispatched.json` regardless of whose task it belongs to — it has no
    // per-task path to scope the deletion to, so task A's sidecar is destroyed by #2913's event
    // and `git status --porcelain` goes dirty.
    expect(existsSync(taskAPath)).toBe(true)
    expect(readFileSync(taskAPath, 'utf8')).toBe(taskAContent)
    const porcelain = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(porcelain.trim()).toBe('')
  })

  it('(c) reader for task B resolves its per-task sidecar; a legacy file of task A stays foreign', () => {
    const root = setup('#2914', 'task/#2914-legacy')
    const envelope = reviewerEnvelope(root, '#2914', 'task/#2914-legacy')
    mkdirSync(join(root, '.arbiter', 'evidence', 'agent-returns', '_2914'), { recursive: true })
    writeFileSync(
      join(root, '.arbiter', 'evidence', 'agent-returns', '_2914', 'domain-0.json'),
      `${JSON.stringify(envelope, null, 2)}\n`,
    )

    // A legacy single-file sidecar recorded for a DIFFERENT task (#2915) must be treated as
    // absent for #2914 — already true today via isForeignSidecar — so #2914 fails closed.
    writeFileSync(
      join(root, '.arbiter', 'agents-dispatched.json'),
      `${JSON.stringify({
        count: 1,
        agents: ['domain'],
        branch: 'task/#2914-legacy',
        sha: head(root),
        taskId: '#2915',
      })}\n`,
    )
    const foreignResult = runCheck(root, '#2914')
    expect(foreignResult.exitCode, foreignResult.out).toBe(1)
    expect(foreignResult.out).toMatch(/belongs to task #2915/)

    // Now record #2914's OWN legacy-shaped sidecar at the NEW per-task path. The reader has no
    // default lookup for that path yet — FAILS today: exits non-zero ("dispatch sidecar not
    // found") instead of resolving `.arbiter/agents-dispatched/_2914.json` and passing.
    mkdirSync(join(root, '.arbiter', 'agents-dispatched'), { recursive: true })
    writeFileSync(
      join(root, '.arbiter', 'agents-dispatched', '_2914.json'),
      `${JSON.stringify({
        count: 1,
        agents: ['domain'],
        auditors: ['domain'],
        treatmentHash: TREATMENT_HASH,
        branch: 'task/#2914-legacy',
        sha: head(root),
        taskId: '#2914',
      })}\n`,
    )
    const result = runCheck(root, '#2914')
    expect(result.exitCode, result.out).toBe(0)
  })
})
