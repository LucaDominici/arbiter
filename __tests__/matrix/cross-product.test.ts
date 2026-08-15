import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig, renderCheckAll } from '../helpers.js'
import type {
  Language,
  GovernanceLevel,
  InvariantTier,
  InvariantPreset,
} from '../../src/wizard/types.js'
import {
  getFilteredInvariants,
  getInvariantsByTier,
  presetToTiers,
} from '../../src/invariants/filter.js'
import { INVARIANT_CATALOG } from '../../src/invariants/catalog.js'
import { computeThresholds } from '../../src/config/thresholds.js'
import { generateGlobalInvariants } from '../../src/generators/global-invariants.js'
import { generateContractTesting } from '../../src/generators/contract-testing.js'
import { generateGithub } from '../../src/generators/github.js'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TIER_LABELS: Record<InvariantTier, string> = {
  architectural: 'Tier 1: Architectural Integrity',
  data: 'Tier 2: Data Integrity',
  security: 'Tier 3: Security & Compliance',
  operational: 'Tier 4: Operational Excellence',
  governance: 'Tier 5: Governance',
}

/**
 * INV-11: Cross-product matrix tests — stack × governance level.
 *
 * Existing tests cover each dimension independently (matrix/ per stack,
 * governance/levels per level, templates/commands per stack or per level).
 * This file covers the cross-product combinations for critical paths where
 * both dimensions interact in template logic.
 *
 * All tests use renderTemplate() — no filesystem setup required.
 */

const LANGUAGES: Language[] = ['typescript', 'java', 'rust', 'go', 'python']
const LEVELS: GovernanceLevel[] = ['L1', 'L2', 'L3', 'L4']

const STACK_CONFIG: Record<Language, Partial<Parameters<typeof makeConfig>[1]>> = {
  typescript: {
    buildTool: 'npm',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --check .',
  },
  java: {
    buildTool: 'gradle',
    buildCommand: './gradlew build',
    testCommand: './gradlew test',
    lintCommand: './gradlew checkstyleMain',
    formatCommand: 'echo ok',
  },
  rust: {
    buildTool: 'cargo',
    buildCommand: 'cargo build',
    testCommand: 'cargo test',
    lintCommand: 'cargo clippy',
    formatCommand: 'cargo fmt --check',
  },
  go: {
    buildTool: 'go',
    buildCommand: 'go build ./...',
    testCommand: 'go test ./...',
    lintCommand: 'golangci-lint run',
    formatCommand: 'gofmt -l .',
  },
  python: {
    buildTool: 'pip',
    buildCommand: 'pip install -e .',
    testCommand: 'pytest',
    lintCommand: 'ruff check .',
    formatCommand: 'black --check .',
  },
  unknown: {},
}

const TEST_COMMANDS: Record<Language, string> = {
  typescript: 'npm test',
  java: './gradlew test',
  rust: 'cargo test',
  go: 'go test ./...',
  python: 'pytest',
  unknown: 'echo',
}

function configFor(lang: Language, level: GovernanceLevel): Record<string, unknown> {
  const config = makeConfig('/tmp/test', {
    language: lang,
    governanceLevel: level,
    ...STACK_CONFIG[lang],
  })
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
  })
  // Pre-compute thresholds — same as generateCheckAll does — so templates
  // that reference coverageEnabled/coverageThreshold always receive these values.
  const thresholds = computeThresholds(0, 'fixed', level)
  return {
    ...(config as unknown as Record<string, unknown>),
    invariants,
    invariantsByTier: getInvariantsByTier(invariants),
    tierLabels: TIER_LABELS,
    coverageEnabled: thresholds.coverageEnabled,
    coverageThreshold: thresholds.coverageThreshold,
    mutationEnabled: thresholds.mutationEnabled,
    mutationThreshold: thresholds.mutationThreshold,
  }
}

// ─── AGENTS.md ────────────────────────────────────────────────────────────────

describe('cross-product: AGENTS.md — governance policy across all stacks', () => {
  const GOVERNANCE_MARKERS: Record<GovernanceLevel, string> = {
    L1: '70%',
    L2: '80% coverage minimum',
    L3: '85% coverage minimum',
    L4: 'Evidence harness',
  }

  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: governance policy marker "${GOVERNANCE_MARKERS[level]}" present`, () => {
        const content = renderTemplate('agents-md/AGENTS.md.ejs', configFor(lang, level))
        expect(content).toContain(GOVERNANCE_MARKERS[level])
      })
    }
  }
})

describe('cross-product: AGENTS.md — language invariants isolated at all governance levels', () => {
  for (const level of LEVELS) {
    it(`java+${level}: hexagonal invariant present; no-any absent`, () => {
      const content = renderTemplate('agents-md/AGENTS.md.ejs', configFor('java', level))
      expect(content).toContain('Hexagonal architecture')
      expect(content).not.toContain('No `any` type')
      expect(content).not.toContain('.unwrap()')
    })

    it(`rust+${level}: no-unwrap invariant present; hexagonal absent`, () => {
      const content = renderTemplate('agents-md/AGENTS.md.ejs', configFor('rust', level))
      expect(content).toContain('No `.unwrap()`')
      expect(content).not.toContain('Hexagonal architecture')
      expect(content).not.toContain('No `any` type')
    })

    it(`go+${level}: Go coding standards present; other stacks absent`, () => {
      const content = renderTemplate('agents-md/AGENTS.md.ejs', configFor('go', level))
      expect(content).toContain('error handling')
      expect(content).toContain('golangci-lint')
      expect(content).not.toContain('Strict mode always on')
      expect(content).not.toContain('Hexagonal architecture')
      expect(content).not.toContain('clippy::pedantic')
      expect(content).not.toContain('No `any` type')
    })

    it(`python+${level}: Python coding standards present; other stacks absent`, () => {
      const content = renderTemplate('agents-md/AGENTS.md.ejs', configFor('python', level))
      expect(content).toContain('Type annotations')
      expect(content).toContain('ruff')
      expect(content).not.toContain('Strict mode always on')
      expect(content).not.toContain('Hexagonal architecture')
      expect(content).not.toContain('clippy::pedantic')
      expect(content).not.toContain('No `any` type')
    })
  }
})

describe('cross-product: AGENTS.md — L3 SSOT invariant across all stacks', () => {
  for (const lang of LANGUAGES) {
    it(`${lang}+L3: SSOT drift invariant present`, () => {
      const content = renderTemplate('agents-md/AGENTS.md.ejs', configFor(lang, 'L3'))
      expect(content).toContain('SSOT documents must not contradict')
    })

    it(`${lang}+L1: SSOT drift invariant absent`, () => {
      const content = renderTemplate('agents-md/AGENTS.md.ejs', configFor(lang, 'L1'))
      expect(content).not.toContain('SSOT documents must not contradict')
    })
  }
})

// ─── ci.yml ───────────────────────────────────────────────────────────────────

describe('cross-product: ci.yml — docs-check job across all stacks', () => {
  function renderCi(lang: Language, level: GovernanceLevel): string {
    return renderTemplate('github/workflows/01-pr-fast.yml.ejs', {
      ...configFor(lang, level),
      useGitHub: true,
    })
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L1: docs-check job absent`, () => {
      const content = renderCi(lang, 'L1')
      expect(content).not.toContain('docs-check:')
      expect(content).not.toContain('docs-check')
    })

    it(`${lang}+L2: docs-check job present`, () => {
      const content = renderCi(lang, 'L2')
      expect(content).toContain('docs-check:')
    })

    it(`${lang}+L3: docs-check job present`, () => {
      const content = renderCi(lang, 'L3')
      expect(content).toContain('docs-check:')
    })
  }
})

