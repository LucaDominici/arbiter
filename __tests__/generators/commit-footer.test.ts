// SPDX-License-Identifier: Apache-2.0
// #1319.1 — unit coverage for the commit-footer-rationale generator. It emits
// scripts/check-commit-footer-rationale.mjs (INV-119) to the target scripts/ dir.
// Wiring/gating (registry enabled-predicate) is asserted in
// __tests__/generators/registry-gate-scripts.test.ts; this file pins the
// generator's own file-emission contract (CANON-05 co-located generator test).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateCommitFooter } from '../../src/generators/commit-footer.js'
import { makeConfig } from '../helpers.js'

describe('generateCommitFooter', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-commit-footer-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits scripts/check-commit-footer-rationale.mjs', () => {
    const result = generateCommitFooter(makeConfig(dir, { language: 'typescript' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/check-commit-footer-rationale.mjs'))).toBe(true)
    expect(existsSync(join(dir, 'scripts', 'check-commit-footer-rationale.mjs'))).toBe(true)
  })

  it('emitted script enforces INV-119 and scans the origin/main..HEAD range', () => {
    generateCommitFooter(makeConfig(dir, { language: 'typescript' }))
    const script = readFileSync(join(dir, 'scripts', 'check-commit-footer-rationale.mjs'), 'utf-8')
    expect(script).toContain('INV-119')
    expect(script).toContain('origin/main..HEAD')
  })

  it('emitted script fails OPEN (exit 0 + SKIP) when origin/main is unreachable', () => {
    generateCommitFooter(makeConfig(dir, { language: 'typescript' }))
    const script = readFileSync(join(dir, 'scripts', 'check-commit-footer-rationale.mjs'), 'utf-8')
    expect(script).toContain('if (commits === null)')
    expect(script).toContain("result: 'SKIP'")
    const failOpen = script.slice(
      script.indexOf('if (commits === null)'),
      script.indexOf('const violations'),
    )
    expect(failOpen).toContain('process.exit(0)')
    expect(failOpen).not.toContain('process.exit(1)')
  })

  it('respects dryRun (no file written to disk)', () => {
    const result = generateCommitFooter(makeConfig(dir, { language: 'typescript' }), {
      dryRun: true,
    })
    expect(result.files).toHaveLength(1)
    expect(existsSync(join(dir, 'scripts', 'check-commit-footer-rationale.mjs'))).toBe(false)
  })
})
