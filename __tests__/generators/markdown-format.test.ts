// SPDX-License-Identifier: Apache-2.0
// Regression tests for #1075: generated Markdown must have well-formed table rows
// (pipe closure) and must not emit excessive blank lines (idempotent-by-eye output).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateClaude } from '../../src/generators/claude.js'
import { generateAgentsMd } from '../../src/generators/agents-md.js'
import { generateGlobalInvariants } from '../../src/generators/global-invariants.js'
import { makeConfig } from '../helpers.js'

/** Lines in a string that start with `|` but do NOT end with `|`. */
function pipeViolations(content: string): string[] {
  return content.split('\n').filter((line) => line.startsWith('|') && !line.trimEnd().endsWith('|'))
}

/** Max number of consecutive blank lines in a string. */
function maxConsecutiveBlanks(content: string): number {
  let max = 0
  let run = 0
  for (const line of content.split('\n')) {
    if (line.trim() === '') {
      run++
      if (run > max) max = run
    } else {
      run = 0
    }
  }
  return max
}

describe('#1075 — F2: CLAUDE.md Hooks table rows must close with |', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-1075-pipe-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('L2 + TypeScript: all table rows end with |', () => {
    generateClaude(makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    const violations = pipeViolations(content)
    expect(violations, `Bad rows (no trailing |):\n${violations.join('\n')}`).toHaveLength(0)
  })

  it('L1 + TypeScript: all table rows end with |', () => {
    generateClaude(makeConfig(dir, { language: 'typescript', governanceLevel: 'L1' }))
    const content = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    const violations = pipeViolations(content)
    expect(violations, `Bad rows (no trailing |):\n${violations.join('\n')}`).toHaveLength(0)
  })

  it('L2 + Rust: all table rows end with |', () => {
    generateClaude(makeConfig(dir, { language: 'rust', governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    const violations = pipeViolations(content)
    expect(violations, `Bad rows (no trailing |):\n${violations.join('\n')}`).toHaveLength(0)
  })
})

describe('#1075 — F3: generated Markdown must not emit excessive blank lines', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-1075-blanks-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('GLOBAL_INVARIANTS.md: max 1 consecutive blank line', () => {
    generateGlobalInvariants(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')
    const max = maxConsecutiveBlanks(content)
    expect(max, `Found ${max} consecutive blank lines — expected ≤ 1`).toBeLessThanOrEqual(1)
  })

  it('AGENTS.md: max 1 consecutive blank line', () => {
    generateAgentsMd(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    const max = maxConsecutiveBlanks(content)
    expect(max, `Found ${max} consecutive blank lines — expected ≤ 1`).toBeLessThanOrEqual(1)
  })

  it('AGENTS.md with lanes: max 1 consecutive blank line', () => {
    generateAgentsMd(makeConfig(dir, { governanceLevel: 'L2', lanes: ['frontend', 'backend'] }))
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    const max = maxConsecutiveBlanks(content)
    expect(max, `Found ${max} consecutive blank lines — expected ≤ 1`).toBeLessThanOrEqual(1)
  })
})

describe('#1075 — F3: generator output is idempotent (same inputs → byte-identical output)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-1075-idem-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('CLAUDE.md is byte-identical on second generation', () => {
    const cfg = makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' })
    generateClaude(cfg)
    const first = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    generateClaude(cfg)
    const second = readFileSync(join(dir, '.claude', 'CLAUDE.md'), 'utf-8')
    expect(second).toBe(first)
  })

  it('AGENTS.md is byte-identical on second generation', () => {
    const cfg = makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' })
    generateAgentsMd(cfg)
    const first = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    generateAgentsMd(cfg)
    const second = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(second).toBe(first)
  })

  it('GLOBAL_INVARIANTS.md is byte-identical on second generation', () => {
    const cfg = makeConfig(dir, { governanceLevel: 'L2' })
    generateGlobalInvariants(cfg)
    const first = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')
    generateGlobalInvariants(cfg)
    const second = readFileSync(join(dir, 'GLOBAL_INVARIANTS.md'), 'utf-8')
    expect(second).toBe(first)
  })
})

describe('#1075 — F3: testCommand regression (must not flip to `npm run test`)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-1075-testcmd-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('AGENTS.md Quick Reference table uses testCommand verbatim', () => {
    generateAgentsMd(makeConfig(dir, { testCommand: 'npm test' }))
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('npm test')
    expect(content).not.toMatch(/\| \*\*Test\*\* \| `npm run test`/)
  })
})