describe('cross-product: frontend-quality emission', () => {
  it('python frontend-spa does not emit a root npm frontend workflow', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-cross-product-frontend-'))
    try {
      generateGithub(
        makeConfig(dir, {
          language: 'python',
          buildTool: 'pip',
          collaborationMode: 'peer-review',
          governanceLevel: 'L2',
          archetype: 'frontend-spa',
        }),
      )
      expect(existsSync(join(dir, '.github', 'workflows', '16-frontend-quality.yml'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('cross-product: ci.yml — language setup step across all governance levels', () => {
  function renderCi(lang: Language, level: GovernanceLevel): string {
    return renderTemplate('github/workflows/01-pr-fast.yml.ejs', {
      ...configFor(lang, level),
      useGitHub: true,
    })
  }

  for (const level of LEVELS) {
    it(`typescript+${level}: contains setup-node`, () => {
      expect(renderCi('typescript', level)).toContain('setup-node')
    })

    it(`java+${level}: contains setup-java`, () => {
      expect(renderCi('java', level)).toContain('setup-java')
    })

    it(`rust+${level}: contains rust-toolchain`, () => {
      expect(renderCi('rust', level)).toContain('rust-toolchain')
    })

    it(`go+${level}: contains setup-go`, () => {
      const content = renderCi('go', level)
      expect(content).toContain('setup-go')
      // L2+ security-early-fail job + L3 classify-changes both add setup-node
      if (level === 'L1') expect(content).not.toContain('setup-node')
      expect(content).not.toContain('setup-java')
      expect(content).not.toContain('rust-toolchain')
    })

    it(`python+${level}: contains setup-python`, () => {
      const content = renderCi('python', level)
      expect(content).toContain('setup-python')
      // L2+ security-early-fail job + L3 classify-changes both add setup-node
      if (level === 'L1') expect(content).not.toContain('setup-node')
      expect(content).not.toContain('setup-java')
      expect(content).not.toContain('rust-toolchain')
    })
  }
})

// ─── check-all.mjs ────────────────────────────────────────────────────────────

describe('cross-product: check-all.mjs — language check commands', () => {
  // The check-all.mjs template branches on language only; governanceLevel is
  // not an EJS conditional (the L1/L2 distinction is a runtime argument).
  // These tests verify the correct per-language check commands are rendered.

  it('typescript: contains eslint, prettier, npm test, and npm audit', () => {
    const content = renderCheckAll(configFor('typescript', 'L2'))
    expect(content).toContain('eslint')
    expect(content).toContain('prettier')
    expect(content).toContain("'npm'")
    expect(content).toContain('audit')
  })

  it('java: contains checkstyleMain, gradlew test, and integrationTest (hasDatabase=true)', () => {
    const content = renderCheckAll({
      ...configFor('java', 'L2'),
      hasDatabase: true,
    })
    expect(content).toContain('checkstyleMain')
    expect(content).toContain('gradlew')
    expect(content).toContain('integrationTest')
  })

  it('rust: contains cargo fmt, clippy, cargo test, and cargo audit', () => {
    const content = renderCheckAll(configFor('rust', 'L2'))
    expect(content).toContain('clippy')
    expect(content).toContain('fmt')
    expect(content).toContain("'cargo'")
    expect(content).toContain('audit')
  })

  it('go: contains go vet, golangci-lint, go test, and staticcheck', () => {
    const content = renderCheckAll(configFor('go', 'L2'))
    expect(content).toContain('vet')
    expect(content).toContain('golangci-lint')
    expect(content).toContain("'go'")
    expect(content).toContain('staticcheck')
    expect(content).not.toContain('eslint')
    expect(content).not.toContain('checkstyleMain')
    expect(content).not.toContain('clippy')
  })

  it('python: contains ruff check, ruff format, pytest, and pip-audit', () => {
    const content = renderCheckAll(configFor('python', 'L2'))
    expect(content).toContain('ruff')
    expect(content).toContain('pytest')
    expect(content).toContain('pip-audit')
    expect(content).not.toContain('eslint')
    expect(content).not.toContain('checkstyleMain')
    expect(content).not.toContain('clippy')
  })
})

// ─── Java Maven variant ───────────────────────────────────────────────────────

describe('cross-product: ci.yml — Java Maven variant', () => {
  function renderCiMaven(level: GovernanceLevel): string {
    return renderTemplate('github/workflows/01-pr-fast.yml.ejs', {
      ...configFor('java', level),
      buildTool: 'maven',
      useGitHub: true,
    })
  }

  for (const level of LEVELS) {
    it(`java-maven+${level}: contains mvn; no gradlew; retains setup-java`, () => {
      const content = renderCiMaven(level)
      expect(content).toContain('mvn')
      expect(content).toContain('setup-java')
      expect(content).not.toContain('gradlew')
      expect(content).not.toContain('setup-gradle')
    })

    // #1226: CANON-18 actionlint coverage for build-reactor job block
    it(`java-maven+${level}: build-reactor job present (CANON-18, #1226)`, () => {
      const content = renderCiMaven(level)
      expect(content).toContain('build-reactor:')
    })

    it(`java-maven+${level}: uses setup-java-maven composite, not inline setup-java SHA (#1226)`, () => {
      const content = renderCiMaven(level)
      expect(content).toContain('uses: ./.github/actions/setup-java-maven')
      expect(content).not.toContain('actions/setup-java@c1e323688fd81a25caa38c78aa6df2d33d3e20d9')
    })
  }
})

// ─── Debt Gates ───────────────────────────────────────────────────────────────

describe('cross-product: check-all.mjs — debt gate checks at L2+, absent at L1', () => {
  const DEBT_GATE_MARKERS: Record<Language, string> = {
    typescript: 'knip',
    rust: 'tarpaulin',
    java: 'jacocoTestCoverageVerification',
    go: 'gocyclo',
    python: 'cov-fail-under',
    unknown: '',
  }

  for (const lang of LANGUAGES.filter((l) => l !== 'unknown')) {
    it(`${lang}+L2: debt gate marker "${DEBT_GATE_MARKERS[lang]}" present`, () => {
      const content = renderCheckAll({
        ...configFor(lang, 'L2'),
        enableDebtGates: true,
      })
      expect(content).toContain(DEBT_GATE_MARKERS[lang])
    })

    it(`${lang}+L3: debt gate marker "${DEBT_GATE_MARKERS[lang]}" present`, () => {
      const content = renderCheckAll({
        ...configFor(lang, 'L3'),
        enableDebtGates: true,
      })
      expect(content).toContain(DEBT_GATE_MARKERS[lang])
    })

    it(`${lang}+L1: debt gate absent when disabled`, () => {
      const content = renderCheckAll({
        ...configFor(lang, 'L1'),
        enableDebtGates: false,
      })
      expect(content).not.toContain(DEBT_GATE_MARKERS[lang])
    })
  }
})

describe('cross-product: check-all.mjs — coverage threshold values at L2 vs L3', () => {
  for (const lang of ['typescript', 'rust', 'python'] as Language[]) {
    it(`${lang}+L2: coverage threshold is 80`, () => {
      const content = renderCheckAll({
        ...configFor(lang, 'L2'),
        enableDebtGates: true,
      })
      expect(content).toContain('80')
    })

    it(`${lang}+L3: coverage threshold is 85`, () => {
      const content = renderCheckAll({
        ...configFor(lang, 'L3'),
        enableDebtGates: true,
      })
      expect(content).toContain('85')
    })
  }
})

describe('cross-product: ci.yml — debt-gates job at L2+, absent at L1', () => {
  function renderCi(lang: Language, level: GovernanceLevel, enableDebtGates: boolean): string {
    return renderTemplate('github/workflows/01-pr-fast.yml.ejs', {
      ...configFor(lang, level),
      useGitHub: true,
      enableDebtGates,
    })
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L2: debt-gates job present`, () => {
      const content = renderCi(lang, 'L2', true)
      expect(content).toContain('debt-gates:')
    })

    it(`${lang}+L3: debt-gates job present`, () => {
      const content = renderCi(lang, 'L3', true)
      expect(content).toContain('debt-gates:')
    })

    it(`${lang}+L1: debt-gates job absent`, () => {
      const content = renderCi(lang, 'L1', false)
      expect(content).not.toContain('debt-gates:')
    })
  }
})

describe('cross-product: AGENTS.md — tech debt section at L2+, absent at L1', () => {
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: Tech Debt Gates section present`, () => {
      const content = renderTemplate('agents-md/AGENTS.md.ejs', {
        ...configFor(lang, 'L2'),
        enableDebtGates: true,
      })
      expect(content).toContain('Tech Debt Gates')
    })

    it(`${lang}+L3: Tech Debt Gates section present`, () => {
      const content = renderTemplate('agents-md/AGENTS.md.ejs', {
        ...configFor(lang, 'L3'),
        enableDebtGates: true,
      })
      expect(content).toContain('Tech Debt Gates')
    })

    it(`${lang}+L1: Tech Debt Gates section absent`, () => {
      const content = renderTemplate('agents-md/AGENTS.md.ejs', {
        ...configFor(lang, 'L1'),
        enableDebtGates: false,
      })
      expect(content).not.toContain('Tech Debt Gates')
    })
  }
})

// ─── Claude commands ──────────────────────────────────────────────────────────
// #1216: /ship is the orchestration entrypoint; /task is the engine/CLI ref.
// testCommand, tier classification, and verification live in ship.md (not task.md).

describe('cross-product: ship.md — testCommand in output for all stack × level combinations (#1216)', () => {
  function renderShip(lang: Language, level: GovernanceLevel): string {
    return renderTemplate('claude/commands/ship.md.ejs', configFor(lang, level))
  }

  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: testCommand "${TEST_COMMANDS[lang]}" appears in output`, () => {
        expect(renderShip(lang, level)).toContain(TEST_COMMANDS[lang])
      })
    }
  }
})

describe('cross-product: ship.md — governance structure across all stacks (#1216)', () => {
  function renderShip(lang: Language, level: GovernanceLevel): string {
    return renderTemplate('claude/commands/ship.md.ejs', configFor(lang, level))
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L1: no tier classification note at L1`, () => {
      const content = renderShip(lang, 'L1')
      expect(content).not.toMatch(/The tier \(XS \/ S \/ Standard\) sets/)
    })

    it(`${lang}+L2: tier classification note present`, () => {
      const content = renderShip(lang, 'L2')
      expect(content).toMatch(/XS|Standard/)
    })

    it(`${lang}+L3: tier classification and evidence present`, () => {
      const content = renderShip(lang, 'L3')
      expect(content).toMatch(/XS|Standard/)
      expect(content).toMatch(/verif|evidence/i)
    })
  }
})

describe('cross-product: ship.md — testCommand and verification across all stacks (#1216)', () => {
  function renderShip(lang: Language, level: GovernanceLevel): string {
    return renderTemplate('claude/commands/ship.md.ejs', configFor(lang, level))
  }

  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: testCommand "${TEST_COMMANDS[lang]}" in verification row`, () => {
        expect(renderShip(lang, level)).toContain(TEST_COMMANDS[lang])
      })
    }
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L2: evidence section present`, () => {
      const content = renderShip(lang, 'L2')
      expect(content).toMatch(/evidence/i)
    })

    it(`${lang}+L1: no red-team dispatch section`, () => {
      const content = renderShip(lang, 'L1')
      expect(content).not.toMatch(/RedTeamEvidenceV1/)
    })
  }
})

// ─── Debt Ratchet ─────────────────────────────────────────────────────────────

describe('cross-product: check-all.mjs — debt ratchet gate at L2+, absent at L1', () => {
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: debt-report.mjs present with --gate`, () => {
      const content = renderCheckAll({
        ...configFor(lang, 'L2'),
        enableDebtGates: true,
      })
      expect(content).toContain('debt-report.mjs')
      expect(content).toContain('--gate')
    })

    it(`${lang}+L3: debt-report.mjs present with --require-improvement`, () => {
      const content = renderCheckAll({
        ...configFor(lang, 'L3'),
        enableDebtGates: true,
      })
      expect(content).toContain('debt-report.mjs')
      expect(content).toContain('--require-improvement')
    })

    it(`${lang}+L1: debt-report.mjs absent`, () => {
      const content = renderCheckAll({
        ...configFor(lang, 'L1'),
        enableDebtGates: false,
      })
      expect(content).not.toContain('debt-report.mjs')
    })
  }
})

describe('cross-product: ci.yml — debt-ratchet job at L2+, absent at L1', () => {
  function renderCi(lang: Language, level: GovernanceLevel, enableDebtGates: boolean): string {
    return renderTemplate('github/workflows/01-pr-fast.yml.ejs', {
      ...configFor(lang, level),
      useGitHub: true,
      enableDebtGates,
    })
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L2: debt-ratchet job present`, () => {
      const content = renderCi(lang, 'L2', true)
      expect(content).toContain('debt-ratchet:')
    })

    it(`${lang}+L3: debt-ratchet job present with --require-improvement`, () => {
      const content = renderCi(lang, 'L3', true)
      expect(content).toContain('debt-ratchet:')
      expect(content).toContain('--require-improvement')
    })

    it(`${lang}+L1: debt-ratchet job absent`, () => {
      const content = renderCi(lang, 'L1', false)
      expect(content).not.toContain('debt-ratchet:')
    })
  }
})

