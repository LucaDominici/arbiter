import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig } from '../../helpers.js'

const ADAPTER = join(process.cwd(), 'src/templates/codex/codex-adapter.mjs')

const TPL_DIR = join(process.cwd(), 'src/templates/claude/hooks')

// Hooks that import ./lib.mjs (resolveToolInputPath) must be spawned from a directory where
// lib.mjs is a sibling. Materialize the hooks-under-test + rendered lib.mjs into one temp dir.
let HOOKS_DIR = ''
let ORPHAN_TODO_HOOK = ''
let SSOT_GUARD_HOOK = ''
// stop-dangerous.mjs now imports ./lib.mjs (resolveToolInputCommand, #1565), so it too must be
// materialized alongside a rendered lib.mjs — spawning from src/templates/ would fail to resolve it.
let STOP_DANGEROUS_HOOK = ''

beforeAll(() => {
  HOOKS_DIR = mkdtempSync(join(tmpdir(), 'arbiter-codex-hooks-'))
  mkdirSync(HOOKS_DIR, { recursive: true })
  writeFileSync(
    join(HOOKS_DIR, 'lib.mjs'),
    renderTemplate(
      'claude/hooks/lib.mjs.ejs',
      makeConfig(process.cwd(), { projectName: 'arbiter' }),
    ),
  )
  for (const name of [
    'check-no-orphan-todo.mjs',
    'pre-edit-ssot-guard.mjs',
    'stop-dangerous.mjs',
  ]) {
    writeFileSync(join(HOOKS_DIR, name), readFileSync(join(TPL_DIR, name), 'utf-8'))
  }
  ORPHAN_TODO_HOOK = join(HOOKS_DIR, 'check-no-orphan-todo.mjs')
  SSOT_GUARD_HOOK = join(HOOKS_DIR, 'pre-edit-ssot-guard.mjs')
  STOP_DANGEROUS_HOOK = join(HOOKS_DIR, 'stop-dangerous.mjs')
})

function runAdapter(stdinPayload: object, hookPath: string, extraEnv: Record<string, string> = {}) {
  const baseEnv = { ...process.env }
  delete baseEnv['ARBITER_SSOT_BYPASS']
  return spawnSync('node', [ADAPTER, hookPath], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf-8',
    env: { ...baseEnv, ...extraEnv },
  })
}

function makeApplyPatchPayload(patchCommand: string) {
  return {
    hook_event_name: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: patchCommand },
    cwd: process.cwd(),
    session_id: 'test-session',
  }
}

function makeBashPayload(command: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'bash',
    tool_input: { command },
    cwd: process.cwd(),
    session_id: 'test-session',
  }
}

