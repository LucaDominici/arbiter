import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { runGenerators } from '../../src/commands/init.js'
import { getLanguageHooks } from '../../src/detectors/language-hooks.js'

describe('matrix: TypeScript project', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function tsConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      language: 'typescript',
      framework: null,
      buildTool: 'npm',
      buildCommand: 'npm run build',
      testCommand: 'npm test',
      lintCommand: 'npm run lint',
      formatCommand: 'npx prettier --check .',
      tools: ['claude', 'codex'],
      useGitHub: true,
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
      languageHooks: getLanguageHooks('typescript'),
      ...overrides,
    })
  }

  it('generates AGENTS.md mentioning TypeScript', () => {
    const config = tsConfig()
    runGenerators(config)
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('typescript')
  })

  it('AGENTS.md includes no-any invariant for TypeScript', () => {
    const config = tsConfig()
    runGenerators(config)
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('No `any` type')
  })

  it('CI workflow uses npm commands', () => {
    const config = tsConfig()
    runGenerators(config)
    const ci = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    // #1131: `npm ci` is bundled in the setup-node-pnpm composite, not inline.
    expect(ci).toContain('./.github/actions/setup-node-pnpm')
    expect(ci).toContain('npm run lint')
    expect(ci).toContain('test:unit')
  })

  it('CI workflow sets up Node.js', () => {
    const config = tsConfig()
    runGenerators(config)
    const ci = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(ci).toContain('setup-node')
    expect(ci).toContain("node-version-file: '.nvmrc'")
  })

  it('check-all.mjs references eslint and prettier', () => {
    const config = tsConfig()
    runGenerators(config)
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('eslint')
    expect(checkAll).toContain('prettier')
  })

  it('generates check-no-any.mjs language hook', () => {
    const config = tsConfig()
    runGenerators(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-any.mjs'))).toBe(true)
    const hook = readFileSync(join(dir, '.claude', 'hooks', 'check-no-any.mjs'), 'utf-8')
    expect(hook).toContain('any')
  })

  it('settings.json includes npm permissions', () => {
    const config = tsConfig()
    runGenerators(config)
    const settings = JSON.parse(
      readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'),
    ) as Record<string, unknown>
    const permissions = settings['permissions'] as { allow?: string[] }
    expect(permissions.allow).toEqual(expect.arrayContaining(['Bash(npm run *)']))
  })

  it('generates knip.json when enableDebtGates is true', () => {
    const config = tsConfig({ enableDebtGates: true })
    runGenerators(config)
    expect(existsSync(join(dir, 'knip.json'))).toBe(true)
  })

  it('knip.json not generated when enableDebtGates is false', () => {
    const config = tsConfig({ enableDebtGates: false })
    runGenerators(config)
    expect(existsSync(join(dir, 'knip.json'))).toBe(false)
  })

  it('check-all.mjs includes knip and madge when enableDebtGates is true', () => {
    const config = tsConfig({ enableDebtGates: true })
    runGenerators(config)
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('knip')
    expect(checkAll).toContain('madge')
  })

  it('CI workflow includes debt-gates job when enableDebtGates is true', () => {
    const config = tsConfig({ enableDebtGates: true })
    runGenerators(config)
    const ci = readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf-8')
    expect(ci).toContain('debt-gates:')
  })

  it('dispatcher config table includes check-no-any.mjs hook entry (#248)', () => {
    const config = tsConfig()
    runGenerators(config)
    // settings.json uses dispatcher; individual hook names live in hooks.mjs config table
    const dispatcher = readFileSync(join(dir, '.claude', 'hooks', 'hooks.mjs'), 'utf-8')
    expect(dispatcher).toContain('check-no-any.mjs')
  })

  it('generates check-no-placeholders.mjs static hook (#151)', () => {
    const config = tsConfig()
    runGenerators(config)
    const hookPath = join(dir, '.claude', 'hooks', 'check-no-placeholders.mjs')
    expect(existsSync(hookPath)).toBe(true)
    // #2528: the marker literal is built by concatenation in source (so the
    // checker cannot self-block), so this proves the emitted hook by BEHAVIOR
    // — it still blocks a genuine shouted marker — rather than by string
    // containment of the marker itself.
    const marker = 'PLACE' + 'HOLDER'
    const probe = join(dir, 'probe.ts')
    writeFileSync(probe, `const x = ${marker};\n`)
    const result = spawnSync('node', [hookPath], {
      cwd: dir,
      env: { ...process.env, CLAUDE_TOOL_INPUT_PATH: probe },
      encoding: 'utf-8',
    })
    expect(result.status).toBe(2)
  })

  it('dispatcher config table includes check-no-placeholders.mjs hook entry (#151, #248)', () => {
    const config = tsConfig()
    runGenerators(config)
    // settings.json uses dispatcher; individual hook names live in hooks.mjs config table
    const dispatcher = readFileSync(join(dir, '.claude', 'hooks', 'hooks.mjs'), 'utf-8')
    expect(dispatcher).toContain('check-no-placeholders.mjs')
  })

  it('generates check-no-unused-exports.mjs hook for TypeScript (#156)', () => {
    const config = tsConfig()
    runGenerators(config)
    expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-unused-exports.mjs'))).toBe(true)
    const hook = readFileSync(join(dir, '.claude', 'hooks', 'check-no-unused-exports.mjs'), 'utf-8')
    expect(hook).toContain('knip')
  })

  it('dispatcher config table includes check-no-unused-exports.mjs hook entry for TypeScript (#156, #248)', () => {
    const config = tsConfig()
    runGenerators(config)
    // settings.json uses dispatcher; individual hook names live in hooks.mjs config table
    const dispatcher = readFileSync(join(dir, '.claude', 'hooks', 'hooks.mjs'), 'utf-8')
    expect(dispatcher).toContain('check-no-unused-exports.mjs')
  })

  it('AGENTS.md coding standards section is TypeScript-specific', () => {
    const config = tsConfig()
    runGenerators(config)
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('Strict mode always on')
    expect(content).toContain('kebab-case.ts')
    // Should NOT contain Java or Rust standards, and no M22a hexagonal block for non-hexagonal config
    expect(content).not.toContain('Hexagonal architecture')
    expect(content).not.toContain('.unwrap()')
    expect(content).not.toContain('Architecture Verification (M22a)')
  })

  describe('hexagonal architecture variant', () => {
    function hexConfig() {
      return tsConfig({ architectureStyle: 'hexagonal' })
    }

    it('emits .eslintrc-boundaries.cjs at project root', () => {
      runGenerators(hexConfig())
      expect(existsSync(join(dir, '.eslintrc-boundaries.cjs'))).toBe(true)
    })

    it('emits scripts/check-boundaries.mjs at project root', () => {
      runGenerators(hexConfig())
      expect(existsSync(join(dir, 'scripts', 'check-boundaries.mjs'))).toBe(true)
    })

    it('check-all.mjs calls node scripts/check-boundaries.mjs for boundaries gate', () => {
      runGenerators(hexConfig())
      const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(checkAll).toContain('check-boundaries.mjs')
    })

    it('.eslintrc-boundaries.cjs contains boundaries/element-types and domain layers', () => {
      runGenerators(hexConfig())
      const content = readFileSync(join(dir, '.eslintrc-boundaries.cjs'), 'utf-8')
      expect(content).toContain('boundaries/element-types')
      expect(content).toContain('domain')
      expect(content).toContain('adapters')
      expect(content).toContain('infrastructure')
    })

    it('AGENTS.md contains Architecture Verification (M22a) section', () => {
      runGenerators(hexConfig())
      const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
      expect(content).toContain('Architecture Verification (M22a)')
      expect(content).toContain('eslint-plugin-boundaries')
    })

    it('check-all.mjs contains boundaries gate step', () => {
      runGenerators(hexConfig())
      const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(checkAll).toContain("runCheck('boundaries'")
    })

    it('non-hexagonal config does NOT emit .eslintrc-boundaries.cjs', () => {
      runGenerators(tsConfig())
      expect(existsSync(join(dir, '.eslintrc-boundaries.cjs'))).toBe(false)
    })

    it('non-hexagonal AGENTS.md does NOT contain M22a section', () => {
      runGenerators(tsConfig())
      const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
      expect(content).not.toContain('Architecture Verification (M22a)')
    })
  })
})

