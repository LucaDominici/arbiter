import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'

// L2-only: requires cargo, npm, and full toolchains.
const L2 = process.env.VITEST_L2 === '1'

function copyFixture(name: string): string {
  const src = resolve(`__tests__/fixtures/real-projects/${name}`)
  const dir = mkdtempSync(join(tmpdir(), `arbiter-gate-${name}-`))
  cpSync(src, dir, { recursive: true })
  return dir
}

function initGit(dir: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'ci@arbiter.test'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Arbiter CI'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'chore: fixture init', '--no-verify'], {
    cwd: dir,
    stdio: 'ignore',
  })
}

function runGate(dir: string): { status: number; output: string } {
  const scriptPath = join(dir, 'scripts', 'check-all.mjs')
  expect(existsSync(scriptPath), `check-all.mjs not generated at ${scriptPath}`).toBe(true)
  const r = spawnSync('node', [scriptPath, 'L1'], {
    encoding: 'utf-8',
    cwd: dir,
    timeout: 120_000,
    env: { ...process.env, CI: 'true' },
  })
  return { status: r.status ?? 1, output: (r.stdout ?? '') + (r.stderr ?? '') }
}

describe.skipIf(!L2)('generated check-all.mjs L1 execution (#172)', () => {
  describe('Rust library fixture', () => {
    let dir: string

    it('generates check-all.mjs and runs L1 gate with exit 0', () => {
      dir = copyFixture('rust-library')
      initGit(dir)
      generateCheckAll(
        makeConfig(dir, {
          language: 'rust',
          buildTool: 'cargo',
          governanceLevel: 'L1',
          enableSecurityScanning: false,
        }),
      )
      const { status, output } = runGate(dir)
      if (status !== 0) {
        console.error('Gate output:\n', output)
      }
      expect(status).toBe(0)
      rmSync(dir, { recursive: true, force: true })
    })
  })

  describe('TypeScript library fixture', () => {
    let dir: string

    it('generates check-all.mjs and runs L1 gate with exit 0', () => {
      dir = copyFixture('ts-library')
      initGit(dir)
      // Install devDeps so tsc/eslint/vitest are available
      execFileSync('npm', ['install', '--silent'], {
        cwd: dir,
        stdio: 'ignore',
        timeout: 120_000,
      })
      generateCheckAll(
        makeConfig(dir, {
          language: 'typescript',
          buildTool: 'npm',
          governanceLevel: 'L1',
          enableSecurityScanning: false,
        }),
      )
      const { status, output } = runGate(dir)
      if (status !== 0) {
        console.error('Gate output:\n', output)
      }
      expect(status).toBe(0)
      rmSync(dir, { recursive: true, force: true })
    })
  })

  describe('Java library fixture', () => {
    let dir: string
    const hasJava = Boolean(
      process.env.JAVA_HOME ||
      (() => {
        const r = spawnSync('java', ['-version'], { encoding: 'utf-8' })
        return r.status === 0
      })(),
    )

    it.skipIf(!hasJava)('generates check-all.mjs and runs L1 gate with exit 0', () => {
      dir = copyFixture('java-library-gradle')
      initGit(dir)
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'gradle',
          governanceLevel: 'L1',
          enableSecurityScanning: false,
        }),
      )
      const { status, output } = runGate(dir)
      if (status !== 0) {
        console.error('Gate output:\n', output)
      }
      expect(status).toBe(0)
      rmSync(dir, { recursive: true, force: true })
    })
  })
})