describe('codex-adapter', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-codex-adapter-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // ── apply_patch → file-path extraction ───────────────────────────────────

  it('extracts path from apply_patch diff and sets CLAUDE_TOOL_INPUT_PATH for hook', () => {
    const file = join(dir, 'test.ts')
    // Construct fixture content without literal bare TODO to avoid triggering the hook on this source file
    writeFileSync(file, `// ${'TODO'}: bare todo without task id\n`)

    const patch = `*** Begin Patch\n*** Update File: ${file}\n@@\n-old line\n+new line\n*** End Patch`

    const result = runAdapter(makeApplyPatchPayload(patch), ORPHAN_TODO_HOOK)
    // Hook fires and finds orphan TODO — blocks via exit 2 (#1631)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('INV-21')
  })

  it('exits 0 when apply_patch file has no orphan TODO', () => {
    const file = join(dir, 'clean.ts')
    writeFileSync(file, 'const x = 1;\n')

    const patch = `*** Begin Patch\n*** Update File: ${file}\n@@\n-const x = 1;\n+const x = 2;\n*** End Patch`

    const result = runAdapter(makeApplyPatchPayload(patch), ORPHAN_TODO_HOOK)
    expect(result.status).toBe(0)
  })

  it('exits 0 when apply_patch patch has no file path', () => {
    const payload = makeApplyPatchPayload('malformed patch with no file path')
    const result = runAdapter(payload, ORPHAN_TODO_HOOK)
    expect(result.status).toBe(0)
  })

  // ── bash → command extraction ─────────────────────────────────────────────

  it('sets CLAUDE_TOOL_INPUT_COMMAND for bash tool and delegates to hook', () => {
    const payload = makeBashPayload('rm -rf /')
    const result = runAdapter(payload, STOP_DANGEROUS_HOOK)
    // stop-dangerous blocks rm -rf / — exit 2 (#1631)
    expect(result.status).toBe(2)
  })

  it('exits 0 for bash tool with safe command', () => {
    const payload = makeBashPayload('echo hello')
    const result = runAdapter(payload, STOP_DANGEROUS_HOOK)
    expect(result.status).toBe(0)
  })

  // ── stdin parsing edge cases ──────────────────────────────────────────────

  it('exits 0 gracefully when stdin is empty', () => {
    const result = spawnSync('node', [ADAPTER, ORPHAN_TODO_HOOK], {
      input: '',
      encoding: 'utf-8',
      env: { ...process.env },
    })
    expect(result.status).toBe(0)
  })

  it('exits 0 gracefully when stdin is not JSON', () => {
    const result = spawnSync('node', [ADAPTER, ORPHAN_TODO_HOOK], {
      input: 'not-json',
      encoding: 'utf-8',
      env: { ...process.env },
    })
    expect(result.status).toBe(0)
  })

  it('exits 0 for unknown tool_name', () => {
    const payload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'unknown_tool',
      tool_input: {},
      cwd: process.cwd(),
      session_id: 'test-session',
    }
    const result = runAdapter(payload, ORPHAN_TODO_HOOK)
    expect(result.status).toBe(0)
  })

  // ── multi-file patches ────────────────────────────────────────────────────

  it('runs hook for each file in a multi-file apply_patch', () => {
    const file1 = join(dir, 'a.ts')
    const file2 = join(dir, 'b.ts')
    writeFileSync(file1, `// ${'TODO'}: orphan\n`)
    writeFileSync(file2, 'const ok = true;\n')

    const patch = `*** Begin Patch\n*** Update File: ${file1}\n@@\n-old\n+new\n*** Update File: ${file2}\n@@\n-old\n+new\n*** End Patch`

    const result = runAdapter(makeApplyPatchPayload(patch), ORPHAN_TODO_HOOK)
    // file1 has orphan TODO — should block via exit 2 (#1631)
    expect(result.status).toBe(2)
  })

  it('detects violation in second file when first file is clean', () => {
    const file1 = join(dir, 'clean.ts')
    const file2 = join(dir, 'dirty.ts')
    writeFileSync(file1, 'const x = 1;\n')
    writeFileSync(file2, `// ${'TODO'}: orphan in second file\n`)

    const patch = `*** Begin Patch\n*** Update File: ${file1}\n@@\n-old\n+new\n*** Update File: ${file2}\n@@\n-old\n+new\n*** End Patch`

    const result = runAdapter(makeApplyPatchPayload(patch), ORPHAN_TODO_HOOK)
    // file2 has orphan TODO — loop must iterate past index 0
    expect(result.status).toBe(2)
  })

  it('captures Move to rename target for hook checks', () => {
    // Rename patch where destination is an SSOT file — guard must fire
    const patch = `*** Begin Patch\n*** Update File: src/foo.ts\n*** Move to: AGENTS.md\n@@\n-old\n+new\n*** End Patch`
    const result = runAdapter(makeApplyPatchPayload(patch), SSOT_GUARD_HOOK)
    // SSOT guard should exit 2 because AGENTS.md is the rename destination
    expect(result.status).toBe(2)
  })

  it('handles Add File directive', () => {
    const file = join(dir, 'new-file.ts')
    writeFileSync(file, `// ${'TODO'}: orphan in new file\n`)
    const patch = `*** Begin Patch\n*** Add File: ${file}\n+new content\n*** End Patch`
    const result = runAdapter(makeApplyPatchPayload(patch), ORPHAN_TODO_HOOK)
    expect(result.status).toBe(2)
  })
})