describe('cross-product: AGENTS.md — Debt Ratchet section at L2+, absent at L1', () => {
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: Debt Ratchet section present`, () => {
      const content = renderTemplate('agents-md/AGENTS.md.ejs', {
        ...configFor(lang, 'L2'),
        enableDebtGates: true,
      })
      expect(content).toContain('Debt Ratchet')
      expect(content).toContain('capture-debt-baseline.mjs')
    })

    it(`${lang}+L3: Debt Ratchet section present`, () => {
      const content = renderTemplate('agents-md/AGENTS.md.ejs', {
        ...configFor(lang, 'L3'),
        enableDebtGates: true,
      })
      expect(content).toContain('Debt Ratchet')
    })

    it(`${lang}+L1: Debt Ratchet section absent`, () => {
      const content = renderTemplate('agents-md/AGENTS.md.ejs', {
        ...configFor(lang, 'L1'),
        enableDebtGates: false,
      })
      expect(content).not.toContain('Debt Ratchet')
      expect(content).not.toContain('capture-debt-baseline.mjs')
    })
  }
})

// ─── Advanced Hooks (M17) ─────────────────────────────────────────────────────

// ─── #1318.3: `bun run arbiter` permission gated on buildTool === 'bun' ────────
describe('cross-product: settings.json — bun-only "bun run arbiter" permission (#1318.3)', () => {
  // npm/cargo/maven/pip/go and any non-bun buildTool must NOT emit the
  // `Bash(bun run arbiter *)` allow entry; only an actual bun project keeps it.
  // The generic `Bash(arbiter *)` entry always covers the non-bun case.
  for (const lang of LANGUAGES) {
    it(`${lang}: omits "bun run arbiter" allow entry`, () => {
      const rendered = renderTemplate('claude/settings.json.ejs', configFor(lang, 'L2'))
      const json = JSON.parse(rendered) as { permissions: { allow: string[] } }
      expect(json.permissions.allow).not.toContain('Bash(bun run arbiter *)')
      // generic arbiter entry still present for every stack
      expect(json.permissions.allow).toContain('Bash(arbiter *)')
    })
  }

  it('bun project keeps the "bun run arbiter" allow entry', () => {
    const ctx = { ...configFor('typescript', 'L2'), buildTool: 'bun' }
    const rendered = renderTemplate('claude/settings.json.ejs', ctx)
    const json = JSON.parse(rendered) as { permissions: { allow: string[] } }
    expect(json.permissions.allow).toContain('Bash(bun run arbiter *)')
    expect(json.permissions.allow).toContain('Bash(arbiter *)')
  })
})

describe('cross-product: settings.json — advanced hooks governance gating', () => {
  function renderSettings(lang: Language, level: GovernanceLevel): Record<string, unknown> {
    const rendered = renderTemplate('claude/settings.json.ejs', configFor(lang, level))
    return JSON.parse(rendered) as Record<string, unknown>
  }

  // PreCompact present at all levels for all stacks
  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: PreCompact block present`, () => {
        const json = renderSettings(lang, level)
        const hooks = json['hooks'] as Record<string, unknown>
        expect(hooks).toHaveProperty('PreCompact')
      })
    }
  }

  // UserPromptSubmit: L2+ only
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: UserPromptSubmit block present`, () => {
      const json = renderSettings(lang, 'L2')
      const hooks = json['hooks'] as Record<string, unknown>
      expect(hooks).toHaveProperty('UserPromptSubmit')
    })

    it(`${lang}+L3: UserPromptSubmit block present`, () => {
      const json = renderSettings(lang, 'L3')
      const hooks = json['hooks'] as Record<string, unknown>
      expect(hooks).toHaveProperty('UserPromptSubmit')
    })

    it(`${lang}+L1: UserPromptSubmit block absent`, () => {
      const json = renderSettings(lang, 'L1')
      const hooks = json['hooks'] as Record<string, unknown>
      expect(hooks).not.toHaveProperty('UserPromptSubmit')
    })
  }

  // pre-edit-plan-anchor in PreToolUse at all levels — via dispatcher (#248)
  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: pre-edit-plan-anchor.mjs in PreToolUse`, () => {
        // settings.json uses dispatcher; hook name lives in hooks.mjs.ejs config table
        const settingsRendered = renderTemplate('claude/settings.json.ejs', configFor(lang, level))
        expect(settingsRendered).toContain("hooks.mjs 'PreToolUse:Edit|Write'")
        const dispatcherRendered = renderTemplate(
          'claude/hooks/hooks.mjs.ejs',
          configFor(lang, level),
        )
        expect(dispatcherRendered).toContain('pre-edit-plan-anchor.mjs')
      })
    }
  }

  // post-edit-dispatch: L2+ only — via dispatcher (#248)
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: post-edit-dispatch.mjs in PostToolUse`, () => {
      const dispatcherRendered = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor(lang, 'L2'))
      expect(dispatcherRendered).toContain('post-edit-dispatch.mjs')
    })

    it(`${lang}+L1: post-edit-dispatch.mjs absent`, () => {
      const dispatcherRendered = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor(lang, 'L1'))
      expect(dispatcherRendered).not.toContain('post-edit-dispatch.mjs')
    })
  }

  // debug-state-on-failure: L2+ only — via dispatcher (#248)
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: debug-state-on-failure.mjs present`, () => {
      const dispatcherRendered = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor(lang, 'L2'))
      expect(dispatcherRendered).toContain('debug-state-on-failure.mjs')
    })

    it(`${lang}+L1: debug-state-on-failure.mjs absent`, () => {
      const dispatcherRendered = renderTemplate('claude/hooks/hooks.mjs.ejs', configFor(lang, 'L1'))
      expect(dispatcherRendered).not.toContain('debug-state-on-failure.mjs')
    })
  }

  // settings.json must be valid JSON for all combinations
  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: settings.json is valid JSON`, () => {
        expect(() => renderSettings(lang, level)).not.toThrow()
      })
    }
  }
})

// ─── task engine subcommand ref (M17) ────────────────────────────────────────
// #1216: task.md is now the engine/CLI reference (all governance levels).
// arbiter task advance appears in the subcommand reference table for all levels.

describe('cross-product: task.md — engine subcommand reference (#1216)', () => {
  function renderTask(lang: Language, level: GovernanceLevel): string {
    return renderTemplate('claude/commands/task.md.ejs', configFor(lang, level))
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L2: contains arbiter task advance (engine subcommand)`, () => {
      expect(renderTask(lang, 'L2')).toContain('arbiter task advance')
    })

    it(`${lang}+L3: contains arbiter task advance (engine subcommand)`, () => {
      expect(renderTask(lang, 'L3')).toContain('arbiter task advance')
    })

    it(`${lang}+L1: task.md has engine subcommand reference (arbiter task advance)`, () => {
      // #1216: engine-ref is governance-level-agnostic; all levels have the subcommand table
      expect(renderTask(lang, 'L1')).toContain('arbiter task advance')
    })
  }
})

