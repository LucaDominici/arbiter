// Greenfield smoke test (#1038): verifies the full wizard→config→validator seam.
// Prevents regressions where unit tests pass but the composed pipeline produces
// an invalid arbiter.json (the haben init failure class).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runInit, buildArbiterConfig } from '../../src/commands/init.js'
import { validateConfig } from '../../src/config/schema.js'
import { buildConfigFromAnswers } from '../../src/wizard/prompts.js'
import type { WizardInput } from '../../src/wizard/prompts.js'
import type { WizardAnswers } from '../../src/wizard/types.js'
import type { GovernanceLevel, Archetype } from '../../src/wizard/types.js'
import type { ExistingState } from '../../src/detectors/existing.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-greenfield-smoke-'))
}

function initGit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' })
}

function makeMinimalTsProject(dir: string): void {
  initGit(dir)
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'smoke-project', version: '0.1.0', private: true }, null, 2),
  )
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const hello = (): string => "hello"\n')
}

function readArbiterJson(dir: string): unknown {
  return JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as unknown
}

// ── Full pipeline smoke tests ────────────────────────────────────────────────

describe('greenfield smoke test — runInit produces valid arbiter.json (#1038)', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    makeMinimalTsProject(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('L1: arbiter.json passes validateConfig', async () => {
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L1',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    const raw = readArbiterJson(dir)
    const result = validateConfig(raw)
    expect(
      result.ok,
      result.ok ? '' : `errors: ${(result as { errors: string[] }).errors.join(', ')}`,
    ).toBe(true)
  })

  it('L2: arbiter.json passes validateConfig', async () => {
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    const raw = readArbiterJson(dir)
    const result = validateConfig(raw)
    expect(
      result.ok,
      result.ok ? '' : `errors: ${(result as { errors: string[] }).errors.join(', ')}`,
    ).toBe(true)
  })

  it('L3: arbiter.json passes validateConfig', async () => {
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L3',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    const raw = readArbiterJson(dir)
    const result = validateConfig(raw)
    expect(
      result.ok,
      result.ok ? '' : `errors: ${(result as { errors: string[] }).errors.join(', ')}`,
    ).toBe(true)
  })

  it('L2 multi-tool: arbiter.json passes validateConfig', async () => {
    await runInit({
      yes: true,
      tools: 'claude,codex',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    const raw = readArbiterJson(dir)
    const result = validateConfig(raw)
    expect(
      result.ok,
      result.ok ? '' : `errors: ${(result as { errors: string[] }).errors.join(', ')}`,
    ).toBe(true)
  })

  // #1093 part 1: fresh `arbiter init` must persist the collaborationMode axis.
  // Before the fix, buildArbiterConfig omitted the field and only `arbiter update`'s
  // migration retro-fitted it — leaving the primary workflow axis unreachable for
  // greenfield projects. This is RED on main (field absent) and green with the fix.
  it('writes collaborationMode into generated arbiter.json (#1093)', async () => {
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    const raw = readArbiterJson(dir) as { collaborationMode?: unknown }
    expect(
      raw.collaborationMode,
      'fresh init must persist collaborationMode, not leave it to the update migration',
    ).toBeDefined()
    expect(['trunk-solo', 'peer-review', 'gated-review']).toContain(raw.collaborationMode)
    // Non-solo default resolves to peer-review (mirrors the branch-protection default).
    expect(raw.collaborationMode).toBe('peer-review')
  })
})

// ── Wizard→validator contract matrix ────────────────────────────────────────

function makeExisting(): ExistingState {
  return {
    agentsMd: false,
    claudeDir: false,
    agentsDir: false,
    aiRulez: false,
    settingsJson: false,
    checkAllScript: false,
    geminiDir: false,
    windsurfRules: false,
    aiderConf: false,
  }
}

function makeInput(): WizardInput {
  return {
    targetDir: '/tmp/smoke',
    projectName: 'smoke',
    language: 'typescript',
    framework: null,
    buildCmds: {
      buildTool: 'npm',
      buildCommand: 'npm run build',
      testCommand: 'npm test',
      lintCommand: 'npm run lint',
      formatCommand: 'npx prettier --check .',
    },
    gitInfo: {
      isGitRepo: true,
      remoteUrl: null,
      githubOwner: 'acme',
      githubRepo: 'smoke',
      projectName: 'smoke',
    },
    existing: makeExisting(),
    githubAccess: { available: false, authenticated: false, username: null, error: null },
  }
}

function makeAnswers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  return {
    description: 'Smoke test project',
    tools: ['claude'],
    governanceLevel: 'L2',
    archetype: 'backend-web-db',
    architectureStyle: 'none',
    hasDatabase: false,
    hasPublicApi: false,
    isMultiTenant: false,
    decompositionBackend: 'markdown',
    ...overrides,
  }
}

const LEVELS: GovernanceLevel[] = ['L1', 'L2', 'L3']
const ARCHETYPES: Archetype[] = [
  'backend-web-db',
  'cli',
  'library',
  'data-pipeline',
  'frontend-spa',
  'embedded',
]

describe('wizard→validator contract matrix (#1038)', () => {
  for (const level of LEVELS) {
    for (const archetype of ARCHETYPES) {
      it(`${level} × ${archetype}: buildConfigFromAnswers output passes validateConfig`, () => {
        const projectConfig = buildConfigFromAnswers(
          makeInput(),
          makeAnswers({ governanceLevel: level, archetype }),
        )
        const arbiterConfig = buildArbiterConfig(projectConfig)
        // Serialize → parse to simulate the JSON round-trip that arbiter.json goes through
        const raw = JSON.parse(JSON.stringify(arbiterConfig)) as unknown
        const result = validateConfig(raw)
        expect(
          result.ok,
          result.ok
            ? ''
            : `${level}×${archetype} errors: ${(result as { errors: string[] }).errors.join(', ')}`,
        ).toBe(true)
      })
    }
  }
})
