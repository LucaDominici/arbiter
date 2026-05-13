import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectExisting } from '../../src/detectors/existing.js'

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
})
