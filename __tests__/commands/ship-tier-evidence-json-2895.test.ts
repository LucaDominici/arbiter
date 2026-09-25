// SPDX-License-Identifier: Apache-2.0
//
// #2895 follow-up: the real collector run on this very branch's diff showed
// `.arbiter/evidence/tdd/#<id>.json` also blocking graph coverage — every
// TDD-following task creates one, so the original .md-only fix was not
// enough to make XS/S reachable. Sibling file: __tests__/commands/ship-tier.test.ts
// has a pinned RED-evidence blob and must not change.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupTestProject, createTestProject } from '../helpers.js'
import { gatherTierSignals } from '../../src/commands/ship-tier.js'
import { writeUnifiedState } from '../../src/commands/task-state.js'

const { runCli, runCliJson } = vi.hoisted(() => ({
  runCli: vi.fn(() => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 })),
  runCliJson: vi.fn(),
}))

vi.mock('../../src/utils/run-cli.js', () => ({ runCli, runCliJson }))

function writeFile(dir: string, relativePath: string): void {
  const path = join(dir, relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, 'fixture\n', 'utf-8')
}

describe('gatherTierSignals — TDD evidence JSON (#2895 follow-up)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
    runCli.mockReset()
    runCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 })
    runCliJson.mockReset()
    runCliJson.mockReturnValue({ labels: [], milestone: null })
    const planDir = join(dir, '.claude', 'plans')
    mkdirSync(planDir, { recursive: true })
    writeFileSync(
      join(planDir, 'task-2895.md'),
      '---\nfiles:\n  - .claude/plans/task-2895.md\n  - .arbiter/evidence/tdd/#2895.json\n---\n\n# plan\n',
      'utf-8',
    )
    writeUnifiedState(dir, { taskId: '#2895', plan: '.claude/plans/task-2895.md' })
    writeFile(dir, '.arbiter/evidence/tdd/#2895.json')
    const graphDir = join(dir, 'graphify-out')
    mkdirSync(graphDir, { recursive: true })
    const graph = join(graphDir, 'graph.json')
    writeFileSync(graph, JSON.stringify({ nodes: [], links: [] }), 'utf-8')
    utimesSync(graph, new Date(Date.now() + 2_000), new Date(Date.now() + 2_000))
  })
  afterEach(() => cleanupTestProject(dir))

  it('excludes the TDD evidence JSON from graph coverage (never AST-indexed)', () => {
    expect(gatherTierSignals(dir, '#2895', '.claude/plans/task-2895.md')).toMatchObject({
      complete: true,
    })
  })
})

// Review #2896 F1 (HIGH): the tdd/ exclusion regex had no trailing anchor, so it exempted
// ANY file under .arbiter/evidence/tdd/ — including code — from graph coverage. Only the
// exact `.gitignore` un-ignore shape (`.arbiter/evidence/tdd/<name>.json`, no subdirectory)
// may be exempt.
describe('gatherTierSignals — TDD evidence JSON exclusion is anchored (#2896 F1)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
    runCli.mockReset()
    runCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 })
    runCliJson.mockReset()
    runCliJson.mockReturnValue({ labels: [], milestone: null })
    const planDir = join(dir, '.claude', 'plans')
    mkdirSync(planDir, { recursive: true })
    const graphDir = join(dir, 'graphify-out')
    mkdirSync(graphDir, { recursive: true })
    const graph = join(graphDir, 'graph.json')
    writeFileSync(graph, JSON.stringify({ nodes: [], links: [] }), 'utf-8')
    utimesSync(graph, new Date(Date.now() + 2_000), new Date(Date.now() + 2_000))
  })
  afterEach(() => cleanupTestProject(dir))

  it.each([
    ['.arbiter/evidence/tdd/backdoor.ts', 'a code file, not evidence data'],
    ['.arbiter/evidence/tdd/sub/x.json', 'a subdirectory, not the flat evidence dir'],
    ['.arbiter/evidence/tdd/x.json.ts', 'a code file with .json in its name, not a .json file'],
  ])('%s (%s) is not exempt: stays out of graph coverage', (relativePath) => {
    const planDir = join(dir, '.claude', 'plans')
    writeFileSync(
      join(planDir, 'task-2896.md'),
      `---\nfiles:\n  - .claude/plans/task-2896.md\n  - ${relativePath}\n---\n\n# plan\n`,
      'utf-8',
    )
    writeUnifiedState(dir, { taskId: '#2896', plan: '.claude/plans/task-2896.md' })
    writeFile(dir, relativePath)

    expect(gatherTierSignals(dir, '#2896', '.claude/plans/task-2896.md')).toMatchObject({
      complete: false,
    })
  })
})
