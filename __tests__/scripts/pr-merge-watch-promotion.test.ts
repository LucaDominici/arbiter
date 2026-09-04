// SPDX-License-Identifier: Apache-2.0
// #2148: empirical exact-SHA promotion contract. The fake gh process models
// GitHub's PR and git-ref endpoints; the real watcher process must update main
// with force=false and must never invoke a rewriting `gh pr merge` method.
import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const BASE = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)
const WATCHER = resolve('scripts/pr-merge-watch.mjs')

function runWatcher(
  overrides: Record<string, unknown> = {},
  config: Record<string, unknown> = {
    collaborationMode: 'trunk-solo',
    solo: { mergeMode: 'pr-ff' },
  },
  options: { timeoutMin?: number; intervalSec?: number; rawConfig?: string } = {},
) {
  const { timeoutMin = 1, intervalSec = 0, rawConfig } = options
  const root = mkdtempSync(join(tmpdir(), 'arbiter-ff-watch-'))
  roots.push(root)
  const statePath = join(root, 'state.json')
  const ghPath = join(root, 'gh')
  writeFileSync(join(root, 'arbiter.json'), rawConfig ?? JSON.stringify(config))
  writeFileSync(
    statePath,
    JSON.stringify({
      calls: [],
      viewCalls: 0,
      base: BASE,
      head: HEAD,
      merged: false,
      refReads: 0,
      ...overrides,
    }),
  )
  writeFileSync(
    ghPath,
    `#!/usr/bin/env node
const fs = require('node:fs')
const statePath = process.env.FAKE_GH_STATE
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const args = process.argv.slice(2)
state.calls.push(args)
function save() { fs.writeFileSync(statePath, JSON.stringify(state)) }
if (args[0] === 'pr' && args[1] === 'view') {
  state.viewCalls++
  const head = state.changeHeadAt === state.viewCalls ? 'c'.repeat(40) : state.head
  const base = state.changeBaseAt === state.viewCalls ? 'd'.repeat(40) : state.base
  const out = {
    state: state.merged ? 'MERGED' : 'OPEN',
    statusCheckRollup: [
      {name: 'CI Required', conclusion: 'SUCCESS'},
      {name: 'Optional', conclusion: 'SKIPPED'},
    ],
    headRefOid: head,
    baseRefOid: base,
    baseRefName: 'main',
    headRefName: 'task/#2148-ff-watcher',
    isCrossRepository: Boolean(state.crossRepository),
    isDraft: false,
    mergeable: 'MERGEABLE',
  }
  save()
  process.stdout.write(JSON.stringify(out))
} else if (args[0] === 'api' && args[1] === 'graphql') {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => { input += chunk })
  process.stdin.on('end', () => {
    const body = JSON.parse(input)
    state.mutationInput = body
    const updates = body.variables.refUpdates
    const main = updates.find((update) => update.name === 'refs/heads/main')
    const head = updates.find((update) => update.name === 'refs/heads/task/#2148-ff-watcher')
    if (
      main.beforeOid !== state.base ||
      main.afterOid !== state.head ||
      main.force !== false ||
      head.beforeOid !== state.head ||
      head.afterOid !== state.head ||
      head.force !== false
    ) process.exitCode = 1
    else {
      if (!state.dontMoveBase) {
        state.base = main.afterOid
        state.merged = true
      }
      process.stdout.write(JSON.stringify({data: {updateRefs: {clientMutationId: null}}}))
    }
    save()
  })
} else if (args[0] === 'api' && args[1] === 'repos/owner/repo') {
  save()
  process.stdout.write(JSON.stringify({
    node_id: 'R_fake',
    allow_merge_commit: true,
    allow_squash_merge: false,
    allow_rebase_merge: Boolean(state.allowRebase),
  }))
} else if (args[0] === 'api' && args[1] === 'repos/owner/repo/branches/main/protection') {
  save()
  process.stdout.write(JSON.stringify({
    required_linear_history: {enabled: false},
    required_status_checks: {strict: true, contexts: ['CI Required']},
    enforce_admins: {enabled: false},
    allow_force_pushes: {enabled: false},
    allow_deletions: {enabled: false},
  }))
} else if (args[0] === 'api' && args[1].includes('/git/ref/heads/main')) {
  state.refReads++
  save()
  const sha = state.refReads <= (state.staleRefReads || 0) ? state.staleRefSha || '${BASE}' : state.base
  process.stdout.write(JSON.stringify({object: {sha}}))
} else {
  save()
  process.stderr.write('unsupported fake gh call: ' + JSON.stringify(args))
  process.exitCode = 9
}
`,
  )
  chmodSync(ghPath, 0o755)

  const result = spawnSync(
    process.execPath,
    [
      WATCHER,
      'owner/repo',
      '2148',
      '--timeout-min',
      String(timeoutMin),
      '--interval-sec',
      String(intervalSec),
    ],
    {
      cwd: root,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${root}:${dirname(process.execPath)}`,
        FAKE_GH_STATE: statePath,
      },
    },
  )
  return {
    result,
    state: JSON.parse(readFileSync(statePath, 'utf8')) as {
      base: string
      merged: boolean
      mutationInput?: {
        variables: {
          refUpdates: Array<{
            name: string
            beforeOid: string
            afterOid: string
            force: boolean
          }>
        }
      }
      calls: string[][]
    },
  }
}

describe('pr-merge-watch exact-SHA promotion (#2148)', () => {
  it('promotes the gated head with force=false and verifies the merged PR', () => {
    const { result, state } = runWatcher()
    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
    expect(state.base).toBe(HEAD)
    expect(state.merged).toBe(true)
    expect(state.mutationInput?.variables.refUpdates).toEqual([
      { name: 'refs/heads/main', beforeOid: BASE, afterOid: HEAD, force: false },
      {
        name: 'refs/heads/task/#2148-ff-watcher',
        beforeOid: HEAD,
        afterOid: HEAD,
        force: false,
      },
    ])
    expect(state.calls.some((args) => args[0] === 'pr' && args[1] === 'merge')).toBe(false)
  })

  it('fails closed without touching main when the checked head changes', () => {
    const { result, state } = runWatcher({ changeHeadAt: 2 })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/head.*changed/i)
    expect(state.base).toBe(BASE)
    expect(state.mutationInput).toBeUndefined()
  })

  it('fails closed without touching main when the checked base changes', () => {
    const { result, state } = runWatcher({ changeBaseAt: 2 })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/base.*changed/i)
    expect(state.base).toBe(BASE)
    expect(state.mutationInput).toBeUndefined()
  })

  it('fails closed when live GitHub settings allow rebase merge', () => {
    const { result, state } = runWatcher({ allowRebase: true })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('allow_rebase_merge')
    expect(state.base).toBe(BASE)
    expect(state.mutationInput).toBeUndefined()
  })

  it('exits ERROR when mutation response is green but main does not equal the gated head', () => {
    const { result, state } = runWatcher({ dontMoveBase: true }, undefined, { timeoutMin: 0 })
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/main.*gated head/i)
    expect(state.base).toBe(BASE)
  })

  it('retries a stale post-updateRefs ref read before accepting the exact promoted SHA (#2171, #2152)', () => {
    const { result, state } = runWatcher({ staleRefReads: 1 })
    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
    expect(state.base).toBe(HEAD)
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// #2150 AC-3 (testable half) — the non-solo path is fail-closed and asserted
// MODE BY MODE. Each case proves two things at once: the watcher exits non-zero,
// and `state.calls` is EMPTY — the refusal happened before the first `gh`
// invocation, so no GitHub state was read or touched on an unsupported arc.
// The live tests (missing approval = RED, missing check = RED, SHA drift = RED,
// happy path for the non-solo modes) are absent here and tracked on #2289 —
// never stubbed with a skip or a todo.
// ─────────────────────────────────────────────────────────────────────────────
describe('pr-merge-watch landing-contract refusal (#2150, AC-3)', () => {
  it.each([['peer-review'], ['gated-review']])(
    'refuses %s before any GitHub call, citing the deferred issue',
    (mode) => {
      const { result, state } = runWatcher(
        {},
        { collaborationMode: mode, solo: { mergeMode: 'pr-ff' } },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(mode)
      expect(result.stderr).toContain('#2289')
      expect(state.calls).toEqual([])
    },
  )

  it('refuses an UNKNOWN collaborationMode before any GitHub call', () => {
    const { result, state } = runWatcher(
      {},
      { collaborationMode: 'mob-programming', solo: { mergeMode: 'pr-ff' } },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('mob-programming')
    expect(state.calls).toEqual([])
  })

  it('refuses an ABSENT collaborationMode before any GitHub call', () => {
    const { result, state } = runWatcher({}, { solo: { mergeMode: 'pr-ff' } })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/absent|missing/i)
    expect(state.calls).toEqual([])
  })

  it('refuses a MALFORMED config (valid JSON, not an object) before any GitHub call', () => {
    const { result, state } = runWatcher({}, undefined, { rawConfig: '["trunk-solo"]' })
    expect(result.status).toBe(1)
    expect(state.calls).toEqual([])
  })

  it('refuses an UNPARSEABLE arbiter.json before any GitHub call', () => {
    const { result, state } = runWatcher({}, undefined, { rawConfig: '{ not json' })
    expect(result.status).toBe(2)
    expect(state.calls).toEqual([])
  })

  it('refuses trunk-solo with a non-pr-ff merge mode before any GitHub call', () => {
    const { result, state } = runWatcher(
      {},
      { collaborationMode: 'trunk-solo', solo: { mergeMode: 'direct' } },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('pr-ff')
    expect(state.calls).toEqual([])
  })
})
