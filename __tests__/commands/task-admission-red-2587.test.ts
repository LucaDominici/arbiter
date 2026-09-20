// SPDX-License-Identifier: Apache-2.0
// #2587 RED receipt: acceptance-anchor validation must happen on red admission.
import { chmodSync, cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { runTaskAdvance } from '../../src/commands/task.js'
import { readUnifiedState, writeUnifiedState } from '../../src/commands/task-state.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function installAcceptanceChecker(root: string): void {
  cpSync(resolve(__dirname, '../../scripts', 'lib'), join(root, 'scripts', 'lib'), {
    recursive: true,
  })
  cpSync(
    resolve(__dirname, '../../scripts', 'check-acceptance.mjs'),
    join(root, 'scripts', 'check-acceptance.mjs'),
  )
}

function installGh(root: string, response: string, status = 0): string {
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  const gh = join(bin, 'gh')
  writeFileSync(
    gh,
    `#!/bin/sh\nprintf '%s' '${response.replaceAll("'", "'\\\"'\\\"'")}'\nexit ${status}\n`,
  )
  chmodSync(gh, 0o755)
  return bin
}

function validPlan(criteria = ['AC-2587.1: preserves the requested outcome']) {
  return [
    '## Acceptance Criteria',
    ...criteria.map((criterion) => `- [ ] ${criterion}`),
    '## Non-Goals',
    '- x',
  ].join('\n')
}

function issueBody(criteria = ['AC-1: preserves the requested outcome']) {
  return ['## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n')
}

function withGhPath(bin: string, run: () => void): void {
  const previous = process.env.PATH
  process.env.PATH = `${bin}:${previous ?? ''}`
  try {
    run()
  } finally {
    process.env.PATH = previous
  }
}

describe('red admission acceptance anchor (#2587)', () => {
  it('rejects malformed Markdown before entering red', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-red-admission-'))
    roots.push(root)
    writeUnifiedState(root, {
      taskId: '#2587',
      phase: 'red-team-review',
      plan: 'plan.md',
    })
    mkdirSync(join(root, '.arbiter', 'evidence', 'redteam'), { recursive: true })
    writeFileSync(join(root, '.arbiter', 'evidence', 'redteam', '#2587.json'), '{"findings":[]}\n')
    writeFileSync(join(root, 'arbiter.json'), '{"features":{"acceptanceAnchor":true}}\n')
    writeFileSync(join(root, 'plan.md'), '# Plan\nmissing acceptance anchor\n')
    installAcceptanceChecker(root)

    expect(() => runTaskAdvance({ to: 'red', dir: root })).toThrow(/acceptance/i)
    expect(readUnifiedState(root)?.phase).toBe('plan')
  })

  it.each([
    [
      'omits an issue criterion',
      validPlan(),
      issueBody(['AC-1: preserves the requested outcome', 'AC-2: reports the failure']),
    ],
    [
      'weakens an issue criterion',
      validPlan(['AC-2587.1: silently ignores the requested outcome']),
      issueBody(),
    ],
  ])('keeps plan when admission %s', (_name, plan, body) => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-red-admission-'))
    roots.push(root)
    writeUnifiedState(root, { taskId: '#2587', phase: 'plan', plan: 'plan.md' })
    writeFileSync(join(root, 'arbiter.json'), '{"features":{"acceptanceAnchor":true}}\n')
    writeFileSync(join(root, 'plan.md'), plan)
    installAcceptanceChecker(root)
    const bin = installGh(
      root,
      JSON.stringify({
        number: 2587,
        url: 'https://example.invalid/issues/2587',
        body,
        updatedAt: '2026-09-20T00:00:00Z',
      }),
    )

    withGhPath(bin, () => {
      expect(() => runTaskAdvance({ to: 'red', dir: root })).toThrow(/acceptance|criterion/i)
    })
    expect(readUnifiedState(root)?.phase).toBe('plan')
  })

  it('keeps plan when the issue cannot be read', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-red-admission-'))
    roots.push(root)
    writeUnifiedState(root, { taskId: '#2587', phase: 'plan', plan: 'plan.md' })
    writeFileSync(join(root, 'arbiter.json'), '{"features":{"acceptanceAnchor":true}}\n')
    writeFileSync(join(root, 'plan.md'), validPlan())
    installAcceptanceChecker(root)
    const bin = installGh(root, 'offline', 1)

    withGhPath(bin, () => {
      expect(() => runTaskAdvance({ to: 'red', dir: root })).toThrow(/NO DATA/i)
    })
    expect(readUnifiedState(root)?.phase).toBe('plan')
  })
})