// ─── PRESET × LANG MATRIX ─────────────────────────────────────────────────────

const PRESETS: InvariantPreset[] = ['essential', 'standard', 'full']

const PRESET_EXPECTED_TIERS: Record<InvariantPreset, InvariantTier[]> = {
  essential: ['architectural', 'governance'],
  standard: ['architectural', 'governance', 'data', 'operational'],
  full: ['architectural', 'governance', 'data', 'security', 'operational'],
}

// INV-11/12/13 are alwaysActive=true at L2+ (M24), so "Tier 3: Security" appears
// in AGENTS.md for all presets at L2+ regardless of tier selection.
const ABSENT_TIERS: Record<InvariantPreset, string[]> = {
  essential: ['Tier 2: Data Integrity', 'Tier 4: Operational'],
  standard: [],
  full: [],
}

function configForPreset(
  lang: Language,
  level: GovernanceLevel,
  preset: InvariantPreset,
): Record<string, unknown> {
  const config = makeConfig('/tmp/test', {
    language: lang,
    governanceLevel: level,
    invariantTiers: presetToTiers(preset),
    ...STACK_CONFIG[lang],
  })
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
  })
  return {
    ...(config as unknown as Record<string, unknown>),
    invariants,
    invariantsByTier: getInvariantsByTier(invariants),
    tierLabels: TIER_LABELS,
  }
}

describe('cross-product: AGENTS.md — tier headings by preset across all stacks', () => {
  for (const lang of LANGUAGES) {
    for (const preset of PRESETS) {
      const expectedTiers = PRESET_EXPECTED_TIERS[preset]
      const absentTierLabels = ABSENT_TIERS[preset]

      it(`${lang}+${preset}: expected tiers present`, () => {
        const content = renderTemplate(
          'agents-md/AGENTS.md.ejs',
          configForPreset(lang, 'L2', preset),
        )
        for (const tier of expectedTiers) {
          expect(content).toContain(TIER_LABELS[tier])
        }
      })

      if (absentTierLabels.length > 0) {
        it(`${lang}+${preset}: excluded tiers absent`, () => {
          const content = renderTemplate(
            'agents-md/AGENTS.md.ejs',
            configForPreset(lang, 'L2', preset),
          )
          for (const label of absentTierLabels) {
            expect(content).not.toContain(label)
          }
        })
      }
    }
  }
})

describe('cross-product: AGENTS.md — always-active invariants present in all presets', () => {
  for (const lang of LANGUAGES) {
    it(`${lang}: INV-21 (orphan-todo guard) present in all presets`, () => {
      for (const preset of PRESETS) {
        const content = renderTemplate(
          'agents-md/AGENTS.md.ejs',
          configForPreset(lang, 'L2', preset),
        )
        expect(content).toContain('INV-21')
      }
    })

    it(`${lang}: INV-01 (circular deps) present in all presets`, () => {
      for (const preset of PRESETS) {
        const content = renderTemplate(
          'agents-md/AGENTS.md.ejs',
          configForPreset(lang, 'L2', preset),
        )
        expect(content).toContain('INV-01')
      }
    })
  }
})

// ─── Suppressions ─────────────────────────────────────────────────────────────