// ── M23: TypeScript L3 mutation gate (Stryker) ───────────────────────────────

describe('matrix: TypeScript L3 mutation gate (Stryker)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function tsL3Config(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L3',
      buildTool: 'npm',
      useGitHub: true,
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
      languageHooks: getLanguageHooks('typescript'),
      ...overrides,
    })
  }

  it('emits stryker.conf.json at L3', () => {
    const config = tsL3Config()
    runGenerators(config)
    expect(existsSync(join(dir, 'stryker.conf.json'))).toBe(true)
  })

  it('stryker.conf.json threshold equals 85', () => {
    const config = tsL3Config()
    runGenerators(config)
    const content = readFileSync(join(dir, 'stryker.conf.json'), 'utf-8')
    expect(content).toContain('85')
    expect(content).toContain('vitest')
  })

  it('check-all.mjs invokes stryker at L3 (#347 — INV-30 wired in L2 block, runs at L2+)', () => {
    const config = tsL3Config()
    runGenerators(config)
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain("runToolCheck('mutation (stryker)', 'npx', ['stryker', 'run']")
  })

  it('L2 starter pipeline does NOT emit stryker.conf.json', () => {
    // #1543: configs are absent only where no release enforces mutation (starter style).
    const config = tsL3Config({ governanceLevel: 'L2', collaborationMode: 'trunk-solo' })
    runGenerators(config)
    expect(existsSync(join(dir, 'stryker.conf.json'))).toBe(false)
  })

  it('L2 non-starter pipeline DOES emit stryker.conf.json (#1543 release enforces mutation)', () => {
    const config = tsL3Config({ governanceLevel: 'L2', collaborationMode: 'peer-review' })
    runGenerators(config)
    expect(existsSync(join(dir, 'stryker.conf.json'))).toBe(true)
  })

  it('AGENTS.md L3 mentions stryker and 85%', () => {
    const config = tsL3Config()
    runGenerators(config)
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toMatch(/stryker/i)
    expect(content).toContain('85')
  })
})
