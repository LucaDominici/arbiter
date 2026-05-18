import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { runGenerators } from '../../src/commands/init.js'
import { getLanguageHooks } from '../../src/detectors/language-hooks.js'

describe('matrix: Rust project', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('rust')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function rustConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      language: 'rust',
      framework: null,
      buildTool: 'cargo',
      buildCommand: 'cargo build',
      testCommand: 'cargo test',
      lintCommand: 'cargo clippy -- -D warnings',
      formatCommand: 'cargo fmt --check',
      tools: ['claude', 'codex'],
      useGitHub: true,
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
      languageHooks: getLanguageHooks('rust'),
      ...overrides,
    })
  }

  it('generates AGENTS.md mentioning Rust', () => {
    const config = rustConfig()
    runGenerators(config)
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('rust')
  })

  it('AGENTS.md includes no-unwrap invariant', () => {
    const config = rustConfig()
    runGenerators(config)
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('.unwrap()')
    expect(content).toContain('explicit error handling')
  })

  it('CI workflow uses cargo commands', () => {
    const config = rustConfig()
    runGenerators(config)
    const ci = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(ci).toContain('cargo fmt --check')
    expect(ci).toContain('cargo clippy')
    expect(ci).toContain('cargo test')
  })

  it('CI workflow uses rust-toolchain setup', () => {
    const config = rustConfig()
    runGenerators(config)
    const ci = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(ci).toContain('rust-toolchain@stable')
    expect(ci).toContain('rust-cache')
  })

  it('check-all.mjs references cargo', () => {
    const config = rustConfig()
    runGenerators(config)
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('fmt')
    expect(checkAll).toContain('clippy')
    expect(checkAll).toContain('cargo')
  })

  it('generates check-no-unwrap.mjs language hook', () => {
    const config = rustConfig()
    runGenerators(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-unwrap.mjs'))).toBe(true)
    const hook = readFileSync(join(dir, '.claude', 'hooks', 'check-no-unwrap.mjs'), 'utf-8')
    expect(hook).toContain('.unwrap()')
  })

  it('settings.json includes cargo permissions', () => {
    const config = rustConfig()
    runGenerators(config)
    const settings = JSON.parse(
      readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'),
    ) as Record<string, unknown>
    const permissions = settings['permissions'] as { allow?: string[] }
    expect(permissions.allow).toEqual(expect.arrayContaining(['Bash(cargo *)']))
  })

  it('check-all.mjs includes tarpaulin and clippy pedantic when enableDebtGates is true', () => {
    const config = rustConfig({ enableDebtGates: true })
    runGenerators(config)
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('tarpaulin')
    expect(checkAll).toContain('pedantic')
  })

  it('generates rustfmt.toml when enableDebtGates is true (#157)', () => {
    const config = rustConfig({ enableDebtGates: true })
    runGenerators(config)
    expect(existsSync(join(dir, 'rustfmt.toml'))).toBe(true)
    const content = readFileSync(join(dir, 'rustfmt.toml'), 'utf-8')
    expect(content).toContain('edition')
    expect(content).toContain('max_width')
  })

  it('rustfmt.toml not generated when enableDebtGates is false (#157)', () => {
    const config = rustConfig({ enableDebtGates: false })
    runGenerators(config)
    expect(existsSync(join(dir, 'rustfmt.toml'))).toBe(false)
  })

  it('CI workflow includes debt-gates job for Rust when enableDebtGates is true', () => {
    const config = rustConfig({ enableDebtGates: true })
    runGenerators(config)
    const ci = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(ci).toContain('debt-gates:')
  })

  it('AGENTS.md coding standards are Rust-specific', () => {
    const config = rustConfig()
    runGenerators(config)
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('clippy::pedantic')
    expect(content).toContain('Result<T, E>')
    // Should NOT contain TypeScript or Java standards
    expect(content).not.toContain('Strict mode always on')
    expect(content).not.toContain('constructor injection')
  })

  describe('hexagonal architecture variant', () => {
    function hexConfig() {
      return rustConfig({ architectureStyle: 'hexagonal' })
    }

    it('emits deny.toml at project root', () => {
      runGenerators(hexConfig())
      expect(existsSync(join(dir, 'deny.toml'))).toBe(true)
    })

    it('emits clippy.toml at project root', () => {
      runGenerators(hexConfig())
      expect(existsSync(join(dir, 'clippy.toml'))).toBe(true)
    })

    it('emits scripts/check-boundaries.mjs', () => {
      runGenerators(hexConfig())
      expect(existsSync(join(dir, 'scripts', 'check-boundaries.mjs'))).toBe(true)
    })

    it('deny.toml contains framework crate bans', () => {
      runGenerators(hexConfig())
      const content = readFileSync(join(dir, 'deny.toml'), 'utf-8')
      expect(content).toContain('sqlx')
      expect(content).toContain('axum')
    })

    it('clippy.toml contains disallowed_types', () => {
      runGenerators(hexConfig())
      const content = readFileSync(join(dir, 'clippy.toml'), 'utf-8')
      expect(content).toContain('disallowed_types')
    })

    it('AGENTS.md contains Architecture Verification (M22b) section with cargo-deny', () => {
      runGenerators(hexConfig())
      const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
      expect(content).toContain('Architecture Verification (M22b)')
      expect(content).toContain('cargo-deny')
    })

    it('check-all.mjs contains boundaries gate step', () => {
      runGenerators(hexConfig())
      const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(checkAll).toContain("runCheck('boundaries'")
    })

    it('domain purity grep fails on forbidden use statement, passes on clean domain', () => {
      runGenerators(hexConfig())
      mkdirSync(join(dir, 'src', 'domain'), { recursive: true })
      writeFileSync(join(dir, 'src', 'domain', 'bad.rs'), 'use sqlx::Pool;\n')

      const fail = spawnSync('node', ['scripts/check-boundaries.mjs'], {
        cwd: dir,
        encoding: 'utf-8',
        shell: false,
      })
      expect(fail.status).not.toBe(0)
      expect(fail.stderr).toContain('sqlx')

      rmSync(join(dir, 'src', 'domain', 'bad.rs'))

      const pass = spawnSync('node', ['scripts/check-boundaries.mjs'], {
        cwd: dir,
        encoding: 'utf-8',
        shell: false,
      })
      expect(pass.stderr ?? '').not.toContain('domain purity violations')
    })

    it('domain purity grep also catches pub use re-exports', () => {
      runGenerators(hexConfig())
      mkdirSync(join(dir, 'src', 'domain'), { recursive: true })
      writeFileSync(join(dir, 'src', 'domain', 'bad.rs'), 'pub use sqlx::Pool;\n')

      const fail = spawnSync('node', ['scripts/check-boundaries.mjs'], {
        cwd: dir,
        encoding: 'utf-8',
        shell: false,
      })
      expect(fail.status).not.toBe(0)
      expect(fail.stderr).toContain('sqlx')

      rmSync(join(dir, 'src', 'domain', 'bad.rs'))
    })

    it('non-hexagonal config does NOT emit deny.toml', () => {
      runGenerators(rustConfig())
      expect(existsSync(join(dir, 'deny.toml'))).toBe(false)
    })

    it('non-hexagonal AGENTS.md does NOT contain M22b section', () => {
      runGenerators(rustConfig())
      const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
      expect(content).not.toContain('Architecture Verification (M22b)')
    })
  })
})