describe('cross-product: check-all.mjs — suppressions expiry check at all governance levels', () => {
  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: suppressions expiry check present when enableSuppressions=true`, () => {
        const content = renderCheckAll({
          ...configFor(lang, level),
          enableSuppressions: true,
        })
        expect(content).toContain('check-suppressions.mjs')
        expect(content).toContain('suppressions expiry')
      })

      it(`${lang}+${level}: suppressions expiry check absent when enableSuppressions=false`, () => {
        const content = renderCheckAll({
          ...configFor(lang, level),
          enableSuppressions: false,
        })
        expect(content).not.toContain('check-suppressions.mjs')
      })
    }
  }
})

describe('cross-product: GLOBAL_INVARIANTS.md — generation by preset', () => {
  let dir: string

  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-cp-global-'))
    return dir
  }
  const cleanup = (d: string) => rmSync(d, { recursive: true, force: true })

  for (const lang of LANGUAGES) {
    it(`${lang}+essential: GLOBAL_INVARIANTS.md skipped`, () => {
      const d = setup()
      try {
        const config = makeConfig(d, {
          language: lang,
          governanceLevel: 'L1',
          invariantTiers: presetToTiers('essential'),
          ...STACK_CONFIG[lang],
        })
        const result = generateGlobalInvariants(config)
        expect(result.action).toBe('skipped')
        expect(existsSync(join(d, 'GLOBAL_INVARIANTS.md'))).toBe(false)
      } finally {
        cleanup(d)
      }
    })

    it(`${lang}+standard: GLOBAL_INVARIANTS.md created with data/operational tiers`, () => {
      const d = setup()
      try {
        const config = makeConfig(d, {
          language: lang,
          governanceLevel: 'L2',
          invariantTiers: presetToTiers('standard'),
          ...STACK_CONFIG[lang],
        })
        const result = generateGlobalInvariants(config)
        expect(result.action).toBe('created')
        const content = readFileSync(join(d, 'GLOBAL_INVARIANTS.md'), 'utf-8')
        expect(content).toContain('Tier 2: Data Integrity')
        expect(content).toContain('Tier 4: Operational Excellence')
        // INV-11/12/13 are alwaysActive=true at L2+ (M24), security tier appears regardless of preset
        expect(content).toContain('Tier 3: Security')
        // #1635: INV-14/15 alwaysActive security invariants present at L2 standard
        expect(content).toContain('INV-14')
        expect(content).toContain('INV-15')
        // #1635: INV-44 is Java-only — alwaysActive bypasses tier but NOT the language filter
        if (lang === 'java') {
          expect(content).toContain('INV-44')
        } else {
          expect(content).not.toContain('INV-44')
        }
      } finally {
        cleanup(d)
      }
    })

    it(`${lang}+full: GLOBAL_INVARIANTS.md includes all 5 tiers`, () => {
      const d = setup()
      try {
        const config = makeConfig(d, {
          language: lang,
          governanceLevel: 'L3',
          invariantTiers: presetToTiers('full'),
          ...STACK_CONFIG[lang],
        })
        generateGlobalInvariants(config)
        const content = readFileSync(join(d, 'GLOBAL_INVARIANTS.md'), 'utf-8')
        expect(content).toContain('Tier 3: Security & Compliance')
        expect(content).toContain('INV-11')
      } finally {
        cleanup(d)
      }
    })
  }
})

// ─── M24: Security scanning cross-product ─────────────────────────────────────

// New M24 dep-audit additions per stack (TS/Rust/Python already had audit steps pre-M24)
// java: trivy fs replaces OWASP Dependency-Check (ADR-104)
const DEP_AUDIT_MARKERS: Partial<Record<Language, string>> = {
  java: "'dep audit (trivy fs)'",
  typescript: 'audit-level=high',
  rust: "'cargo', ['audit']",
  go: 'govulncheck',
  python: 'pip-audit',
}

describe('cross-product: check-all.mjs — security scanning (M24)', () => {
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: pii-scan runs before L2 block`, () => {
      const thresholds = computeThresholds(0, 'fixed', 'L2')
      const cfg = {
        ...configFor(lang, 'L2'),
        enableSecurityScanning: true,
        coverageEnabled: thresholds.coverageEnabled,
        coverageThreshold: thresholds.coverageThreshold,
        mutationEnabled: thresholds.mutationEnabled,
      }
      const content = renderCheckAll(cfg)
      const piiIdx = content.indexOf('pii-scan.mjs')
      const l2BlockIdx = content.indexOf("if (level !== 'L1')")
      expect(piiIdx).toBeGreaterThan(-1)
      expect(l2BlockIdx).toBeGreaterThan(-1)
      expect(piiIdx).toBeLessThan(l2BlockIdx)
    })

    it(`${lang}+L2: gitleaks step present in L2 block`, () => {
      const thresholds = computeThresholds(0, 'fixed', 'L2')
      const cfg = {
        ...configFor(lang, 'L2'),
        enableSecurityScanning: true,
        coverageEnabled: thresholds.coverageEnabled,
        coverageThreshold: thresholds.coverageThreshold,
        mutationEnabled: thresholds.mutationEnabled,
      }
      const content = renderCheckAll(cfg)
      const l2BlockIdx = content.indexOf("if (level === 'L2')")
      expect(content.indexOf('gitleaks', l2BlockIdx)).toBeGreaterThan(l2BlockIdx)
    })

    it(`${lang}+L2: dep-audit step present in L2 block`, () => {
      const thresholds = computeThresholds(0, 'fixed', 'L2')
      const cfg = {
        ...configFor(lang, 'L2'),
        enableSecurityScanning: true,
        coverageEnabled: thresholds.coverageEnabled,
        coverageThreshold: thresholds.coverageThreshold,
        mutationEnabled: thresholds.mutationEnabled,
      }
      const content = renderCheckAll(cfg)
      const marker = DEP_AUDIT_MARKERS[lang]
      if (marker) {
        const l2BlockIdx = content.indexOf("if (level === 'L2')")
        expect(content.indexOf(marker, l2BlockIdx)).toBeGreaterThan(l2BlockIdx)
      }
    })

    it(`${lang}+L1: PII baseline runs without gitleaks or dep-audit`, () => {
      const thresholds = computeThresholds(0, 'fixed', 'L1')
      const cfg = {
        ...configFor(lang, 'L1'),
        enableSecurityScanning: false,
        coverageEnabled: thresholds.coverageEnabled,
        coverageThreshold: thresholds.coverageThreshold,
        mutationEnabled: thresholds.mutationEnabled,
      }
      const content = renderCheckAll(cfg)
      expect(content).not.toContain('gitleaks')
      expect(content).not.toContain('govulncheck')
      expect(content).not.toContain("'dep audit (trivy fs)'")
      expect(content).toContain('pii-scan.mjs')
    })
  }
})