// Smoke test (always runs, L1): just verifies the generated file is valid JS.
describe('generated check-all.mjs syntax (#172 smoke)', () => {
  let dir: string

  it('generated Rust check-all.mjs has no syntax errors', () => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-gate-smoke-'))
    generateCheckAll(
      makeConfig(dir, {
        language: 'rust',
        buildTool: 'cargo',
        governanceLevel: 'L1',
        enableSecurityScanning: false,
      }),
    )
    const scriptPath = join(dir, 'scripts', 'check-all.mjs')
    const content = readFileSync(scriptPath, 'utf-8')
    const r = spawnSync('node', ['--check', scriptPath], { encoding: 'utf-8' })
    expect(r.status, `Syntax error: ${r.stderr}`).toBe(0)
    expect(content).toContain('runCheck')
    rmSync(dir, { recursive: true, force: true })
  })

  it('generated TypeScript check-all.mjs has no syntax errors', () => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-gate-smoke-'))
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        buildTool: 'npm',
        governanceLevel: 'L1',
        enableSecurityScanning: false,
      }),
    )
    const scriptPath = join(dir, 'scripts', 'check-all.mjs')
    const r = spawnSync('node', ['--check', scriptPath], { encoding: 'utf-8' })
    expect(r.status, `Syntax error: ${r.stderr}`).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Parametrised smoke tests: generate + node --check across remaining stacks × levels (#1026)
type SmokeCase = {
  label: string
  language: 'java' | 'go' | 'python' | 'rust' | 'typescript' | 'kotlin'
  buildTool: string
  governanceLevel: 'L1' | 'L2' | 'L3' | 'L4'
  enableSecurityScanning: boolean
  enableDebtGates: boolean
}

const SMOKE_CASES: SmokeCase[] = [
  // Java — gradle, all levels
  {
    label: 'java/gradle L1',
    language: 'java',
    buildTool: 'gradle',
    governanceLevel: 'L1',
    enableSecurityScanning: false,
    enableDebtGates: false,
  },
  {
    label: 'java/gradle L2',
    language: 'java',
    buildTool: 'gradle',
    governanceLevel: 'L2',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  {
    label: 'java/gradle L3',
    language: 'java',
    buildTool: 'gradle',
    governanceLevel: 'L3',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  {
    label: 'java/gradle L4',
    language: 'java',
    buildTool: 'gradle',
    governanceLevel: 'L4',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  // Java — maven
  {
    label: 'java/maven L1',
    language: 'java',
    buildTool: 'maven',
    governanceLevel: 'L1',
    enableSecurityScanning: false,
    enableDebtGates: false,
  },
  {
    label: 'java/maven L2',
    language: 'java',
    buildTool: 'maven',
    governanceLevel: 'L2',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  // Go — all levels
  {
    label: 'go/go L1',
    language: 'go',
    buildTool: 'go',
    governanceLevel: 'L1',
    enableSecurityScanning: false,
    enableDebtGates: false,
  },
  {
    label: 'go/go L2',
    language: 'go',
    buildTool: 'go',
    governanceLevel: 'L2',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  {
    label: 'go/go L3',
    language: 'go',
    buildTool: 'go',
    governanceLevel: 'L3',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  {
    label: 'go/go L4',
    language: 'go',
    buildTool: 'go',
    governanceLevel: 'L4',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  // Python — all levels
  {
    label: 'python/pip L1',
    language: 'python',
    buildTool: 'pip',
    governanceLevel: 'L1',
    enableSecurityScanning: false,
    enableDebtGates: false,
  },
  {
    label: 'python/pip L2',
    language: 'python',
    buildTool: 'pip',
    governanceLevel: 'L2',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  {
    label: 'python/pip L3',
    language: 'python',
    buildTool: 'pip',
    governanceLevel: 'L3',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  {
    label: 'python/pip L4',
    language: 'python',
    buildTool: 'pip',
    governanceLevel: 'L4',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  // Rust — L2 and L3/L4 (L1 already covered above)
  {
    label: 'rust/cargo L2',
    language: 'rust',
    buildTool: 'cargo',
    governanceLevel: 'L2',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  {
    label: 'rust/cargo L3',
    language: 'rust',
    buildTool: 'cargo',
    governanceLevel: 'L3',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  {
    label: 'rust/cargo L4',
    language: 'rust',
    buildTool: 'cargo',
    governanceLevel: 'L4',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  // TypeScript — L2/L3/L4 (L1 already covered above)
  {
    label: 'typescript/npm L2',
    language: 'typescript',
    buildTool: 'npm',
    governanceLevel: 'L2',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  {
    label: 'typescript/npm L3',
    language: 'typescript',
    buildTool: 'npm',
    governanceLevel: 'L3',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  {
    label: 'typescript/npm L4',
    language: 'typescript',
    buildTool: 'npm',
    governanceLevel: 'L4',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  // Kotlin — gradle, all levels (#1194)
  {
    label: 'kotlin/gradle L1',
    language: 'kotlin',
    buildTool: 'gradle',
    governanceLevel: 'L1',
    enableSecurityScanning: false,
    enableDebtGates: false,
  },
  {
    label: 'kotlin/gradle L2',
    language: 'kotlin',
    buildTool: 'gradle',
    governanceLevel: 'L2',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  {
    label: 'kotlin/gradle L3',
    language: 'kotlin',
    buildTool: 'gradle',
    governanceLevel: 'L3',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
  {
    label: 'kotlin/gradle L4',
    language: 'kotlin',
    buildTool: 'gradle',
    governanceLevel: 'L4',
    enableSecurityScanning: true,
    enableDebtGates: true,
  },
]

describe('generated check-all.mjs extended syntax smoke (#1026)', () => {
  it.each(SMOKE_CASES)(
    '$label — no syntax errors',
    ({ language, buildTool, governanceLevel, enableSecurityScanning, enableDebtGates }) => {
      const dir = mkdtempSync(join(tmpdir(), `arbiter-smoke-${language}-${governanceLevel}-`))
      try {
        generateCheckAll(
          makeConfig(dir, {
            language,
            buildTool,
            governanceLevel,
            enableSecurityScanning,
            enableDebtGates,
          }),
        )
        const scriptPath = join(dir, 'scripts', 'check-all.mjs')
        expect(
          existsSync(scriptPath),
          `check-all.mjs not generated for ${language}/${buildTool}/${governanceLevel}`,
        ).toBe(true)
        const r = spawnSync('node', ['--check', scriptPath], { encoding: 'utf-8' })
        expect(
          r.status,
          `Syntax error (${language}/${buildTool}/${governanceLevel}): ${r.stderr}`,
        ).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})

// Kotlin gate wiring behavioral assertions (#1194)
// Red-Green proof: these fail before the EJS branches are added, pass after.
describe('kotlin/gradle gate wiring (#1194)', () => {
  it('L1 output contains HARD unit-test invocation and SOFT detekt (beta)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-kotlin-l1-'))
    try {
      generateCheckAll(
        makeConfig(dir, {
          language: 'kotlin',
          buildTool: 'gradle',
          governanceLevel: 'L1',
          enableSecurityScanning: false,
          enableDebtGates: false,
        }),
      )
      const scriptPath = join(dir, 'scripts', 'check-all.mjs')
      const content = readFileSync(scriptPath, 'utf-8')
      // HARD check — unit tests must block the gate on failure
      expect(content).toContain("runCheck('unit tests', './gradlew', ['test', '-q'])")
      // SOFT check — detekt is beta (operator-applied plugin); must not HARD-fail a fresh project
      expect(content).toContain(
        "runCheck('detekt (beta)', './gradlew', ['detekt'], { soft: true })",
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('L2 output contains SOFT ArchUnit invocation when architectureStyle is set (#1194)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-kotlin-l2-arch-'))
    try {
      generateCheckAll(
        makeConfig(dir, {
          language: 'kotlin',
          buildTool: 'gradle',
          governanceLevel: 'L2',
          enableSecurityScanning: true,
          enableDebtGates: true,
          architectureStyle: 'hexagonal',
          basePackage: 'com.example',
        }),
      )
      const scriptPath = join(dir, 'scripts', 'check-all.mjs')
      const content = readFileSync(scriptPath, 'utf-8')
      // ArchUnit is beta — SOFT via { soft: true }
      expect(content).toContain(
        "runCheck('architecture tests (beta)', './gradlew', ['test', '--tests', '*.architecture.*', '-q'], { soft: true })",
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('L2 debt-gates output contains SOFT kover coverage when coverageEnabled (#1194)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-kotlin-l2-cov-'))
    try {
      generateCheckAll(
        makeConfig(dir, {
          language: 'kotlin',
          buildTool: 'gradle',
          governanceLevel: 'L2',
          enableSecurityScanning: true,
          enableDebtGates: true,
          // coverageEnabled is derived from governanceLevel via computeThresholds
        }),
      )
      const scriptPath = join(dir, 'scripts', 'check-all.mjs')
      const content = readFileSync(scriptPath, 'utf-8')
      // Kover is beta — SOFT; placed inside enableDebtGates block (mirrors java jacoco pattern)
      expect(content).toContain(
        "runCheck('coverage (kover, beta)', './gradlew', ['koverVerify', 'koverXmlReport'], { soft: true })",
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
