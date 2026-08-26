// SPDX-License-Identifier: Apache-2.0
// #1742: the vitest coverage exclude for the repo-local .claude/ tree MUST be
// anchored to the resolved config root. A bare relative glob ('.claude/**' or
// '**/.claude/**') is matched against the ABSOLUTE file path, so in an agent
// worktree living under .claude/worktrees/ it swallows EVERY file: vitest emits
// an empty coverage-summary.json (pct "Unknown") and the coverage ratchet
// (scripts/check-coverage-ratchet.mjs) fails the L2 gate deterministically.
// The exclusion itself must stay: .claude/ hook libs are imported in-process by
// the sanitize-task-id-parity and hooks-perf-scoping tests and are not product
// code (INV-25 coverage floor measures src/ only).
//
// Same root cause as #1731 ("v8 coverage instrumentation returns 0/0 in
// agent-sandbox worktrees"): that report's own repro narrowed the defect to
// files that import src/** directly (ruling out the scripts/** exclusion),
// which is exactly the over-matching bare '.claude/**' glob above swallowing
// every file, src included. Empirically verified against a real
// .claude/worktrees/<id>/ checkout: reverting to the bare '.claude/**'
// pattern reproduces 0/0 on `__tests__/compatibility/parsers.test.ts`
// (imports only src/compatibility/parsers.ts); the anchored pattern below
// instruments it correctly (100% lines / 86.66% branches). No further code
// change needed for #1731 — this anchoring invariant guards both.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import config from '../../vitest.config'

function coverageExclude(): string[] {
  const test = (config as { test?: { coverage?: { exclude?: string[] } } }).test
  return test?.coverage?.exclude ?? []
}

describe('vitest coverage exclude anchoring (#1742)', () => {
  it('keeps a .claude exclusion (hook libs are imported in-process but are not product code)', () => {
    const claudeEntries = coverageExclude().filter((p) => p.includes('.claude'))
    expect(claudeEntries.length).toBeGreaterThan(0)
  })

  it('anchors every .claude exclude to the resolved root — never a bare glob', () => {
    const claudeEntries = coverageExclude().filter((p) => p.includes('.claude'))
    for (const pattern of claudeEntries) {
      // Anchored = absolute (join(root, '.claude/**')). A relative pattern is
      // matched against absolute paths and over-matches any project rooted
      // under a .claude/ directory (agent worktrees).
      expect(isAbsolute(pattern), `coverage exclude "${pattern}" must be root-anchored`).toBe(true)
    }
  })

  it('never excludes shipped source files to hide environment-dependent branches (#2373)', () => {
    expect(coverageExclude().filter((pattern) => pattern.startsWith('src/'))).toEqual([])
  })

  it('keeps ignores on genuinely environment-dependent branches only (#2373)', () => {
    const source = (path: string): string => readFileSync(resolve(path), 'utf-8')
    const hostProbe = source('src/capabilities/host-probe.ts')
    const skillDetector = source('src/integrations/skill-detector.ts')
    const taskShip = source('src/commands/task-ship.ts')
    const task = source('src/commands/task.ts')

    expect(hostProbe).toMatch(/#2373:[^\n]+\.claude\/projects[^\n]*\n\s*\/\* v8 ignore start \*\//)
    expect(skillDetector).not.toMatch(/v8 ignore/)
    expect(taskShip).toMatch(/#2373:[^\n]*companion[^\n]*\n\s*\/\* v8 ignore next \*\//)
    expect(taskShip).toMatch(/#2373:[^\n]*companion[^\n]*\n\s*\/\* v8 ignore start \*\//)
    expect(task).not.toContain('#2373')
  })
})