// ── #2268: the emitted dep-audit must run the command the emitted docs promise ──
// a2c14cd6 ("scope npm audit to production deps (--omit=dev) [INV-13]") moved the
// self gate, the emitted CI workflow, the emitted AGENTS table and the emitted
// secure-coding checklist together — but MISSED scripts/check-all.mjs.ejs, the
// generated project's OWN L2 gate. That gate therefore audits the full DEV tree
// while the AGENTS.md shipped beside it documents prod scope, so any transitive
// devDep advisory reds a generated project's gate the day the live npm advisory
// DB moves, with no source change (the ts-library virgin-init cell's flake).
describe('cross-product: dep-audit scope — emitted gate vs emitted docs (#2268)', () => {
  const AUDIT_ARGV_RE = /runCheck\('audit', 'npm', \[([^\]]*)\]/
  const DOCUMENTED_RE = /`(npm audit --[^`]+)`/

  function tsSecurityConfig(): Record<string, unknown> {
    const thresholds = computeThresholds(0, 'fixed', 'L2')
    return {
      ...configFor('typescript', 'L2'),
      enableSecurityScanning: true,
      coverageEnabled: thresholds.coverageEnabled,
      coverageThreshold: thresholds.coverageThreshold,
      mutationEnabled: thresholds.mutationEnabled,
    }
  }

  it('typescript+L2: check-all.mjs audit argv equals the AGENTS.md dep-audit trigger', () => {
    const cfg = tsSecurityConfig()
    const documented = DOCUMENTED_RE.exec(renderTemplate('agents-md/AGENTS.md.ejs', cfg))?.[1]
    expect(documented, 'AGENTS.md must document a concrete npm audit command').toBe(
      'npm audit --omit=dev --audit-level=high',
    )
    const argv = AUDIT_ARGV_RE.exec(renderCheckAll(cfg))?.[1]
    expect(argv, 'check-all.mjs must emit a runCheck(\'audit\', \'npm\', [...]) step').toBeDefined()
    const emitted = ['npm', ...(argv ?? '').split(',').map((a) => a.trim().replace(/'/g, ''))]
    expect(emitted.join(' ')).toBe(documented)
  })

  it('typescript+L2: INV-13 enforcement text names the same prod-scoped command', () => {
    const inv13 = INVARIANT_CATALOG.find((i) => i.id === 'INV-13')
    expect(inv13?.enforcement).toContain('npm audit --omit=dev --audit-level=high')
  })
})

// ── #347: mutation gate wired into check-all.mjs L2 for PROVEN cells only ────
// Proven (matrix): typescript (stryker), java (pitest).
// Beta/unsafe (NOT wired in check-all): rust (cargo-mutants), python (mutmut), go (go-mutesting).

describe('cross-product: check-all.mjs — mutation gate (proven=wired, beta/unsafe=not wired) (#347)', () => {
  const NOT_WIRED_MARKERS: Partial<Record<Language, string>> = {
    rust: 'mutants',
    python: 'mutmut',
  }

  for (const [lang, marker] of Object.entries(NOT_WIRED_MARKERS) as [Language, string][]) {
    it(`${lang}+L3: check-all.mjs does NOT contain "${marker}" (beta tool, not wired per CANON-02)`, () => {
      const content = renderCheckAll({
        ...configFor(lang, 'L3'),
        enableDebtGates: true,
      })
      expect(content).not.toContain(marker)
    })

    it(`${lang}+L2: check-all.mjs does NOT contain "${marker}"`, () => {
      const content = renderCheckAll({
        ...configFor(lang, 'L2'),
        enableDebtGates: true,
      })
      expect(content).not.toContain(marker)
    })
  }
})

// ── M25 (deprecated 2026-05-18): generateNightly removed in #867 C3.
// The legacy nightly pipeline (nightly.yml) is superseded by the 8-tier model:
// 06-nightly.yml.ejs (T4 — generic) + 08-monthly.yml.ejs (T5b — long-horizon)
// cover the cross-product mutation/CVE/fuzz/SBOM responsibilities. Coverage for
// 06-nightly.yml.ejs lives in __tests__/templates/06-nightly-render.test.ts;
// generator-level coverage in __tests__/matrix/github-setup-combinations.test.ts.

// ─── M26: Integration testing — hasDatabase gate ──────────────────────────────

describe('cross-product: check-all.mjs — integration test step (M26, hasDatabase gate)', () => {
  // Markers that should appear in rendered check-all.mjs for each language
  // when hasDatabase=true at L2+, and be ABSENT when hasDatabase=false or at L1.
  //
  // java: `integrationTest` is currently rendered unconditionally in the Java branch
  // (no hasDatabase guard yet). After Task 5 (M26) wraps it with
  // `<% if (hasDatabase) %>`, the negative tests (hasDatabase=false) will go GREEN.
  // Until then, the negative tests correctly FAIL in RED.
  //
  // For L1, the check-all.mjs.ejs uses EJS-time `<% if (governanceLevel !== 'L1') %>`
  // guards (to be added in Task 5). Until then, the L1-absent tests correctly FAIL.
  const INTEGRATION_MARKERS: Record<Language, string> = {
    typescript: 'db integration tests', // hasDatabase-gated block (#219: test:integration is always present)
    java: 'integrationTest',
    rust: 'integration',
    go: 'integration',
    python: 'tests/integration',
    unknown: '',
  }

  for (const lang of LANGUAGES) {
    for (const level of ['L2', 'L3'] as GovernanceLevel[]) {
      it(`${lang}+${level}+hasDatabase=true: integration marker present`, () => {
        const marker = INTEGRATION_MARKERS[lang]
        if (!marker) return
        const content = renderCheckAll({
          ...configFor(lang, level),
          hasDatabase: true,
        })
        expect(content).toContain(marker)
      })
    }

    it(`${lang}+L1+hasDatabase=true: integration marker absent (L1 excluded)`, () => {
      const marker = INTEGRATION_MARKERS[lang]
      if (!marker) return
      const content = renderCheckAll({
        ...configFor(lang, 'L1'),
        hasDatabase: true,
      })
      expect(content).not.toContain(marker)
    })

    it(`${lang}+L2+hasDatabase=false: integration marker absent`, () => {
      const marker = INTEGRATION_MARKERS[lang]
      if (!marker) return
      const content = renderCheckAll({
        ...configFor(lang, 'L2'),
        hasDatabase: false,
      })
      expect(content).not.toContain(marker)
    })
  }
})

// ─── M27: Behavioral tests — TESTING_POLICY.md.ejs (5 stacks × 3 levels) ────

describe('cross-product: TESTING_POLICY.md — renders for all stacks and levels (INV-11)', () => {
  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: renders without error and contains naming section`, () => {
        const content = renderTemplate(
          'behavioral-tests/TESTING_POLICY.md.ejs',
          configFor(lang, level),
        )
        expect(content.toLowerCase()).toContain('naming')
        expect(content.toLowerCase()).toContain('mock')
      })
    }
  }

  it('L2+: E2E policy section present', () => {
    const content = renderTemplate(
      'behavioral-tests/TESTING_POLICY.md.ejs',
      configFor('typescript', 'L2'),
    )
    expect(content.toLowerCase()).toContain('e2e')
  })

  it('L1: E2E policy section absent', () => {
    const content = renderTemplate(
      'behavioral-tests/TESTING_POLICY.md.ejs',
      configFor('typescript', 'L1'),
    )
    expect(content.toLowerCase()).not.toContain('e2e policy')
  })
})

// ─── M27: check-test-naming.mjs.ejs — naming patterns per stack (5 stacks × 3 levels) ─

describe('cross-product: check-test-naming.mjs — correct patterns per stack (INV-11)', () => {
  const NAMING_PATTERNS: Record<Language, string> = {
    typescript: '.test.ts',
    java: 'Test.java',
    rust: '_test.rs',
    go: '_test.go',
    python: 'test_',
    unknown: '',
  }

  for (const lang of LANGUAGES) {
    if (!NAMING_PATTERNS[lang]) continue
    for (const level of LEVELS) {
      it(`${lang}+${level}: naming pattern "${NAMING_PATTERNS[lang]}" present`, () => {
        const content = renderTemplate('scripts/check-test-naming.mjs.ejs', configFor(lang, level))
        expect(content).toContain(NAMING_PATTERNS[lang])
      })
    }
  }
})

// ─── M27: behavioral example templates — render per language ─────────────────

describe('cross-product: behavioral test example templates render per language (INV-11)', () => {
  const EXAMPLE_TEMPLATES: Partial<Record<Language, string>> = {
    java: 'behavioral-tests/ExampleBehavioralTest.java.ejs',
    typescript: 'behavioral-tests/example.behavioral.test.ts.ejs',
    rust: 'behavioral-tests/example_behavioral_test.rs.ejs',
    go: 'behavioral-tests/example_behavioral_test.go.ejs',
    python: 'behavioral-tests/test_example_behavioral.py.ejs',
  }

  for (const [lang, template] of Object.entries(EXAMPLE_TEMPLATES)) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: renders without error`, () => {
        expect(() => renderTemplate(template, configFor(lang as Language, level))).not.toThrow()
      })
    }
  }
})

// ─── M27: check-all.mjs.ejs — test naming gate present in L1 ─────────────────

describe('cross-product: check-all.mjs — test naming gate wired in L1 (INV-11/M27)', () => {
  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: check-test-naming.mjs present in gate`, () => {
        const content = renderCheckAll(configFor(lang, level))
        expect(content).toContain('check-test-naming.mjs')
      })
    }
  }
})

// ─── M28: Contract testing — generateContractTesting cross-product sweep ──────

const CONTRACT_TYPES = ['rest-owned', 'rest-public', 'graphql', 'grpc', 'message-queue'] as const

describe('cross-product: generateContractTesting — no throw for lang × level × contractType (M28)', () => {
  for (const lang of LANGUAGES) {
    for (const level of ['L2', 'L3'] as GovernanceLevel[]) {
      for (const contractType of CONTRACT_TYPES) {
        it(`${lang}+${level}+${contractType}: generateContractTesting does not throw`, () => {
          const d = mkdtempSync(join(tmpdir(), `arbiter-cp-contract-${lang}-${level}-`))
          try {
            const config = makeConfig(d, {
              language: lang,
              governanceLevel: level,
              contractType,
              basePackage: 'com.example',
              ...STACK_CONFIG[lang],
            })
            expect(() => generateContractTesting(config)).not.toThrow()
          } finally {
            rmSync(d, { recursive: true, force: true })
          }
        })
      }
    }
  }
})

// ─── #403: Multi-lane — sparse 3×3 sweep (task/ci/agents-md templates) ────────
// Sparse: typescript×all-levels + one other lang per lane config to keep matrix small

