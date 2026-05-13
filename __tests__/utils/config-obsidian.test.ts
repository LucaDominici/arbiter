import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveConfig, loadConfig } from '../../src/utils/config.js'

describe('ArbiterConfig.enableObsidianVault', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-cfg-obs-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('persists enableObsidianVault=true round-trip', () => {
    saveConfig(dir, {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      enableObsidianVault: true,
    })
    const loaded = loadConfig(dir)
    expect(loaded?.enableObsidianVault).toBe(true)
  })

  it('omits enableObsidianVault when not set', () => {
    saveConfig(dir, {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
    })
    const loaded = loadConfig(dir)
    expect(loaded?.enableObsidianVault).toBeUndefined()
  })
})

describe('loadConfig (#115) — parse error visibility', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-cfg-parse-'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('missing file → null, no console.warn', () => {
    const result = loadConfig(dir)
    expect(result).toBeNull()
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('corrupt JSON → null + console.warn referencing arbiter.json', () => {
    writeFileSync(join(dir, 'arbiter.json'), '{', 'utf-8')
    const result = loadConfig(dir)
    expect(result).toBeNull()
    expect(console.warn).toHaveBeenCalledOnce()
    const warnArg = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(warnArg).toContain('arbiter.json')
  })
})
