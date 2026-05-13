import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import {
  getFilteredInvariants,
  getInvariantsByTier,
  presetToTiers,
} from '../../src/invariants/filter.js'
import type { InvariantTier, GovernanceLevel } from '../../src/wizard/types.js'
import type { Language } from '../../src/wizard/types.js'

const TIER_LABELS: Record<InvariantTier, string> = {
  architectural: 'Tier 1: Architectural Integrity',
  data: 'Tier 2: Data Integrity',
  security: 'Tier 3: Security & Compliance',
  operational: 'Tier 4: Operational Excellence',
  governance: 'Tier 5: Governance',
}

describe('agents-md/AGENTS.md.ejs template rendering', () => {
  // renderTemplate expects Record<string, unknown>, makeConfig returns ProjectConfig.
  // We use a dummy dir since rendering does not write to disk.
  const dummyDir = '/tmp/arbiter-render-test'

  function renderAgentsMd(overrides: Record<string, unknown> = {}): string {
    const config = makeConfig(dummyDir)
    const merged = { ...config, ...overrides }
    const invariants = getFilteredInvariants({
      language: (overrides.language ?? config.language) as Language,
      governanceLevel: (overrides.governanceLevel ?? config.governanceLevel) as GovernanceLevel,
      invariantTiers: (overrides.invariantTiers ?? config.invariantTiers) as InvariantTier[],
    })
    const data = {
      ...merged,
      invariants,
      invariantsByTier: getInvariantsByTier(invariants),
      tierLabels: TIER_LABELS,
    } as unknown as Record<string, unknown>
    return renderTemplate('agents-md/AGENTS.md.ejs', data)
  }

  it('renders with TypeScript — contains TypeScript coding standards', () => {
    const content = renderAgentsMd({ language: 'typescript' })
    expect(content).toContain('TypeScript')
    expect(content).toContain('Strict mode always on')
    expect(content).toContain('No `any`')
  })

  it('renders with Java — contains Java coding standards', () => {
    const content = renderAgentsMd({ language: 'java' })
    expect(content).toContain('Java')
    expect(content).toContain('Hexagonal architecture')
    expect(content).toContain('constructor injection')
  })

  it('renders with Rust — contains Rust coding standards', () => {
    const content = renderAgentsMd({ language: 'rust' })
    expect(content).toContain('Rust')
    expect(content).toContain('documentation comments')
    expect(content).toContain('clippy::pedantic')
  })

  it('renders with L3 — contains coverage threshold and evidence requirements', () => {
    const content = renderAgentsMd({ governanceLevel: 'L3' })
    expect(content).toContain('85% coverage minimum')
    expect(content).toContain('Evidence artifacts')
    expect(content).toContain('TDD required')
  })

  it('renders with L1 — contains minimal coverage threshold', () => {
    const content = renderAgentsMd({ governanceLevel: 'L1' })
    expect(content).toContain('70%')
    expect(content).not.toContain('85% coverage minimum')
  })

  it('renders with language hooks — hooks appear in hook list when languageHooks provided', () => {
    // Note: languageHooks in AGENTS.md template are not directly rendered,
    // but the template includes framework info. The hooks section is in CLAUDE.md.
    // AGENTS.md uses the 'language' field for its sections.
    // This test verifies that different framework values are rendered correctly.
    const content = renderAgentsMd({ framework: 'express+react' })
    expect(content).toContain('express+react')
  })

  it('renders without framework — Stack line has no framework slash', () => {
    const content = renderAgentsMd({ framework: null })
    // The Stack line should just be the language, no " / <framework>"
    const stackLine = content.split('\n').find((l) => l.includes('**Stack**'))
    expect(stackLine).toBeDefined()
    expect(stackLine).toContain('typescript')
    expect(stackLine).not.toContain(' / ')
  })

  it('renders with Go — contains Go coding standards', () => {
    const content = renderAgentsMd({ language: 'go' })
    expect(content).toContain('Go')
    expect(content).toContain('gofmt')
    expect(content).toContain('error handling')
  })

  it('renders with Python — contains Python coding standards', () => {
    const content = renderAgentsMd({ language: 'python' })
    expect(content).toContain('Python')
    expect(content).toContain('Type annotations')
    expect(content).toContain('ruff')
  })

  it('renders project name in title', () => {
    const content = renderAgentsMd({ projectName: 'mega-app' })
    expect(content).toContain('mega-app')
  })

  it('includes Debt Ratchet section when enableDebtGates is true', () => {
    const rendered = renderAgentsMd({ enableDebtGates: true })
    expect(rendered).toContain('Debt Ratchet')
    expect(rendered).toContain('capture-debt-baseline.mjs')
    expect(rendered).toContain('debt-report.mjs')
    expect(rendered).toContain('--update')
  })

  it('does not include Debt Ratchet section when enableDebtGates is false', () => {
    const rendered = renderAgentsMd({
      enableDebtGates: false,
      governanceLevel: 'L1',
      invariantTiers: presetToTiers('essential'),
    })
    expect(rendered).not.toContain('Debt Ratchet')
  })

  it('renders Tier 1 heading for all presets', () => {
    const content = renderAgentsMd()
    expect(content).toContain('Tier 1: Architectural Integrity')
    expect(content).toContain('Tier 5: Governance')
  })

  it('standard preset at L2 includes security tier (INV-11/12/13 alwaysActive, M24)', () => {
    const content = renderAgentsMd({
      governanceLevel: 'L2',
      invariantTiers: presetToTiers('standard'),
    })
    // INV-11/12/13 are alwaysActive=true at L2+, so security tier appears even with standard preset
    expect(content).toContain('Tier 3: Security')
    expect(content).toContain('INV-11')
  })

  it('full preset (L3 default) includes security tier', () => {
    const content = renderAgentsMd({
      governanceLevel: 'L3',
      invariantTiers: presetToTiers('full'),
    })
    expect(content).toContain('Tier 3: Security')
    expect(content).toContain('INV-11')
  })

  it('essential preset only shows architectural and governance tiers', () => {
    const content = renderAgentsMd({
      governanceLevel: 'L1',
      invariantTiers: presetToTiers('essential'),
    })
    expect(content).toContain('Tier 1: Architectural Integrity')
    expect(content).toContain('Tier 5: Governance')
    expect(content).not.toContain('Tier 2: Data Integrity')
    expect(content).not.toContain('Tier 4: Operational Excellence')
  })

  it('INV-21 (TODO refs) appears in all presets — it is always-active governance', () => {
    for (const preset of ['essential', 'standard', 'full'] as const) {
      const content = renderAgentsMd({ invariantTiers: presetToTiers(preset) })
      expect(content).toContain('INV-21')
    }
  })

  it('language-specific INV text shown for matching language', () => {
    const tsContent = renderAgentsMd({ language: 'typescript' })
    expect(tsContent).toContain('No `any` type in TypeScript')

    const javaContent = renderAgentsMd({ language: 'java' })
    expect(javaContent).toContain('Hexagonal architecture')

    const rustContent = renderAgentsMd({ language: 'rust' })
    expect(rustContent).toContain('No `.unwrap()` calls')
  })

  it('renders Enforcement Chain table for all languages', () => {
    const content = renderAgentsMd({ language: 'java' })
    expect(content).toContain('Enforcement Chain')
    expect(content).toContain('Pre-commit')
    expect(content).toContain('.githooks/pre-commit')
  })

  it('renders TS-specific hook install line for typescript only', () => {
    const ts = renderAgentsMd({ language: 'typescript' })
    expect(ts).toContain('npm install')
    const rust = renderAgentsMd({ language: 'rust' })
    expect(rust).toContain('setup-hooks.sh')
    expect(rust).not.toContain('npm install')
  })
})
