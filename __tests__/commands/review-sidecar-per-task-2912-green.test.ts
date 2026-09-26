// SPDX-License-Identifier: Apache-2.0
/**
 * #2912 GREEN-side cases for the per-task review-dispatch sidecar resolver
 * (scripts/lib/evidence-binding.mjs `locateDispatchSidecar`), exercised through the real
 * check-review-completion.mjs: (d) the legacy single file counts only on an exact taskId match,
 * (e) without any task identity (CI) the branch selects the per-task file, (f) two per-task files
 * naming one branch are an error, and a dangling per-task symlink is refused, not skipped.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const CHECK = new URL('../../scripts/check-review-completion.mjs', import.meta.url).pathname
const SCHEMA = new URL('../../schemas/agent-return.schema.json', import.meta.url).pathname
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
const BRANCH = 'task/#2914-x'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

/** A committed fixture on BRANCH with #2914's reviewer envelope; task state only when asked. */
function setup(withTaskState: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'arbiter-sidecar-2912-green-'))
  roots.push(root)
  git(root, 'init', '-q', '-b', BRANCH)
  git(root, 'config', 'user.email', 'fixture.invalid')
  git(root, 'config', 'user.name', 'Fixture')
  writeFileSync(join(root, '.gitignore'), '.claude/.task/\n')
  writeFileSync(join(root, 'plan.md'), '## Acceptance Criteria\n- [ ] AC-1: ships\n')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'test: seed')
  const sha = git(root, 'rev-parse', 'HEAD')
  if (withTaskState) {
    mkdirSync(join(root, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({
        taskId: '#2914',
        phase: 'verification',
        branch: BRANCH,
        treatment: TREATMENT,
      }),
    )
  }
  const returns = join(root, '.arbiter', 'evidence', 'agent-returns', '_2914')
  mkdirSync(returns, { recursive: true })
  writeFileSync(
    join(returns, 'domain-0.json'),
    JSON.stringify({
      schema: 'arbiter-agent-return-v1',
      agent: 'domain',
      role: 'reviewer',
      taskId: '#2914',
      branch: BRANCH,
      sha,
      ts: '2026-09-26T00:00:00.000Z',
      verdict: 'PASS',
      confidence: 1,
      findings: [],
      provenance: { vendor: 'anthropic', dispatch: 'subagent' },
    }),
  )
  mkdirSync(join(root, '.arbiter', 'agents-dispatched'), { recursive: true })
  return { root, sha }
}

function sidecar(sha: string, extra: Record<string, unknown>) {
  return JSON.stringify({
    count: 1,
    agents: ['domain'],
    auditors: ['domain'],
    treatmentHash: TREATMENT_HASH,
    branch: BRANCH,
    sha,
    ...extra,
  })
}

function runCheck(root: string, ...extra: string[]) {
  const result = spawnSync(
    process.execPath,
    [
      CHECK,
      ...extra,
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

describe('per-task review-dispatch sidecar resolver (#2912 GREEN)', () => {
  it('(d) reads the legacy single file for the task it names', () => {
    const { root, sha } = setup(true)
    writeFileSync(
      join(root, '.arbiter', 'agents-dispatched.json'),
      sidecar(sha, { taskId: '#2914' }),
    )
    const result = runCheck(root, '--task', '#2914')
    expect(result.exitCode, result.out).toBe(0)
  })

  it('(d) treats a legacy single file that names no task as foreign, not as a match', () => {
    const { root, sha } = setup(true)
    writeFileSync(join(root, '.arbiter', 'agents-dispatched.json'), sidecar(sha, {}))
    const result = runCheck(root, '--task', '#2914')
    expect(result.exitCode, result.out).toBe(1)
    expect(result.out).toMatch(/belongs to task none, not #2914/)
  })

  it('(e) without --task or task state, the branch selects its per-task file (not vacuous)', () => {
    const { root, sha } = setup(false)
    writeFileSync(
      join(root, '.arbiter', 'agents-dispatched', '_2914.json'),
      sidecar(sha, { taskId: '#2914', count: 2, agents: ['domain', 'security'] }),
    )
    const result = runCheck(root)
    expect(result.exitCode, result.out).toBe(1)
    expect(result.out).toMatch(/security: missing return envelope/)
    expect(result.out).not.toMatch(/vacuous/)
  })

  it('(f) two per-task files naming the current branch are an error, never a guess', () => {
    const { root, sha } = setup(false)
    for (const id of ['_2914', '_2999']) {
      writeFileSync(
        join(root, '.arbiter', 'agents-dispatched', `${id}.json`),
        sidecar(sha, { taskId: `#${id.slice(1)}` }),
      )
    }
    const result = runCheck(root)
    expect(result.exitCode, result.out).toBe(2)
    expect(result.out).toMatch(/2 dispatch sidecars name branch task\/#2914-x/)
  })

  it('refuses a dangling per-task symlink instead of falling back to the legacy file', () => {
    const { root, sha } = setup(true)
    writeFileSync(
      join(root, '.arbiter', 'agents-dispatched.json'),
      sidecar(sha, { taskId: '#2914' }),
    )
    symlinkSync(
      join(root, 'missing.json'),
      join(root, '.arbiter', 'agents-dispatched', '_2914.json'),
    )
    const result = runCheck(root, '--task', '#2914')
    expect(result.exitCode, result.out).toBe(2)
    expect(result.out).toMatch(/_2914\.json/)
  })

  it('answers the correlated query with an empty panel when only a foreign sidecar exists', () => {
    const { root, sha } = setup(true)
    writeFileSync(
      join(root, '.arbiter', 'agents-dispatched.json'),
      sidecar(sha, { taskId: '#2911' }),
    )
    const result = runCheck(root, '--task', '#2914', `--correlated-sha=${sha}`)
    expect(result.exitCode, result.out).toBe(0)
    expect(JSON.parse(result.out)).toEqual({ envelopes: [], seats: {} })
  })
})
