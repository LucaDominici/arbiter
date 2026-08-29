import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateCodexHooks } from '../../src/generators/codex-hooks.js'
import { makeConfig } from '../helpers.js'

describe('brownfield: generateCodexHooks on existing .codex/', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-codex-brownfield-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('backs up existing config.toml before replacing (CANON-11)', () => {
    const codexDir = join(dir, '.codex')
    mkdirSync(codexDir, { recursive: true })
    const original = '# hand-written config\n[features]\nhooks = false\n'
    writeFileSync(join(codexDir, 'config.toml'), original)

    generateCodexHooks(makeConfig(dir))

    expect(existsSync(join(codexDir, 'config.toml.arbiter-backup'))).toBe(true)
    const backup = readFileSync(join(codexDir, 'config.toml.arbiter-backup'), 'utf-8')
    expect(backup).toBe(original)

    const updated = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
    expect(updated).toContain('hooks = true')
  })

  it('preserves custom codex-adapter.mjs if already present (skipIfExists)', () => {
    const codexDir = join(dir, '.codex')
    mkdirSync(codexDir, { recursive: true })
    const custom = '// custom adapter\n'
    writeFileSync(join(codexDir, 'codex-adapter.mjs'), custom)

    generateCodexHooks(makeConfig(dir))

    const content = readFileSync(join(codexDir, 'codex-adapter.mjs'), 'utf-8')
    expect(content).toBe(custom)
  })

  it('creates both files when .codex/ does not exist yet', () => {
    // Default makeConfig has tools: ['claude', 'codex'] — claude.ts owns the shared
    // guard hooks in that combination (#1578 sole-emitter), so only these two.
    const result = generateCodexHooks(makeConfig(dir))
    const actions = result.files.map((f) => f.action)
    expect(actions).toEqual(['created', 'created'])
    expect(existsSync(join(dir, '.codex', 'config.toml'))).toBe(true)
    expect(existsSync(join(dir, '.codex', 'codex-adapter.mjs'))).toBe(true)
  })

  it('creates all files (hook parity + codex adapter) when codex is the only tool selected (#1885)', () => {
    const result = generateCodexHooks(makeConfig(dir, { tools: ['codex'] }))
    const actions = result.files.map((f) => f.action)
    // lib.mjs + 5 shared guard hooks + check-no-skipped-tests.mjs + config.toml +
    // codex-adapter.mjs = 9, all freshly created.
    expect(actions).toEqual(Array(9).fill('created'))
    expect(existsSync(join(dir, '.codex', 'config.toml'))).toBe(true)
    expect(existsSync(join(dir, '.codex', 'codex-adapter.mjs'))).toBe(true)
    expect(existsSync(join(dir, '.claude', 'hooks', 'stop-dangerous.mjs'))).toBe(true)
  })
})