// ── M23: Rust L3 mutation gate (cargo-mutants — beta) ────────────────────────

describe('matrix: Rust L3 mutation gate (cargo-mutants)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('rust')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function rustL3Config(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      language: 'rust',
      governanceLevel: 'L3',
      useGitHub: true,
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
      languageHooks: getLanguageHooks('rust'),
      acceptBetaTools: true,
      ...overrides,
    })
  }

  it('emits cargo-mutants.toml at L3 when acceptBetaTools=true', () => {
    const config = rustL3Config()
    runGenerators(config)
    expect(existsSync(join(dir, 'cargo-mutants.toml'))).toBe(true)
  })

  it('emits scripts/parse-mutants.mjs at L3 when acceptBetaTools=true', () => {
    const config = rustL3Config()
    runGenerators(config)
    expect(existsSync(join(dir, 'scripts', 'parse-mutants.mjs'))).toBe(true)
  })

  it('cargo-mutants.toml contains 85% threshold reference', () => {
    const config = rustL3Config()
    runGenerators(config)
    const content = readFileSync(join(dir, 'cargo-mutants.toml'), 'utf-8')
    expect(content).toMatch(/domain|application/)
  })

  it('check-all.mjs does NOT invoke cargo-mutants (mutation moved to nightly)', () => {
    const config = rustL3Config()
    runGenerators(config)
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain('mutants')
  })

  it('L2 config does NOT emit cargo-mutants.toml', () => {
    const config = rustL3Config({ governanceLevel: 'L2' })
    runGenerators(config)
    expect(existsSync(join(dir, 'cargo-mutants.toml'))).toBe(false)
  })

  it('emits no mutation files when acceptBetaTools=false at L3 (cargo-mutants is beta)', () => {
    const config = rustL3Config({ acceptBetaTools: false })
    runGenerators(config)
    expect(existsSync(join(dir, 'cargo-mutants.toml'))).toBe(false)
  })

  it('emits no mutation files when acceptBetaTools not set at L3 (cargo-mutants is beta)', () => {
    const config = rustL3Config({ acceptBetaTools: undefined })
    runGenerators(config)
    expect(existsSync(join(dir, 'cargo-mutants.toml'))).toBe(false)
  })

  it('AGENTS.md L3 mentions cargo-mutants and 85%', () => {
    const config = rustL3Config()
    runGenerators(config)
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toMatch(/cargo.mutants|mutation/i)
    expect(content).toContain('85')
  })
})
