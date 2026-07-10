import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { generateCodexHooks } from '../../src/generators/codex-hooks.js'
import { formatContent } from '../../src/utils/prettier-format.js'
import { makeConfig } from '../helpers.js'

describe('generateCodexHooks', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-codex-hooks-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates .codex/config.toml and .codex/codex-adapter.mjs', () => {
    const result = generateCodexHooks(makeConfig(dir))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('config.toml'))).toBe(true)
    expect(paths.some((p) => p.endsWith('codex-adapter.mjs'))).toBe(true)
  })

  it('codex-adapter.mjs is written pre-formatted so manifest matches disk (#1349)', () => {
    generateCodexHooks(makeConfig(dir))
    const path = join(dir, '.codex', 'codex-adapter.mjs')
    const written = readFileSync(path, 'utf-8')
    // Re-formatting the written bytes is a no-op ⇒ the file was formatted BEFORE
    // writeFile recorded its render hash, so there is no post-write reformat to
    // desync the generated-manifest (no false-positive "withheld" on next diff).
    expect(formatContent(written, path, dir)).toBe(written)
  })

  it('config.toml is syntactically valid TOML', () => {
    generateCodexHooks(makeConfig(dir))
    const content = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8')
    expect(() => parseToml(content)).not.toThrow()
  })

  it('config.toml enables codex_hooks feature', () => {
    generateCodexHooks(makeConfig(dir))
    const content = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8')
    const parsed = parseToml(content) as Record<string, unknown>
    const features = parsed.features as Record<string, unknown>
    expect(features?.codex_hooks).toBe(true)
  })

  it('config.toml wires stop-dangerous adapter for bash PreToolUse', () => {
    generateCodexHooks(makeConfig(dir))
    const content = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8')
    expect(content).toContain('stop-dangerous.mjs')
    expect(content).toContain('bash')
  })

  it('config.toml wires enforce-read-only and ssot-guard for apply_patch PreToolUse', () => {
    generateCodexHooks(makeConfig(dir))
    const content = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8')
    expect(content).toContain('enforce-read-only.mjs')
    expect(content).toContain('pre-edit-ssot-guard.mjs')
    expect(content).toContain('apply_patch')
  })

  it('config.toml wires check-no-orphan-todo for apply_patch PostToolUse', () => {
    generateCodexHooks(makeConfig(dir))
    const content = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8')
    expect(content).toContain('check-no-orphan-todo.mjs')
  })

  it('includes check-no-pii when enableSecurityScanning is true', () => {
    generateCodexHooks(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8')
    expect(content).toContain('check-no-pii.mjs')
  })

  it('omits check-no-pii when enableSecurityScanning is false (L1)', () => {
    generateCodexHooks(makeConfig(dir, { governanceLevel: 'L1' }))
    const content = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8')
    expect(content).not.toContain('check-no-pii.mjs')
  })

  it('codex-adapter.mjs reads stdin and sets env vars', () => {
    generateCodexHooks(makeConfig(dir))
    const content = readFileSync(join(dir, '.codex', 'codex-adapter.mjs'), 'utf-8')
    expect(content).toContain('CLAUDE_TOOL_INPUT_PATH')
    expect(content).toContain('CLAUDE_TOOL_INPUT_COMMAND')
    expect(content).toContain('apply_patch')
    expect(content).toContain('bash')
  })

  it("returns 'created' action for new files", () => {
    // Default makeConfig has tools: ['claude', 'codex'] — with claude also selected,
    // generateClaudeHooks (claude.ts) owns the shared guard hooks (#1578 sole-emitter),
    // so this generator only produces config.toml + codex-adapter.mjs here.
    const result = generateCodexHooks(makeConfig(dir))
    const created = result.files.filter((f) => f.action === 'created')
    expect(created.length).toBe(2)
  })

  it('skips adapter if already exists (skipIfExists)', () => {
    generateCodexHooks(makeConfig(dir))
    const result2 = generateCodexHooks(makeConfig(dir))
    const adapter = result2.files.find((f) => f.path.endsWith('codex-adapter.mjs'))
    expect(adapter?.action).toBe('skipped')
  })

  it('backs up and replaces config.toml when its content differs on re-run', () => {
    const first = generateCodexHooks(makeConfig(dir))
    const tomlPath = first.files.find((f) => f.path.endsWith('config.toml'))!.path
    // Simulate a user edit so the regenerated config.toml genuinely differs from
    // disk — only then does writeFile take the backup-and-replace path. (#1077: a
    // byte-identical regeneration now skips and does NOT churn a backup.)
    writeFileSync(tomlPath, '# user-edited config.toml\n', 'utf-8')
    const result2 = generateCodexHooks(makeConfig(dir))
    const toml = result2.files.find((f) => f.path.endsWith('config.toml'))
    expect(toml?.action).toBe('backed-up-and-replaced')
    expect(existsSync(`${tomlPath}.arbiter-backup`)).toBe(true)
  })

  it('skips config.toml on a byte-identical re-run (#1077 F6 idempotence)', () => {
    const first = generateCodexHooks(makeConfig(dir))
    const tomlPath = first.files.find((f) => f.path.endsWith('config.toml'))!.path
    // Second run, no on-disk change → byte-identical → skipped, no churned backup.
    const result2 = generateCodexHooks(makeConfig(dir))
    const toml = result2.files.find((f) => f.path.endsWith('config.toml'))
    expect(toml?.action).toBe('skipped')
    expect(existsSync(`${tomlPath}.arbiter-backup`)).toBe(false)
  })

  // #1885: codex-only init (claude deselected) previously left every path config.toml
  // references unwritten — generateClaudeHooks (the only emitter of these 6 scripts)
  // only runs when `claude` is in config.tools. codex-adapter.mjs's execFileSync then
  // crashes on a missing module (MODULE_NOT_FOUND, exit 1), and for a PreToolUse hook
  // that non-zero exit BLOCKS the tool — every bash/apply_patch call on a codex-only
  // project was unusable. generateCodexHooks must be fully self-sufficient: it must
  // emit every file its own config.toml points at, independent of what else is selected.
  describe('codex-only hook parity (#1885)', () => {
    const ALL_REFERENCED_HOOKS = [
      'lib.mjs',
      'stop-dangerous.mjs',
      'enforce-read-only.mjs',
      'pre-edit-ssot-guard.mjs',
      'check-no-orphan-todo.mjs',
      'check-no-placeholders.mjs',
      'check-no-skipped-tests.mjs',
    ]

    it('emits every .claude/hooks/*.mjs referenced by config.toml, even with claude deselected', () => {
      generateCodexHooks(makeConfig(dir, { tools: ['codex'] }))
      for (const hookFile of ALL_REFERENCED_HOOKS) {
        const path = join(dir, '.claude', 'hooks', hookFile)
        expect(existsSync(path), `expected ${hookFile} to be emitted for codex-only init`).toBe(
          true,
        )
      }
    })

    it('every hook path referenced in the rendered config.toml exists on disk (codex-only)', () => {
      generateCodexHooks(makeConfig(dir, { tools: ['codex'] }))
      const content = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8')
      // check-no-pii.mjs is excluded: it's emitted by generateSecurity (security.ts),
      // gated only on enableSecurityScanning (tools-independent) — already correct
      // pre-#1885 and out of scope for generateCodexHooks itself.
      const referenced = [...content.matchAll(/\.claude\/hooks\/([\w.-]+\.mjs)/g)]
        .map((m) => m[1])
        .filter((h) => h !== 'check-no-pii.mjs')
      expect(referenced.length).toBeGreaterThan(0)
      for (const hookFile of referenced) {
        expect(
          existsSync(join(dir, '.claude', 'hooks', hookFile)),
          `config.toml references .claude/hooks/${hookFile} but it was not emitted`,
        ).toBe(true)
      }
    })

    it('omits check-no-skipped-tests.mjs (file and reference) when enableNoSkippedTests is false', () => {
      generateCodexHooks(makeConfig(dir, { tools: ['codex'], enableNoSkippedTests: false }))
      expect(existsSync(join(dir, '.claude', 'hooks', 'check-no-skipped-tests.mjs'))).toBe(false)
      const content = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8')
      expect(content).not.toContain('check-no-skipped-tests.mjs')
    })

    it('emitted stop-dangerous.mjs and lib.mjs are the same content generateClaudeHooks would produce', () => {
      generateCodexHooks(makeConfig(dir, { tools: ['codex'] }))
      const stopDangerous = readFileSync(
        join(dir, '.claude', 'hooks', 'stop-dangerous.mjs'),
        'utf-8',
      )
      expect(stopDangerous).toContain("from './lib.mjs'")
      const lib = readFileSync(join(dir, '.claude', 'hooks', 'lib.mjs'), 'utf-8')
      expect(lib).toContain('export const logInfo')
    })

    // #1578 sole-emitter (INV-128): when `claude` is ALSO selected, generateClaudeHooks
    // (claude.ts) owns these paths — generateCodexHooks must defer entirely, not
    // duplicate-emit (even a safe, byte-identical duplicate breaks the "each path has
    // exactly one owning registry generator" contract that arbiter diff / the
    // generated-manifest relies on).
    it('does not emit the shared guard hooks when claude is also selected (defers to claude.ts)', () => {
      const result = generateCodexHooks(makeConfig(dir, { tools: ['claude', 'codex'] }))
      for (const hookFile of ALL_REFERENCED_HOOKS) {
        const entry = result.files.find((f) => f.path.endsWith(`/${hookFile}`))
        expect(entry, `${hookFile} must not be emitted by generateCodexHooks here`).toBeUndefined()
      }
      // Still owns its own two files regardless of what else is selected.
      expect(result.files.some((f) => f.path.endsWith('config.toml'))).toBe(true)
      expect(result.files.some((f) => f.path.endsWith('codex-adapter.mjs'))).toBe(true)
    })
  })
})
