// SPDX-License-Identifier: Apache-2.0
// #2587 RED receipt: acceptance-anchor validation must happen on red admission.
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runTaskAdvance } from '../../src/commands/task.js'
import { readUnifiedState, writeUnifiedState } from '../../src/commands/task-state.js'
import { deriveGatesForFiles } from '../../scripts/lib/gate-derivation.mjs'
import { inspectGateContract } from '../../scripts/lib/gate-contract.mjs'

const roots: string[] = []

function installGateContractAuthority(root: string): void {
  writeFileSync(
    join(root, 'scripts', 'check-all.mjs'),
    [
      '#!/usr/bin/env node',
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
}

function deriveFixtureGates(root: string, files: string[]): unknown[] {
  return deriveGatesForFiles(files, undefined, inspectGateContract(root))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function installAcceptanceChecker(root: string): void {
  symlinkSync(resolve(__dirname, '../../node_modules'), join(root, 'node_modules'), 'dir')
  cpSync(resolve(__dirname, '../../scripts', 'lib'), join(root, 'scripts', 'lib'), {
    recursive: true,
  })
  cpSync(
    resolve(__dirname, '../../scripts', 'check-acceptance.mjs'),
    join(root, 'scripts', 'check-acceptance.mjs'),
  )
  installGateContractAuthority(root)
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

function trackPlanAtHead(root: string): void {
  execFileSync('git', ['init', '-q', '-b', 'task/test'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'fixture@arbiter.dev'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root })
  execFileSync('git', ['add', '-f', 'plan.md'], { cwd: root })
  execFileSync('git', ['commit', '-q', '-m', 'test: track plan'], { cwd: root })
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
    trackPlanAtHead(root)
    installAcceptanceChecker(root)

    expect(() => runTaskAdvance({ to: 'red', dir: root })).toThrow(/acceptance/i)
    expect(readUnifiedState(root)?.phase).toBe('plan')
  })

  it.each([
    [
      'omits an issue criterion',
      validPlan(),
      issueBody(['AC-1: preserves the requested outcome', 'AC-2: reports the failure']),
      /criterion AC-2 is missing as plan AC-2587\.2/,
    ],
    [
      'weakens an issue criterion',
      validPlan(['AC-2587.1: silently ignores the requested outcome']),
      issueBody(),
      /criterion AC-1 does not match plan AC-2587\.1/,
    ],
  ])('keeps plan when admission %s', (_name, plan, body, expected) => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-red-admission-'))
    roots.push(root)
    const files = ['src/example.ts']
    writeUnifiedState(root, {
      taskId: '#2587',
      phase: 'plan',
      plan: 'plan.md',
      derivedGates: deriveFixtureGates(root, files),
    })
    writeFileSync(join(root, 'arbiter.json'), '{"features":{"acceptanceAnchor":true}}\n')
    writeFileSync(
      join(root, 'plan.md'),
      ['---', 'files:', ...files.map((file) => `  - ${file}`), '---', plan].join('\n'),
    )
    trackPlanAtHead(root)
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
      expect(() => runTaskAdvance({ to: 'red', dir: root })).toThrow(expected)
    })
    expect(readUnifiedState(root)?.phase).toBe('plan')
  })

  it('keeps plan when the issue cannot be read', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-red-admission-'))
    roots.push(root)
    writeUnifiedState(root, { taskId: '#2587', phase: 'plan', plan: 'plan.md' })
    writeFileSync(join(root, 'arbiter.json'), '{"features":{"acceptanceAnchor":true}}\n')
    writeFileSync(join(root, 'plan.md'), validPlan())
    trackPlanAtHead(root)
    installAcceptanceChecker(root)
    const bin = installGh(root, 'offline', 1)

    withGhPath(bin, () => {
      expect(() => runTaskAdvance({ to: 'red', dir: root })).toThrow(/NO DATA/i)
    })
    expect(readUnifiedState(root)?.phase).toBe('plan')
  })

  it('skips issue coverage for a non-GitHub task id and runs the ordinary plan check', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-red-admission-'))
    roots.push(root)
    const files = ['docs/example.md']
    const plan = [
      '---',
      'files:',
      ...files.map((file) => `  - ${file}`),
      '---',
      validPlan(['AC-1: preserves the requested outcome']),
    ].join('\n')
    installAcceptanceChecker(root)
    writeUnifiedState(root, {
      taskId: 'JIRA-42',
      phase: 'plan',
      plan: 'plan.md',
      derivedGates: deriveFixtureGates(root, files),
    })
    writeFileSync(join(root, 'arbiter.json'), '{"features":{"acceptanceAnchor":true}}\n')
    writeFileSync(join(root, 'plan.md'), plan)
    trackPlanAtHead(root)
    const output = vi.spyOn(process.stdout, 'write')

    runTaskAdvance({ to: 'red', dir: root })

    expect(readUnifiedState(root)?.phase).toBe('red')
    expect(output).toHaveBeenCalledWith(
      'SKIP issue-coverage admission: task id JIRA-42 is not a GitHub issue number\n',
    )
  })
})