const MULTI_LANE_CONFIGS: Array<{
  lanes: ('frontend' | 'backend' | 'docs')[]
  level: GovernanceLevel
  lang: Language
}> = [
  { lanes: ['frontend', 'backend'], level: 'L1', lang: 'typescript' },
  { lanes: ['frontend', 'backend'], level: 'L2', lang: 'typescript' },
  { lanes: ['frontend', 'backend'], level: 'L3', lang: 'typescript' },
  { lanes: ['frontend', 'backend', 'docs'], level: 'L2', lang: 'typescript' },
  { lanes: ['frontend', 'backend'], level: 'L2', lang: 'java' },
]

describe('cross-product: multi-lane (#403) — ci.yml + task.md contain lane discipline sections', () => {
  for (const { lanes, level, lang } of MULTI_LANE_CONFIGS) {
    it(`${lang}+${level}+lanes[${lanes.join(',')}]: ci.yml has classify-changes + cross-stack-guard`, () => {
      const rendered = renderTemplate(
        'github/workflows/01-pr-fast.yml.ejs',
        makeConfig('/tmp/test', {
          language: lang,
          governanceLevel: level,
          lanes,
          ...STACK_CONFIG[lang],
        }) as unknown as Record<string, unknown>,
      )
      expect(rendered).toContain('classify-changes')
      expect(rendered).toContain('cross-stack-guard')
    })

    it(`${lang}+${level}+lanes[${lanes.join(',')}]: task.md is engine-ref (no Lane Discipline — #1216)`, () => {
      // #1216: task.md is now the engine/CLI reference only. Lane discipline was
      // orchestration prose; it has been removed. Lane discipline in /ship is a follow-up.
      const rendered = renderTemplate(
        'claude/commands/task.md.ejs',
        makeConfig('/tmp/test', {
          language: lang,
          governanceLevel: level,
          lanes,
          ...STACK_CONFIG[lang],
        }) as unknown as Record<string, unknown>,
      )
      expect(rendered).not.toContain('Lane Discipline')
    })
  }
})

describe('cross-product: single-lane (#403) — ci.yml unchanged for lanes:[]', () => {
  for (const lang of ['typescript', 'java', 'go'] as Language[]) {
    for (const level of LEVELS) {
      it(`${lang}+${level}+lanes[]: no cross-stack-guard emitted`, () => {
        const rendered = renderTemplate(
          'github/workflows/01-pr-fast.yml.ejs',
          makeConfig('/tmp/test', {
            language: lang,
            governanceLevel: level,
            lanes: [],
            ...STACK_CONFIG[lang],
          }) as unknown as Record<string, unknown>,
        )
        expect(rendered).not.toContain('cross-stack-guard')
      })
    }
  }
})

// ── #161: classify-changes gate extends to L2 single-lane ────────────────────

describe('cross-product: classify-changes gate (#161) — L2+ single-lane', () => {
  for (const lang of ['typescript', 'java', 'go'] as Language[]) {
    it(`${lang}+L2+lanes[]: ci.yml includes classify-changes job`, () => {
      const rendered = renderTemplate(
        'github/workflows/01-pr-fast.yml.ejs',
        makeConfig('/tmp/test', {
          language: lang,
          governanceLevel: 'L2',
          lanes: [],
          ...STACK_CONFIG[lang],
        }) as unknown as Record<string, unknown>,
      )
      expect(rendered).toContain('classify-changes:')
    })

    it(`${lang}+L3+lanes[]: ci.yml includes classify-changes job`, () => {
      const rendered = renderTemplate(
        'github/workflows/01-pr-fast.yml.ejs',
        makeConfig('/tmp/test', {
          language: lang,
          governanceLevel: 'L3',
          lanes: [],
          ...STACK_CONFIG[lang],
        }) as unknown as Record<string, unknown>,
      )
      expect(rendered).toContain('classify-changes:')
    })

    it(`${lang}+L1+lanes[]: ci.yml does NOT include classify-changes job`, () => {
      const rendered = renderTemplate(
        'github/workflows/01-pr-fast.yml.ejs',
        makeConfig('/tmp/test', {
          language: lang,
          governanceLevel: 'L1',
          lanes: [],
          ...STACK_CONFIG[lang],
        }) as unknown as Record<string, unknown>,
      )
      expect(rendered).not.toContain('classify-changes:')
    })

    it(`${lang}+L2+lanes[]: lint-and-test needs classify-changes and checks docs_only (#161)`, () => {
      const rendered = renderTemplate(
        'github/workflows/01-pr-fast.yml.ejs',
        makeConfig('/tmp/test', {
          language: lang,
          governanceLevel: 'L2',
          lanes: [],
          ...STACK_CONFIG[lang],
        }) as unknown as Record<string, unknown>,
      )
      expect(rendered).toContain('needs.classify-changes.outputs.docs_only')
    })
  }
})

// ── #1076 Sub-1: SHA-pinned action refs (INV-76) ─────────────────────────────

const SHA_RE = /^[0-9a-f]{40}$/i
// Matches both `- uses: owner/repo@ref` and `uses: owner/repo@ref`
const USES_RE = /^\s+(?:-\s+)?uses:\s+["']?([^@\s"']+)@([^\s#"']+)/gm

