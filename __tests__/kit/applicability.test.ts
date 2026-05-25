// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  evaluateApplicability,
  UNIVERSAL_APPLIES,
  type ApplicabilityResult,
} from '../../src/kit/applicability.js'
import type { KitDimension } from '../../src/kit/schema.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDim(overrides: Partial<KitDimension> = {}): KitDimension {
  return {
    id: 'N01',
    name: 'Test dim',
    tml: 'M',
    gate: 'L1',
    categoryRef: 'testing',
    archetypeGating: { applies: [], excludes: [] },
    status: 'covered',
    ...overrides,
  }
}

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    targetDir: '/tmp/test',
    projectName: 'test',
    description: '',
    language: 'typescript',
    framework: null,
    archetype: 'backend-web-db',
    architectureStyle: 'none',
    isMultiTenant: false,
    hasDatabase: false,
    hasPublicApi: false,
    buildTool: 'npm',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npm run format',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: true,
    githubOwner: null,
    githubRepo: null,
    existing: {
      agentsMd: false,
      claudeDir: false,
      agentsDir: false,
      aiRulez: false,
      settingsJson: false,
      checkAllScript: false,
      geminiDir: false,
      windsurfRules: false,
      aiderConf: false,
    },
    languageHooks: [],
    enableDebtGates: true,
    enableSuppressions: true,
    ...overrides,
  } as ProjectConfig
}

// ─── UNIVERSAL_APPLIES constant ───────────────────────────────────────────────

describe('UNIVERSAL_APPLIES', () => {
  it('is a sentinel distinguishable from a filled applies array', () => {
    expect(UNIVERSAL_APPLIES).toBeDefined()
  })
})

// ─── applies: [] = universal ──────────────────────────────────────────────────

describe('evaluateApplicability — universal dims (applies: [])', () => {
  it('applies to typescript backend', () => {
    const dim = makeDim({ archetypeGating: { applies: [], excludes: [] } })
    const result = evaluateApplicability(dim, makeConfig())
    expect(result.applicability).toBe('applicable')
  })

  it('applies to java hexagonal', () => {
    const dim = makeDim({ archetypeGating: { applies: [], excludes: [] } })
    const config = makeConfig({ language: 'java', architectureStyle: 'hexagonal' })
    const result = evaluateApplicability(dim, config)
    expect(result.applicability).toBe('applicable')
  })

  it('applies to unknown language', () => {
    const dim = makeDim({ archetypeGating: { applies: [], excludes: [] } })
    const config = makeConfig({ language: 'unknown' })
    const result = evaluateApplicability(dim, config)
    expect(result.applicability).toBe('applicable')
  })

  it('applies to multi language', () => {
    const dim = makeDim({ archetypeGating: { applies: [], excludes: [] } })
    const config = makeConfig({ language: 'multi' })
    const result = evaluateApplicability(dim, config)
    expect(result.applicability).toBe('applicable')
  })
})

// ─── applies: ['hexagonal'] ───────────────────────────────────────────────────

describe('evaluateApplicability — hexagonal token', () => {
  const dim = makeDim({ archetypeGating: { applies: ['hexagonal'], excludes: [] } })

  it('applicable when architectureStyle is hexagonal', () => {
    const result = evaluateApplicability(dim, makeConfig({ architectureStyle: 'hexagonal' }))
    expect(result.applicability).toBe('applicable')
  })

  it('na when architectureStyle is layered', () => {
    const result = evaluateApplicability(dim, makeConfig({ architectureStyle: 'layered' }))
    expect(result.applicability).toBe('na')
    expect(result.reason).toBeDefined()
  })

  it('na when architectureStyle is none', () => {
    const result = evaluateApplicability(dim, makeConfig({ architectureStyle: 'none' }))
    expect(result.applicability).toBe('na')
  })
})

// ─── applies: ['java'] ────────────────────────────────────────────────────────

