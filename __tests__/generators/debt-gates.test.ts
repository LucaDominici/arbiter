import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateDebtGates } from '../../src/generators/debt-gates.js'

describe('generateDebtGates', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits no debt-gate extras for rust/go when enableDebtGates is false', () => {
    // rust/go have no first-run gate scaffold to emit (their debt configs sit below
    // the enableDebtGates guard), so debtGates:false is a clean no-op. (TS and
    // Python DO emit an always-on gate-essential scaffold — covered separately.)
    const config = makeConfig(dir, { language: 'rust', enableDebtGates: false })
    const result = generateDebtGates(config)
    expect(result.files).toHaveLength(0)
  })

  it('emits the always-on Python gate scaffold even when enableDebtGates is false (B4)', () => {
    const config = makeConfig(dir, { language: 'python', enableDebtGates: false })
    const emitted = generateDebtGates(config).files.map((f) => f.path)
    expect(emitted.some((p) => p.endsWith('ruff.toml'))).toBe(true)
    expect(emitted.some((p) => p.endsWith('requirements-dev.txt'))).toBe(true)
  })

  // B4 (#1491): the gate-essential TS scaffold (tsconfig, eslint flat configs,
  // .prettierignore) must emit for EVERY TS init — even at L1 where
  // enableDebtGates is false — because the generated L1 gate runs
  // typecheck/format/lint/static-analysis for TS unconditionally. Without it the
  // gate is RED on first install.
  it('emits the gate-essential TS scaffold even when enableDebtGates is false (B4)', () => {
    const config = makeConfig(dir, { language: 'typescript', enableDebtGates: false })
    const result = generateDebtGates(config)
    const emitted = result.files.map((f) => f.path)
    expect(emitted.some((p) => p.endsWith('tsconfig.json'))).toBe(true)
    expect(emitted.some((p) => p.endsWith('eslint.config.mjs'))).toBe(true)
    expect(emitted.some((p) => p.endsWith('eslint.config.static.mjs'))).toBe(true)
    expect(emitted.some((p) => p.endsWith('.prettierignore'))).toBe(true)
    // Debt-only extras stay gated — knip/dependency-cruiser must NOT appear at L1.
    expect(emitted.some((p) => p.endsWith('knip.json'))).toBe(false)
    expect(emitted.some((p) => p.endsWith('.dependency-cruiser.cjs'))).toBe(false)
  })

  it('declares the L1 gate toolchain (eslint/vitest/prettier/tsc) in package.json devDeps (B4)', () => {
    const config = makeConfig(dir, { language: 'typescript', enableDebtGates: false })
    generateDebtGates(config)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
      devDependencies?: Record<string, string>
    }
    const dd = pkg.devDependencies ?? {}
    for (const tool of [
      'typescript',
      '@types/node',
      'prettier',
      'eslint',
      'typescript-eslint',
      'vitest',
    ]) {
      expect(dd, `expected ${tool} in devDependencies`).toHaveProperty(tool)
    }
  })

  // ── TypeScript ──────────────────────────────────────────────────────────────

  it('generates knip.json for TypeScript projects', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('knip.json'))).toBe(true)
    expect(existsSync(join(dir, 'knip.json'))).toBe(true)
  })

  it('knip.json contains valid JSON with project and entry fields', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, 'knip.json'), 'utf-8')
    const parsed = JSON.parse(content) as Record<string, unknown>
    expect(parsed).toHaveProperty('entry')
    expect(parsed).toHaveProperty('project')
  })

  it('generates .eslintrc-static.json for TypeScript projects (M29)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('.eslintrc-static.json'))).toBe(true)
    expect(existsSync(join(dir, '.eslintrc-static.json'))).toBe(true)
  })

  it('.eslintrc-static.json contains valid JSON with max-params rule (M29)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, '.eslintrc-static.json'), 'utf-8')
    const parsed = JSON.parse(content) as Record<string, unknown>
    expect(parsed).toHaveProperty('rules')
    const rules = parsed.rules as Record<string, unknown>
    expect(rules).toHaveProperty('max-params')
  })

  it('generates .prettierrc.json for TypeScript projects (M29)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('.prettierrc.json'))).toBe(true)
    expect(existsSync(join(dir, '.prettierrc.json'))).toBe(true)
  })

  it('.prettierrc.json contains valid JSON with printWidth (M29)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, '.prettierrc.json'), 'utf-8')
    const parsed = JSON.parse(content) as Record<string, unknown>
    expect(parsed).toHaveProperty('printWidth')
  })

  it('does not generate knip.json for non-TypeScript projects', () => {
    cleanupTestProject(dir)
    dir = createTestProject('go')
    const config = makeConfig(dir, {
      language: 'go',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    expect(existsSync(join(dir, 'knip.json'))).toBe(false)
  })

  // ── Go ─────────────────────────────────────────────────────────────────────

  it('generates .golangci.yml for Go projects', () => {
    cleanupTestProject(dir)
    dir = createTestProject('go')
    const config = makeConfig(dir, {
      language: 'go',
      buildTool: 'go',
      enableDebtGates: true,
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('.golangci.yml'))).toBe(true)
    expect(existsSync(join(dir, '.golangci.yml'))).toBe(true)
  })

  it('.golangci.yml enables gocyclo, unused, and full suite (M29)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('go')
    const config = makeConfig(dir, {
      language: 'go',
      buildTool: 'go',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, '.golangci.yml'), 'utf-8')
    expect(content).toContain('gocyclo')
    expect(content).toContain('unused')
    expect(content).toContain('gosec')
    expect(content).toContain('errcheck')
    expect(content).toContain('staticcheck')
  })

  it('does not generate .golangci.yml for non-Go projects', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    expect(existsSync(join(dir, '.golangci.yml'))).toBe(false)
  })

  // ── Java ───────────────────────────────────────────────────────────────────

  it('generates config/pmd-ruleset.xml for Java projects', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('pmd-ruleset.xml'))).toBe(true)
    expect(existsSync(join(dir, 'config', 'pmd-ruleset.xml'))).toBe(true)
  })

  it('pmd-ruleset.xml includes precise 7-category ruleset (M29)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, 'config', 'pmd-ruleset.xml'), 'utf-8')
    expect(content).toContain('CyclomaticComplexity')
    expect(content).toContain('security.xml')
    expect(content).toContain('multithreading.xml')
    expect(content).toContain('GodClass')
  })

  it('generates config/checkstyle.xml for Java projects (M29)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('checkstyle.xml'))).toBe(true)
    expect(existsSync(join(dir, 'config', 'checkstyle.xml'))).toBe(true)
  })

  it('checkstyle.xml contains MethodLength(65) and ParameterNumber(7) (M29)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, 'config', 'checkstyle.xml'), 'utf-8')
    expect(content).toContain('MethodLength')
    expect(content).toContain('65')
    expect(content).toContain('ParameterNumber')
    expect(content).toContain('7')
  })

  it('checkstyle.xml does not contain DOCTYPE declaration (avoids DTD network resolution on CI)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, 'config', 'checkstyle.xml'), 'utf-8')
    expect(content).not.toContain('<!DOCTYPE')
    expect(content).not.toContain('checkstyle.org/dtds')
  })

  it('generates config/spotbugs-exclude.xml for Java projects (M29)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('spotbugs-exclude.xml'))).toBe(true)
    expect(existsSync(join(dir, 'config', 'spotbugs-exclude.xml'))).toBe(true)
  })

  it('spotbugs-exclude.xml suppresses framework FPs but NOT SQL_INJECTION (M29)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, 'config', 'spotbugs-exclude.xml'), 'utf-8')
    expect(content).toContain('NP_NONNULL_FIELD')
    expect(content).not.toContain('SQL_INJECTION')
  })

  it('generates spotless.gradle for Java projects (M29)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('spotless.gradle'))).toBe(true)
    expect(existsSync(join(dir, 'spotless.gradle'))).toBe(true)
  })

  it('spotless.gradle contains googleJavaFormat (M29)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, 'spotless.gradle'), 'utf-8')
    expect(content).toContain('googleJavaFormat')
  })

  it('generates spotbugs.gradle for Java projects (CANON-05)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('spotbugs.gradle'))).toBe(true)
    expect(existsSync(join(dir, 'spotbugs.gradle'))).toBe(true)
    const content = readFileSync(join(dir, 'spotbugs.gradle'), 'utf-8')
    expect(content).toContain('com.github.spotbugs')
    expect(content).toContain('excludeFilter')
  })

  it('does not generate pmd-ruleset.xml for non-Java projects', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    expect(existsSync(join(dir, 'config', 'pmd-ruleset.xml'))).toBe(false)
  })

  // ── Rust ───────────────────────────────────────────────────────────────────

  it('generates rustfmt.toml for Rust projects (#157)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('rust')
    const config = makeConfig(dir, {
      language: 'rust',
      buildTool: 'cargo',
      enableDebtGates: true,
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('rustfmt.toml'))).toBe(true)
    expect(existsSync(join(dir, 'rustfmt.toml'))).toBe(true)
  })

  it('rustfmt.toml contains edition and max_width (#157)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('rust')
    const config = makeConfig(dir, {
      language: 'rust',
      buildTool: 'cargo',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, 'rustfmt.toml'), 'utf-8')
    expect(content).toContain('edition')
    expect(content).toContain('max_width')
  })

  // ── Python ─────────────────────────────────────────────────────────────────

  it('generates ruff.toml for Python projects (M29)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('python')
    const config = makeConfig(dir, {
      language: 'python',
      buildTool: 'pip',
      enableDebtGates: true,
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('ruff.toml'))).toBe(true)
    expect(existsSync(join(dir, 'ruff.toml'))).toBe(true)
  })

  it('ruff.toml contains C901 and PLR0911 complexity rules (M29)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('python')
    const config = makeConfig(dir, {
      language: 'python',
      buildTool: 'pip',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, 'ruff.toml'), 'utf-8')
    expect(content).toContain('C901')
    expect(content).toContain('PLR0911')
  })

  it('ruff.toml extends boundaries for hexagonal Python projects (M29)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('python')
    const config = makeConfig(dir, {
      language: 'python',
      buildTool: 'pip',
      enableDebtGates: true,
      architectureStyle: 'hexagonal',
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, 'ruff.toml'), 'utf-8')
    expect(content).toContain('ruff-boundaries.toml')
  })

  // ── Pitest ─────────────────────────────────────────────────────────────────

  it('generates config/pitest-setup.md for Java L2+ projects', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
      governanceLevel: 'L2',
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('pitest-setup.md'))).toBe(true)
    expect(existsSync(join(dir, 'config', 'pitest-setup.md'))).toBe(true)
  })

  it('pitest-setup.md contains both Maven and Gradle snippets', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
      governanceLevel: 'L2',
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, 'config', 'pitest-setup.md'), 'utf-8')
    expect(content).toContain('pitest')
    expect(content).toContain('Maven')
    expect(content).toContain('Gradle')
    expect(content).toContain('mutationThreshold')
  })

  it('does not generate pitest-setup.md for non-Java projects', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    expect(existsSync(join(dir, 'config', 'pitest-setup.md'))).toBe(false)
  })

  // ── SpotBugs baseline (#212) ────────────────────────────────────────────────

  it('emits scripts/verify-spotbugs.mjs for Java projects (#212)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    expect(existsSync(join(dir, 'scripts', 'verify-spotbugs.mjs'))).toBe(true)
  })

  it('verify-spotbugs.mjs contains security hard-block list (#212)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, 'scripts', 'verify-spotbugs.mjs'), 'utf-8')
    expect(content).toContain('SQL_INJECTION')
    expect(content).toContain('COMMAND_INJECTION')
    expect(content).toContain('LDAP_INJECTION')
  })

  it('emits spotbugs-baseline.json for Java projects (#212)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    expect(existsSync(join(dir, 'spotbugs-baseline.json'))).toBe(true)
    const parsed = JSON.parse(readFileSync(join(dir, 'spotbugs-baseline.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(Array.isArray(parsed.baselined)).toBe(true)
    expect((parsed.baselined as unknown[]).length).toBe(0)
  })

  it('does not emit verify-spotbugs.mjs for TypeScript projects (#212)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    expect(existsSync(join(dir, 'scripts', 'verify-spotbugs.mjs'))).toBe(false)
  })

  // ── dependency-cruiser (#216) ─────────────────────────────────────────────

  it('emits .dependency-cruiser.cjs for TypeScript projects (#216)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    const result = generateDebtGates(config)
    expect(result.files.some((f) => f.path.endsWith('.dependency-cruiser.cjs'))).toBe(true)
    expect(existsSync(join(dir, '.dependency-cruiser.cjs'))).toBe(true)
  })

  it('.dependency-cruiser.cjs contains no-circular and no-cross-layer rules (#216)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const content = readFileSync(join(dir, '.dependency-cruiser.cjs'), 'utf-8')
    expect(content).toContain('no-circular')
    expect(content).toContain('no-cross-layer')
    expect(content).toContain('module.exports')
  })

  it('injects check:arch script and dependency-cruiser devDep into package.json (#216)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as Record<
      string,
      Record<string, string>
    >
    expect(pkg.scripts?.['check:arch']).toBe('depcruise src')
    expect(pkg.devDependencies?.['dependency-cruiser']).toMatch(/^\^16/)
  })

  it('does not emit .dependency-cruiser.cjs for Java projects (#216)', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    expect(existsSync(join(dir, '.dependency-cruiser.cjs'))).toBe(false)
  })

  it('injects test:unit/contract/integration/behavioral scripts into package.json (#219)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as Record<
      string,
      Record<string, string>
    >
    // #1324: framework-aligned (mirror arbiter's own scripts) — path-based, never
    // `vitest --project <tier>` (the generated vitest.config.ts defines no projects,
    // so --project crashes the gate). test:unit runs all tests; optional tiers add
    // --passWithNoTests so a greenfield project without those tiers stays green.
    expect(pkg.scripts?.['test:unit']).toBe('vitest run')
    expect(pkg.scripts?.['test:contract']).toBe('vitest run --passWithNoTests __tests__/contract')
    expect(pkg.scripts?.['test:integration']).toBe(
      'vitest run --passWithNoTests __tests__/integrations',
    )
    expect(pkg.scripts?.['test:behavioral']).toBe(
      'vitest run --passWithNoTests __tests__/behavioral',
    )
    for (const tier of ['test:unit', 'test:contract', 'test:integration', 'test:behavioral']) {
      expect(pkg.scripts?.[tier]).not.toContain('--project')
    }
  })

  it('injects test scripts even when enableDebtGates is false (#219)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: false,
    })
    generateDebtGates(config)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as Record<
      string,
      Record<string, string>
    >
    expect(pkg.scripts?.['test:unit']).toContain('vitest')
  })

  it('does not overwrite existing test scripts (#219)', () => {
    const pkgPath = join(dir, 'package.json')
    const existing = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<
      string,
      Record<string, string>
    >
    existing.scripts['test:unit'] = 'jest --testPathPattern unit'
    writeFileSync(pkgPath, JSON.stringify(existing, null, 2))
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, Record<string, string>>
    expect(pkg.scripts?.['test:unit']).toBe('jest --testPathPattern unit')
  })
})
