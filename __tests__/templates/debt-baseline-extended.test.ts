import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { computeMetricsProfile } from '../../src/generators/debt-ratchet.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

function renderAll(overrides: Partial<ProjectConfig>) {
  const config = makeConfig('/tmp/test', overrides)
  const metricsProfile = computeMetricsProfile(config)
  const data = { ...config, metricsProfile } as unknown as Record<string, unknown>
  return {
    lib: renderTemplate('scripts/debt-lib.mjs.ejs', data),
    capture: renderTemplate('scripts/capture-debt-baseline.mjs.ejs', data),
    report: renderTemplate('scripts/debt-report.mjs.ejs', data),
  }
}

// ─── Shared invariants across all stacks ─────────────────────────────────────
describe('all stacks: shared invariants', () => {
  for (const lang of ['typescript', 'rust', 'java', 'go', 'python'] as const) {
    it(`${lang}: capture imports from ./debt-lib.mjs`, () => {
      const { capture } = renderAll({ language: lang, enableDebtGates: true })
      expect(capture).toContain('./debt-lib.mjs')
    })

    it(`${lang}: report imports from ./debt-lib.mjs`, () => {
      const { report } = renderAll({ language: lang, enableDebtGates: true })
      expect(report).toContain('./debt-lib.mjs')
    })

    it(`${lang}: report contains schema migration message`, () => {
      const { report } = renderAll({ language: lang, enableDebtGates: true })
      expect(report).toContain('migrate to v2')
      expect(report).toContain('capture-debt-baseline.mjs')
    })

    it(`${lang}: baseline schema version is 2`, () => {
      const { capture } = renderAll({ language: lang, enableDebtGates: true })
      expect(capture).toContain('version: 2')
    })

    it(`${lang}: debt-lib exports collectMetrics`, () => {
      const { lib } = renderAll({ language: lang, enableDebtGates: true })
      expect(lib).toContain('collectMetrics')
    })

    it(`${lang}: debt-lib exports getCommit and countTodos`, () => {
      const { lib } = renderAll({ language: lang, enableDebtGates: true })
      expect(lib).toContain('getCommit')
      expect(lib).toContain('countTodos')
    })
  }
})

// ─── TypeScript-specific ──────────────────────────────────────────────────────
describe('typescript metrics', () => {
  it('typescript: debt-lib contains eslintErrors', () => {
    const { lib } = renderAll({ language: 'typescript' })
    expect(lib).toContain('eslintErrors')
  })

  it('typescript: debt-lib contains tscStrictErrors', () => {
    const { lib } = renderAll({ language: 'typescript' })
    expect(lib).toContain('tscStrictErrors')
  })

  it('typescript + frontend-spa: debt-lib contains bundleSizeKb', () => {
    const { lib } = renderAll({
      language: 'typescript',
      archetype: 'frontend-spa',
    })
    expect(lib).toContain('bundleSizeKb')
  })

  it('typescript + library: debt-lib does NOT contain bundleSizeKb', () => {
    const { lib } = renderAll({
      language: 'typescript',
      archetype: 'library',
    })
    expect(lib).not.toContain('bundleSizeKb')
  })

  it('typescript + backend-web-db: debt-lib contains coverageBranch', () => {
    const { lib } = renderAll({
      language: 'typescript',
      archetype: 'backend-web-db',
    })
    expect(lib).toContain('coverageBranch')
  })

  it('typescript + cli: debt-lib does NOT contain coverageBranch', () => {
    const { lib } = renderAll({ language: 'typescript', archetype: 'cli' })
    expect(lib).not.toContain('coverageBranch')
  })
})

// ─── Java-specific ────────────────────────────────────────────────────────────
describe('java metrics', () => {
  it('java: debt-lib contains pmdViolations', () => {
    const { lib } = renderAll({ language: 'java' })
    expect(lib).toContain('pmdViolations')
  })

  it('java: debt-lib contains checkstyleViolations', () => {
    const { lib } = renderAll({ language: 'java' })
    expect(lib).toContain('checkstyleViolations')
  })

  it('java: debt-lib contains spotbugsViolations (spotbugs enabled)', () => {
    const { lib } = renderAll({
      language: 'java',
      archetype: 'backend-web-db',
    })
    expect(lib).toContain('spotbugsViolations')
  })

  it('java + hexagonal: debt-lib contains archunitFailingRules', () => {
    const { lib } = renderAll({
      language: 'java',
      archetype: 'backend-web-db',
      architectureStyle: 'hexagonal',
    })
    expect(lib).toContain('archunitFailingRules')
  })

  it('java + none architectureStyle: no archunitFailingRules', () => {
    const { lib } = renderAll({
      language: 'java',
      archetype: 'backend-web-db',
      architectureStyle: 'none',
    })
    expect(lib).not.toContain('archunitFailingRules')
  })

  it('java: debt-lib uses gradle for gradle buildTool', () => {
    const { lib } = renderAll({
      language: 'java',
      buildTool: 'gradle',
    })
    expect(lib).toContain('./gradlew')
  })

  it('java: debt-lib uses mvn for maven buildTool', () => {
    const { lib } = renderAll({
      language: 'java',
      buildTool: 'maven',
    })
    expect(lib).toContain('mvn')
  })

  it('rust: no JaCoCo references', () => {
    const { lib } = renderAll({ language: 'rust', archetype: 'cli' })
    expect(lib).not.toContain('jacoco')
    expect(lib).not.toContain('pmdViolations')
  })
})

// ─── Rust-specific ────────────────────────────────────────────────────────────
describe('rust metrics', () => {
  it('rust: debt-lib contains clippyDenyCount', () => {
    const { lib } = renderAll({ language: 'rust' })
    expect(lib).toContain('clippyDenyCount')
  })

  it('rust: debt-lib contains cargoAuditAdvisories', () => {
    const { lib } = renderAll({ language: 'rust' })
    expect(lib).toContain('cargoAuditAdvisories')
  })
})

// ─── Go-specific ──────────────────────────────────────────────────────────────
describe('go metrics', () => {
  it('go: debt-lib contains golangciViolations', () => {
    const { lib } = renderAll({ language: 'go' })
    expect(lib).toContain('golangciViolations')
  })

  it('go: debt-lib contains govulncheckAdvisories', () => {
    const { lib } = renderAll({ language: 'go' })
    expect(lib).toContain('govulncheckAdvisories')
  })
})

// ─── Python-specific ──────────────────────────────────────────────────────────
describe('python metrics', () => {
  it('python: debt-lib contains ruffErrors', () => {
    const { lib } = renderAll({ language: 'python' })
    expect(lib).toContain('ruffErrors')
  })

  it('python: debt-lib contains mypyStrictErrors', () => {
    const { lib } = renderAll({ language: 'python' })
    expect(lib).toContain('mypyStrictErrors')
  })

  it('python: debt-lib contains pipAuditAdvisories', () => {
    const { lib } = renderAll({ language: 'python' })
    expect(lib).toContain('pipAuditAdvisories')
  })
})

// ─── Report v2 schema details ─────────────────────────────────────────────────
describe('debt-report.mjs v2 features', () => {
  it('report: renders items diff block when items present', () => {
    const { report } = renderAll({
      language: 'typescript',
      enableDebtGates: true,
    })
    expect(report).toContain('items')
  })

  it('report: contains archetype in baseline summary line', () => {
    const { report } = renderAll({
      language: 'typescript',
      enableDebtGates: true,
    })
    expect(report).toContain('archetype')
  })
})