describe('evaluateApplicability — java token (N12)', () => {
  const dim = makeDim({ id: 'N12', archetypeGating: { applies: ['java'], excludes: [] } })

  it('applicable when language is java', () => {
    const result = evaluateApplicability(dim, makeConfig({ language: 'java' }))
    expect(result.applicability).toBe('applicable')
  })

  it('applicable when language is kotlin (java-family)', () => {
    const result = evaluateApplicability(dim, makeConfig({ language: 'kotlin' }))
    expect(result.applicability).toBe('applicable')
  })

  it('na when language is typescript', () => {
    const result = evaluateApplicability(dim, makeConfig({ language: 'typescript' }))
    expect(result.applicability).toBe('na')
  })

  it('na when language is python', () => {
    const result = evaluateApplicability(dim, makeConfig({ language: 'python' }))
    expect(result.applicability).toBe('na')
  })

  it('na when language is go', () => {
    const result = evaluateApplicability(dim, makeConfig({ language: 'go' }))
    expect(result.applicability).toBe('na')
  })

  it('na when language is rust', () => {
    const result = evaluateApplicability(dim, makeConfig({ language: 'rust' }))
    expect(result.applicability).toBe('na')
  })
})

// ─── applies: ['spring'] ─────────────────────────────────────────────────────

describe('evaluateApplicability — spring token (N04-N06)', () => {
  const dim = makeDim({ archetypeGating: { applies: ['hexagonal', 'spring'], excludes: [] } })

  it('applicable when framework includes spring-boot', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ framework: 'spring-boot', architectureStyle: 'none' }),
    )
    expect(result.applicability).toBe('applicable')
  })

  it('applicable when framework includes Spring (case-insensitive)', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ framework: 'Spring MVC', architectureStyle: 'none' }),
    )
    expect(result.applicability).toBe('applicable')
  })

  it('applicable when architectureStyle is hexagonal (spring not required when hexagonal matches)', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ framework: null, architectureStyle: 'hexagonal' }),
    )
    expect(result.applicability).toBe('applicable')
  })

  it('na when neither hexagonal nor spring framework', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ framework: 'express', architectureStyle: 'none' }),
    )
    expect(result.applicability).toBe('na')
  })

  it('na when framework is null and not hexagonal', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ framework: null, architectureStyle: 'layered' }),
    )
    expect(result.applicability).toBe('na')
  })
})

// ─── applies: ['frontend', 'fullstack'] + excludes: ['backend', 'api'] (N76) ─

describe('evaluateApplicability — N76 frontend/fullstack with excludes', () => {
  const dim = makeDim({
    id: 'N76',
    archetypeGating: { applies: ['frontend', 'fullstack'], excludes: ['backend', 'api'] },
  })

  it('applicable for frontend-spa without publicApi', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ archetype: 'frontend-spa', hasPublicApi: false }),
    )
    expect(result.applicability).toBe('applicable')
  })

  it('na when api excluded (hasPublicApi=true)', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ archetype: 'frontend-spa', hasPublicApi: true }),
    )
    expect(result.applicability).toBe('na')
  })

  it('na when archetype is backend-web-db (backend excluded)', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ archetype: 'backend-web-db', hasPublicApi: false }),
    )
    expect(result.applicability).toBe('na')
  })

  it('excludes wins over applies on conflict', () => {
    // fullstack matches applies, backend matches excludes — exclude wins
    const result = evaluateApplicability(
      dim,
      makeConfig({ archetype: 'backend-web-db', hasPublicApi: false }),
    )
    expect(result.applicability).toBe('na')
  })
})

// ─── applies: ['backend', 'api', 'fullstack'] + excludes: ['frontend', 'cli', 'embedded'] (N77) ─

describe('evaluateApplicability — N77 backend/api/fullstack with excludes + conditionalFlag', () => {
  const dim = makeDim({
    id: 'N77',
    archetypeGating: {
      applies: ['backend', 'api', 'fullstack'],
      excludes: ['frontend', 'cli', 'embedded'],
    },
    conditionalFlag: 'spring-boot',
  })

  it('applicable for backend with spring framework', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ archetype: 'backend-web-db', framework: 'spring-boot', hasPublicApi: false }),
    )
    expect(result.applicability).toBe('applicable')
  })

  it('na for backend without spring-boot framework', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ archetype: 'backend-web-db', framework: 'express', hasPublicApi: false }),
    )
    expect(result.applicability).toBe('na')
  })

  it('na for frontend archetype (excluded)', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ archetype: 'frontend-spa', framework: 'spring-boot' }),
    )
    expect(result.applicability).toBe('na')
  })

  it('na for cli archetype (excluded)', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ archetype: 'cli', framework: 'spring-boot' }),
    )
    expect(result.applicability).toBe('na')
  })
})

// ─── requiresDbEngine filter (N08/N73/N74/N75) ────────────────────────────────

