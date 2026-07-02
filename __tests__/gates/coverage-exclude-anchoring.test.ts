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
import { describe, it, expect } from 'vitest'
import { isAbsolute } from 'node:path'
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
})
