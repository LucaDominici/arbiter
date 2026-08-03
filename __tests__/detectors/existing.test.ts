import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { detectExisting, isBrownfield } from '../../src/detectors/existing.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-test-'))
}

describe('detectExisting', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns all false for empty dir', () => {
    const state = detectExisting(dir)
    expect(state.agentsMd).toBe(false)
    expect(state.claudeDir).toBe(false)
    expect(state.agentsDir).toBe(false)
    expect(state.aiRulez).toBe(false)
    expect(state.settingsJson).toBe(false)
    expect(state.checkAllScript).toBe(false)
  })

  it('detects AGENTS.md', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '')
    expect(detectExisting(dir).agentsMd).toBe(true)
  })

  it('detects .claude dir', () => {
    mkdirSync(join(dir, '.claude'))
    expect(detectExisting(dir).claudeDir).toBe(true)
  })

  it('detects settings.json inside .claude', () => {
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude', 'settings.json'), '{}')
    const state = detectExisting(dir)
    expect(state.claudeDir).toBe(true)
    expect(state.settingsJson).toBe(true)
  })

  it('detects ai-rulez yml', () => {
    writeFileSync(join(dir, 'ai-rulez.yml'), '')
    expect(detectExisting(dir).aiRulez).toBe(true)
  })

  it('returns geminiDir=false for empty dir', () => {
    expect(detectExisting(dir).geminiDir).toBe(false)
  })

  it('detects .gemini directory', () => {
    mkdirSync(join(dir, '.gemini'))
    expect(detectExisting(dir).geminiDir).toBe(true)
  })

  it('detects windsurf-instructions.md', () => {
    writeFileSync(join(dir, 'windsurf-instructions.md'), '# windsurf')
    expect(detectExisting(dir).windsurfRules).toBe(true)
  })

  it('detects .aider.conf.yml', () => {
    writeFileSync(join(dir, '.aider.conf.yml'), 'model: gpt-4o')
    expect(detectExisting(dir).aiderConf).toBe(true)
  })

  it('detects bounded brownfield signals', () => {
    const cases: Array<{
      name: string
      files: string[]
      expected: { tests: boolean; ciWorkflows: boolean; lintConfig: boolean }
    }> = [
      {
        name: 'Go test files',
        files: ['go.mod', 'foo_test.go'],
        expected: { tests: true, ciWorkflows: false, lintConfig: false },
      },
      {
        name: 'Python tests directory',
        files: ['tests/test_x.py'],
        expected: { tests: true, ciWorkflows: false, lintConfig: false },
      },
      {
        name: 'GitHub workflow',
        files: ['.github/workflows/ci.yml'],
        expected: { tests: false, ciWorkflows: true, lintConfig: false },
      },
      {
        name: 'golangci lint configuration',
        files: ['.golangci.yml'],
        expected: { tests: false, ciWorkflows: false, lintConfig: true },
      },
      {
        name: 'bare repository',
        files: [],
        expected: { tests: false, ciWorkflows: false, lintConfig: false },
      },
      {
        name: 'node_modules is excluded from the bounded scan',
        files: ['node_modules/pkg/x.test.js'],
        expected: { tests: false, ciWorkflows: false, lintConfig: false },
      },
    ]

    for (const testCase of cases) {
      const caseDir = tmpDir()
      try {
        for (const file of testCase.files) {
          mkdirSync(dirname(join(caseDir, file)), { recursive: true })
          writeFileSync(join(caseDir, file), '')
        }

        const state = detectExisting(caseDir)
        expect(state, testCase.name).toMatchObject(testCase.expected)
        expect(isBrownfield(state), testCase.name).toBe(
          testCase.expected.tests || testCase.expected.ciWorkflows || testCase.expected.lintConfig,
        )
      } finally {
        rmSync(caseDir, { recursive: true, force: true })
      }
    }
  })
})