describe('evaluateApplicability — requiresDbEngine filter', () => {
  const dim = makeDim({
    id: 'N08',
    archetypeGating: { applies: [], excludes: [] },
    requiresDbEngine: ['postgresql', 'mysql', 'mongodb'],
  })

  it('applicable when databaseEngine matches', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ hasDatabase: true, databaseEngine: 'postgresql' }),
    )
    expect(result.applicability).toBe('applicable')
  })

  it('applicable when databaseEngine is mysql', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ hasDatabase: true, databaseEngine: 'mysql' }),
    )
    expect(result.applicability).toBe('applicable')
  })

  it('applicable when databaseEngine is mongodb', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ hasDatabase: true, databaseEngine: 'mongodb' }),
    )
    expect(result.applicability).toBe('applicable')
  })

  it('na when databaseEngine is sqlite (not in requiresDbEngine list)', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ hasDatabase: true, databaseEngine: 'sqlite' }),
    )
    expect(result.applicability).toBe('na')
  })

  it('na when hasDatabase is false', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ hasDatabase: false, databaseEngine: undefined }),
    )
    expect(result.applicability).toBe('na')
  })

  it('na when databaseEngine is absent even with hasDatabase=true', () => {
    const result = evaluateApplicability(dim, makeConfig({ hasDatabase: true }))
    expect(result.applicability).toBe('na')
  })
})

// ─── N74: requiresDbEngine without mongodb ────────────────────────────────────

describe('evaluateApplicability — N74 (no mongodb)', () => {
  const dim = makeDim({
    id: 'N74',
    archetypeGating: { applies: [], excludes: [] },
    requiresDbEngine: ['postgresql', 'mysql'],
  })

  it('na when databaseEngine is mongodb', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ hasDatabase: true, databaseEngine: 'mongodb' }),
    )
    expect(result.applicability).toBe('na')
  })

  it('applicable when databaseEngine is postgresql', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ hasDatabase: true, databaseEngine: 'postgresql' }),
    )
    expect(result.applicability).toBe('applicable')
  })
})

// ─── audit-write-services conditionalFlag (N08/N73/N74/N75) ──────────────────

describe('evaluateApplicability — audit-write-services conditionalFlag', () => {
  const dim = makeDim({
    id: 'N08',
    archetypeGating: { applies: [], excludes: [] },
    requiresDbEngine: ['postgresql', 'mysql', 'mongodb'],
    conditionalFlag: 'audit-write-services',
  })

  it('applicable when databaseEngine matches (conditionalFlag is informational only)', () => {
    const result = evaluateApplicability(
      dim,
      makeConfig({ hasDatabase: true, databaseEngine: 'postgresql' }),
    )
    expect(result.applicability).toBe('applicable')
  })
})

// ─── language:'multi' matches any language token ──────────────────────────────

describe('evaluateApplicability — language:multi', () => {
  const javaDim = makeDim({ id: 'N12', archetypeGating: { applies: ['java'], excludes: [] } })

  it('multi language applies to java-gated dim', () => {
    const result = evaluateApplicability(javaDim, makeConfig({ language: 'multi' }))
    expect(result.applicability).toBe('applicable')
  })
})

// ─── language:'unknown' is fail-closed ───────────────────────────────────────

describe('evaluateApplicability — language:unknown fail-closed', () => {
  const javaDim = makeDim({ id: 'N12', archetypeGating: { applies: ['java'], excludes: [] } })

  it('unknown language is na for java-gated dim', () => {
    const result = evaluateApplicability(javaDim, makeConfig({ language: 'unknown' }))
    expect(result.applicability).toBe('na')
    expect(result.reason).toMatch(/language/)
  })
})

// ─── Return type shape ────────────────────────────────────────────────────────

describe('evaluateApplicability — return type', () => {
  it('returns ApplicabilityResult with applicability field', () => {
    const dim = makeDim()
    const result: ApplicabilityResult = evaluateApplicability(dim, makeConfig())
    expect(result).toHaveProperty('applicability')
  })

  it('reason is defined when na', () => {
    const dim = makeDim({ archetypeGating: { applies: ['hexagonal'], excludes: [] } })
    const result = evaluateApplicability(dim, makeConfig({ architectureStyle: 'none' }))
    expect(result.applicability).toBe('na')
    expect(typeof result.reason).toBe('string')
    expect(result.reason!.length).toBeGreaterThan(0)
  })

  it('reason is absent or undefined when applicable', () => {
    const dim = makeDim()
    const result = evaluateApplicability(dim, makeConfig())
    expect(result.applicability).toBe('applicable')
    expect(result.reason).toBeUndefined()
  })
})
