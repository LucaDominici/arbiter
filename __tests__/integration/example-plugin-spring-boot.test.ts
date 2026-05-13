import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runUpdate } from '../../src/commands/update.js'

const SPRING_BOOT_PLUGIN_DIR = resolve(__dirname, '../../examples/plugin-spring-boot')

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-plugin-spring-boot-'))
}

function initGit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Test'], {
    cwd: dir,
    stdio: 'ignore',
  })
}

function installPluginViaSymlink(dir: string): void {
  const scopeDir = join(dir, 'node_modules', '@arbiter')
  mkdirSync(scopeDir, { recursive: true })
  symlinkSync(SPRING_BOOT_PLUGIN_DIR, join(scopeDir, 'plugin-spring-boot'))
}

const FEATURES = {
  debtGates: false,
  suppressions: false,
  securityScanning: false,
  mutationTesting: false,
  contractTesting: false,
  evidenceHarness: false,
}

const THRESHOLDS = {
  lineCoverage: 60,
  branchCoverage: 50,
  mutationScore: 70,
  cyclomaticComplexity: 20,
  methodLength: 100,
  maxParams: 8,
}

function writeArbiterConfig(dir: string): void {
  const config = {
    version: '0.2',
    projectName: 'spring-boot-test',
    archetype: 'backend-web-db',
    language: 'java',
    framework: 'spring-boot',
    governanceLevel: 'L1',
    tools: ['claude'],
    useGitHub: false,
    features: FEATURES,
    thresholds: THRESHOLDS,
    plugins: ['@arbiter/plugin-spring-boot'],
  }
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(config, null, 2))
}

describe('example plugin: @arbiter/plugin-spring-boot', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    initGit(dir)
    writeArbiterConfig(dir)
    installPluginViaSymlink(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates Application.java when archetype matches', async () => {
    await runUpdate({ dir, github: false })

    const javaPath = join(dir, 'src', 'main', 'java', 'com', 'example', 'Application.java')
    expect(existsSync(javaPath)).toBe(true)
  })

  it('Application.java contains SpringBoot annotations', async () => {
    await runUpdate({ dir, github: false })

    const javaPath = join(dir, 'src', 'main', 'java', 'com', 'example', 'Application.java')
    const content = existsSync(javaPath)
      ? (await import('node:fs')).readFileSync(javaPath, 'utf-8')
      : ''
    expect(content).toContain('@SpringBootApplication')
    expect(content).toContain('SpringApplication.run')
  })

  it('skips plugin when detect returns false (wrong archetype)', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify(
        {
          version: '0.2',
          projectName: 'frontend-project',
          archetype: 'frontend-spa',
          language: 'typescript',
          framework: 'react',
          governanceLevel: 'L1',
          tools: ['claude'],
          useGitHub: false,
          features: FEATURES,
          thresholds: THRESHOLDS,
          plugins: ['@arbiter/plugin-spring-boot'],
        },
        null,
        2,
      ),
    )

    await runUpdate({ dir, github: false })

    const javaPath = join(dir, 'src', 'main', 'java', 'com', 'example', 'Application.java')
    expect(existsSync(javaPath)).toBe(false)
  })
})