function extractActionRefs(yaml: string): Array<{ action: string; ref: string }> {
  const refs: Array<{ action: string; ref: string }> = []
  for (const m of yaml.matchAll(USES_RE)) {
    const action = m[1].replace(/^['"]|['"]$/g, '')
    const ref = m[2].replace(/^['"]|['"]$/g, '')
    if (action.startsWith('.') || action.startsWith('docker://')) continue
    refs.push({ action, ref })
  }
  return refs
}

describe('cross-product: workflow templates — SHA-pinned action refs (INV-76, #1076)', () => {
  // Known exclusion: shopify/toxiproxy-github-action has no public SHA-resolvable tag (#1086)
  const EXCLUDED_ACTIONS = new Set(['shopify/toxiproxy-github-action'])

  const TEMPLATES_REQUIRING_SHA: Array<{
    tpl: string
    level: GovernanceLevel
    lang?: string
    /** At least one action ref must be present in the rendered output */
    expectRefs?: boolean
  }> = [
    { tpl: 'github/workflows/drift-shadow.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/_ai-draft-check.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/_sigstore-retry-sign.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/issue-state.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/_label-sync.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/_post-merge-notify.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/_k6-runner.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/_contract-postman.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/01-pr-fast.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/02-pr-extended.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/04-deploy-test.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/05-release.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/10-deploy-prod.yml.ejs', level: 'L2', expectRefs: true },
    // #1691: 06/07/08 are thin callers (uses: ./.github/workflows/_*.yml only — no third-party refs).
    { tpl: 'github/workflows/06-nightly.yml.ejs', level: 'L2', expectRefs: false },
    { tpl: 'github/workflows/06-nightly.yml.ejs', level: 'L2', lang: 'java', expectRefs: false },
    { tpl: 'github/workflows/06-nightly.yml.ejs', level: 'L2', lang: 'go', expectRefs: false },
    { tpl: 'github/workflows/06-nightly.yml.ejs', level: 'L2', lang: 'rust', expectRefs: false },
    { tpl: 'github/workflows/07-weekly.yml.ejs', level: 'L2', lang: 'java', expectRefs: false },
    { tpl: 'github/workflows/07-weekly.yml.ejs', level: 'L2', lang: 'go', expectRefs: false },
    { tpl: 'github/workflows/08-monthly.yml.ejs', level: 'L2', expectRefs: false },
    { tpl: 'github/workflows/08-monthly.yml.ejs', level: 'L2', lang: 'java', expectRefs: false },
    { tpl: 'github/workflows/08-monthly.yml.ejs', level: 'L2', lang: 'go', expectRefs: false },
    { tpl: 'github/workflows/08-monthly.yml.ejs', level: 'L2', lang: 'python', expectRefs: false },
    { tpl: 'github/workflows/08-monthly.yml.ejs', level: 'L2', lang: 'rust', expectRefs: false },
    // #1691: reusable partials carry all the third-party action refs (INV-76).
    { tpl: 'github/workflows/_nightly.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/_nightly.yml.ejs', level: 'L2', lang: 'java', expectRefs: true },
    { tpl: 'github/workflows/_nightly.yml.ejs', level: 'L2', lang: 'go', expectRefs: true },
    { tpl: 'github/workflows/_nightly.yml.ejs', level: 'L2', lang: 'rust', expectRefs: true },
    { tpl: 'github/workflows/_weekly.yml.ejs', level: 'L2', lang: 'java', expectRefs: true },
    { tpl: 'github/workflows/_weekly.yml.ejs', level: 'L2', lang: 'go', expectRefs: true },
    { tpl: 'github/workflows/_monthly.yml.ejs', level: 'L2', expectRefs: true },
    { tpl: 'github/workflows/_monthly.yml.ejs', level: 'L2', lang: 'java', expectRefs: true },
    { tpl: 'github/workflows/_monthly.yml.ejs', level: 'L2', lang: 'go', expectRefs: true },
    { tpl: 'github/workflows/_monthly.yml.ejs', level: 'L2', lang: 'python', expectRefs: true },
    { tpl: 'github/workflows/_monthly.yml.ejs', level: 'L2', lang: 'rust', expectRefs: true },
    {
      tpl: 'github/workflows/12-mutation-scheduled.yml.ejs',
      level: 'L2',
      lang: 'java',
      expectRefs: true,
    },
    {
      tpl: 'github/workflows/13-archunit-extended.yml.ejs',
      level: 'L2',
      lang: 'java',
      expectRefs: true,
    },
    {
      tpl: 'github/workflows/14-license-scan.yml.ejs',
      level: 'L2',
      lang: 'java',
      expectRefs: true,
    },
    // #1330 — per-lane frontend gate workflow (subtree frontend lane).
    {
      tpl: 'github/workflows/18-frontend-lane.yml.ejs',
      level: 'L2',
      lang: 'go',
      expectRefs: true,
    },
  ]

  for (const { tpl, level, lang = 'typescript', expectRefs = false } of TEMPLATES_REQUIRING_SHA) {
    it(`${tpl} at ${level} (${lang}): all third-party action refs are SHA-pinned`, () => {
      const rendered = renderTemplate(tpl, configFor(lang as Language, level))
      const refs = extractActionRefs(rendered)
      if (expectRefs) expect(refs.length).toBeGreaterThan(0)
      const nonSha = refs
        .filter(({ ref }) => !SHA_RE.test(ref))
        .filter(({ action }) => !EXCLUDED_ACTIONS.has(action))
      expect(nonSha).toEqual([])
    })
  }
})

// ── #1076 Sub-2: Top-level permissions block (INV-77) ────────────────────────

describe('cross-product: workflow templates — top-level permissions block (INV-77, #1076)', () => {
  // These 29 enumerated *.yml.ejs templates must render with a top-level permissions: block.
  // This ratchet prevents future template edits from accidentally removing permissions.
  // #1691: added _nightly.yml.ejs, _weekly.yml.ejs, _monthly.yml.ejs (26 → 29).
  // These templates must render with a top-level permissions: block.
  const ALL_WORKFLOW_TEMPLATES: Array<{ tpl: string; level: GovernanceLevel; lang?: string }> = [
    { tpl: 'github/workflows/01-pr-fast.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/02-pr-extended.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/03-human-approval.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/04-deploy-test.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/05-release.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/06-nightly.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/07-weekly.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/08-monthly.yml.ejs', level: 'L2' },
    // #1691: reusable partials also carry top-level permissions (INV-77).
    { tpl: 'github/workflows/_nightly.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/_weekly.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/_monthly.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/09-heartbeat.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/10-deploy-prod.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/11-k6-on-demand.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/12-mutation-scheduled.yml.ejs', level: 'L2', lang: 'java' },
    { tpl: 'github/workflows/13-archunit-extended.yml.ejs', level: 'L2', lang: 'java' },
    { tpl: 'github/workflows/14-license-scan.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/_ai-draft-check.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/_contract-postman.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/drift-shadow.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/issue-state.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/_k6-runner.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/_label-on-approve.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/_label-sync.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/_notify.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/_post-merge-notify.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/_pr-staleness.yml.ejs', level: 'L2' },
    { tpl: 'github/workflows/_sigstore-retry-sign.yml.ejs', level: 'L2' },
    // #1330 — per-lane frontend gate workflow (subtree frontend lane).
    { tpl: 'github/workflows/18-frontend-lane.yml.ejs', level: 'L2', lang: 'go' },
  ]

  for (const { tpl, level, lang = 'typescript' } of ALL_WORKFLOW_TEMPLATES) {
    it(`${tpl} at ${level} (${lang}): rendered output has top-level permissions: block`, () => {
      const rendered = renderTemplate(tpl, configFor(lang as Language, level))
      expect(rendered).toMatch(/^permissions:/m)
    })
  }
})

// ── #1076 Sub-3: Inline runner check covers RUNNER_LABELS forms (INV-89) ─────

describe('cross-product: generated check-all.mjs — runner allowlist covers RUNNER_LABELS (INV-89, #1076)', () => {
  it('rendered check-all.mjs pattern matches RUNNER_LABELS_BUILD', () => {
    const rendered = renderCheckAll(configFor('typescript', 'L3'))
    expect(rendered).toContain('RUNNER_LABELS_BUILD')
  })

  it('rendered check-all.mjs pattern matches RUNNER_LABELS_DEPLOY', () => {
    const rendered = renderCheckAll(configFor('typescript', 'L3'))
    expect(rendered).toContain('RUNNER_LABELS_DEPLOY')
  })

  it('rendered check-all.mjs violation message references ubuntu-latest not docker-ci-build', () => {
    const rendered = renderCheckAll(configFor('typescript', 'L3'))
    // Violation message must name the correct fallback per ADR-023 amendment #959
    const violationLine = rendered
      .split('\n')
      .find((l) => l.includes('violation') && l.includes('use '))
    expect(violationLine).toBeDefined()
    expect(violationLine).toContain('ubuntu-latest')
    expect(violationLine).not.toContain('docker-ci-build')
  })
})

// ─── Claude commands: ship.md (#1206) ──────────────────────────────────────────

describe('cross-product: ship.md — orchestrator content across all stacks × levels', () => {
  function renderShip(lang: Language, level: GovernanceLevel): string {
    return renderTemplate('claude/commands/ship.md.ejs', configFor(lang, level))
  }

  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: loop commands + testCommand "${TEST_COMMANDS[lang]}" present`, () => {
        const out = renderShip(lang, level)
        expect(out).toContain('arbiter ship')
        expect(out).toContain('arbiter mark')
        expect(out).toContain(TEST_COMMANDS[lang])
      })
    }
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L1: omits tier-classification guidance`, () => {
      expect(renderShip(lang, 'L1')).not.toContain('sets the number of review agents')
    })
    it(`${lang}+L4: includes tier-classification guidance`, () => {
      expect(renderShip(lang, 'L4')).toContain('sets the number of review agents')
    })
  }

  // ─── Plan-mode auto enter/exit (#1209) ──────────────────────────────────────
  it('ship.md: contains EnterPlanMode instruction (auto plan-mode enter)', () => {
    // All stacks/levels should instruct the model to call EnterPlanMode at plan start
    expect(renderShip('typescript', 'L4')).toContain('EnterPlanMode')
  })

  it('ship.md: contains ExitPlanMode instruction (auto plan-mode exit at handoff)', () => {
    expect(renderShip('typescript', 'L4')).toContain('ExitPlanMode')
  })

  it('ship.md: contains --units flag in the handoff advance command', () => {
    // The skill should instruct the model to pass --units when calling arbiter ship --advance
    expect(renderShip('typescript', 'L4')).toContain('--units')
  })

  it('ship.md: plan-mode enter is conditional on phase (preflight or plan only)', () => {
    // The rendered skill must mention the phase condition so the model does not re-enter plan mode
    const out = renderShip('typescript', 'L4')
    // Must include both the conditional instruction and EnterPlanMode
    expect(out).toContain('EnterPlanMode')
    expect(out).toMatch(/preflight|plan.*phase|phase.*plan/i)
  })
})
