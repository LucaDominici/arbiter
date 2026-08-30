// SPDX-License-Identifier: Apache-2.0
// #2367 (ADR-119) — the five experimental tool generators (cursor, copilot,
// gemini, windsurf, aider) are RETIRED. This suite is the executable form of
// that decision: it fails if any retired artifact returns, if the support
// matrix drifts away from `claude,codex`, or if a user-facing surface starts
// advertising a tool arbiter no longer emits.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AI_TOOLS, sanitizeCoercibleFields, validateConfig } from '../../src/config/schema.js'
import { SUPPORTED_AI_TOOLS } from '../../src/wizard/types.js'
import { buildRegistry } from '../../src/generators/registry.js'
import { makeConfig } from '../helpers.js'

const RETIRED = ['cursor', 'copilot', 'gemini', 'windsurf', 'aider'] as const

function read(rel: string): string {
  return readFileSync(resolve(rel), 'utf-8')
}

function baseRawConfig(tools: string[]): Record<string, unknown> {
  return {
    version: '0.2',
    tools,
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
      suppressions: false,
    },
    thresholds: {
      lineCoverage: 80,
      branchCoverage: 70,
      mutationScore: 75,
      cyclomaticComplexity: 10,
      methodLength: 20,
      maxParams: 5,
    },
  }
}

describe('#2367 — retired experimental tool generators are absent from the tree', () => {
  for (const tool of RETIRED) {
    it(`no generator, template tree or test survives for "${tool}"`, () => {
      expect(existsSync(resolve(`src/generators/${tool}.ts`))).toBe(false)
      expect(existsSync(resolve(`src/templates/${tool}`))).toBe(false)
      expect(existsSync(resolve(`__tests__/generators/${tool}.test.ts`))).toBe(false)
      expect(existsSync(resolve(`__tests__/tools/${tool}.test.ts`))).toBe(false)
      expect(existsSync(resolve(`__tests__/templates/${tool}.test.ts`))).toBe(false)
    })
  }

  it('the shared agent-file factory goes with its only callers (no dead abstraction)', () => {
    expect(existsSync(resolve('src/generators/agent-file.ts'))).toBe(false)
    expect(existsSync(resolve('__tests__/generators/agent-file.test.ts'))).toBe(false)
  })

  it('no source file imports a retired generator', () => {
    const registry = read('src/generators/registry.ts')
    for (const tool of RETIRED) {
      expect(registry).not.toContain(`./${tool}.js`)
    }
  })
})

describe('#2367 — the support matrix matches the recorded decisions', () => {
  it('the runtime allow-list is exactly claude,codex', () => {
    expect([...AI_TOOLS].sort()).toEqual(['claude', 'codex'])
  })

  it('the customer-facing SSOT and the runtime allow-list agree', () => {
    expect([...SUPPORTED_AI_TOOLS].sort()).toEqual([...AI_TOOLS].sort())
  })

  it('AiTool declares only the two supported members', () => {
    const types = read('src/wizard/types.ts')
    expect(types).toMatch(/export type AiTool = 'claude' \| 'codex'/)
  })

  it('the registry builds no spec for a retired tool', () => {
    const specs = buildRegistry(makeConfig('/tmp', { tools: ['claude'] }))
    const keys = specs.map((s) => s.key as string)
    for (const tool of RETIRED) {
      expect(keys).not.toContain(tool)
    }
  })
})

describe('#2367 — config carrying a retired tool is rejected, then coerced (never bricked)', () => {
  for (const tool of RETIRED) {
    it(`validateConfig rejects tools: ["${tool}"]`, () => {
      const result = validateConfig(baseRawConfig([tool]))
      expect(result.ok).toBe(false)
    })
  }

  it('sanitizeCoercibleFields drops a retired tool instead of failing closed (ADR-105)', () => {
    const { draft, report } = sanitizeCoercibleFields(baseRawConfig(['claude', 'cursor']))
    expect(draft['tools']).toEqual(['claude'])
    expect(report.some((r) => r.field === 'tools')).toBe(true)
  })

  it('a config naming ONLY retired tools falls back to the supported set', () => {
    const { draft } = sanitizeCoercibleFields(baseRawConfig(['cursor', 'aider']))
    expect(draft['tools']).toEqual(['claude', 'codex'])
  })
})

describe('#2367 — user-facing surfaces reflect the decisions (AC-6)', () => {
  it('the comparisons footnote no longer advertises experimental tool generators', () => {
    const md = read('website/comparisons/index.md')
    expect(md).not.toMatch(/generators exist but are \*\*experimental\*\*/)
    for (const tool of RETIRED) {
      expect(md.toLowerCase()).not.toMatch(new RegExp(`${tool}[^\\n]*experimental`, 'i'))
    }
  })

  it('the CLI reference lists no output path for a retired tool', () => {
    const md = read('website/reference/cli.md')
    expect(md).not.toContain('.cursorrules')
    expect(md).not.toContain('copilot-instructions.md')
    expect(md).not.toContain('.gemini/GEMINI.md')
    expect(md).not.toContain('windsurf-instructions.md')
    expect(md).not.toContain('.aider.conf.yml')
  })
})

describe('#2367 — the decisions are recorded durably', () => {
  const ADR = 'docs/internal/ADR/119-experimental-tool-generators-retired.md'

  it('an ADR records a decision for each of the five tools', () => {
    expect(existsSync(resolve(ADR))).toBe(true)
    const adr = read(ADR)
    for (const tool of RETIRED) {
      expect(adr).toContain(tool)
    }
    expect(adr).toContain('RETIRE')
  })

  it('the ADR states the promotion criteria derived from the codex track (AC-1)', () => {
    const adr = read(ADR)
    expect(adr).toContain('check-codex-parity')
    expect(adr).toContain('check-codex-self-parity')
    expect(adr).toContain('ADR-106')
  })

  it('the ADR keeps the gemini review-provider role separate from config emission', () => {
    const adr = read(ADR)
    expect(adr).toMatch(/review provider/i)
    expect(adr).toMatch(/config-emission/i)
  })

  it('the public-type narrowing carries a semver note', () => {
    const semver = read('docs/SEMVER.md')
    expect(semver).toContain('AiTool')
  })
})
